import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { TopicCandidateCard } from "../../../../shared/src/index.js";
import { env } from "../../config/env.js";
import type { DbClient } from "../../db/client";
import {
  listRecentCachedCandidates,
  listRecentProjectRecommendationRounds,
  recordProjectRecommendationRound,
  saveCachedCandidate,
} from "../cache/candidate-cache.repository.js";
import {
  createLlmGateway,
  type InvokeStrictStructuredOptions,
  type LlmGateway,
} from "../../runtime/llm/llm-gateway.js";
import {
  renderRecommendationDiagnosticsMarkdown,
  type LlmInteractionLogWriter,
} from "../../runtime/llm/interaction-log.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type {
  StrictStructuredToolSchema,
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { runTopicRecommendationGraph } from "../../runtime/orchestration/topic-recommendation-graph.js";
import type {
  CandidatePreviewTrace,
  CandidateQualityScorecard,
  TopicCandidateDeduction,
} from "../../runtime/orchestration/runtime-diagnostics.js";
import {
  TOPIC_CANDIDATE_TARGET_COUNT,
  TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT,
} from "../../runtime/orchestration/topic-recommendation-nodes.js";
import {
  createCompositeInteractionLogWriter,
  getProjectStorageProfile,
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";

import {
  buildTopicCandidates,
  type BuildTopicCandidatesInput,
} from "./topic-candidate.builder.js";
import {
  buildEventIdentityFingerprint,
  normalizeEventIdentityValue,
  normalizeEventInput,
} from "./event-normalizer.js";
import {
  createTopicCandidateLibraryRepository,
  type TopicCandidateLibraryRepository,
} from "./topic-candidate-library.repository.js";
import { projectTopicSelectorPool } from "./topic-selector-prompt-projection.js";

export interface TopicRecommendationOptions {
  llmGateway?: LlmGateway;
  projectId?: string | null;
  topicCandidateLibraryRepository?: TopicCandidateLibraryRepository;
}

type SelectorDeductionAxis = string;

const TOPIC_CONSISTENCY_STATUSES = ["pass", "risk"] as const;
const TOPIC_CONSISTENCY_ISSUES = [
  "none",
  "actor_role_mismatch",
  "action_event_mismatch",
  "cause_outcome_mismatch",
  "scope_boundary_mismatch",
  "language_contamination",
  "overclaim_or_ambiguity",
] as const;

type TopicConsistencyStatus = (typeof TOPIC_CONSISTENCY_STATUSES)[number];
type TopicConsistencyIssue = (typeof TOPIC_CONSISTENCY_ISSUES)[number];

interface TopicSelectorRankedCandidate extends CandidateQualityScorecard {
  candidate_id: string;
  deductions: Array<TopicCandidateDeduction & { axis: SelectorDeductionAxis }>;
  consistency_status: TopicConsistencyStatus;
  primary_consistency_issue: TopicConsistencyIssue;
  consistency_note: string;
}

interface TopicSelectorDecision {
  ranked_candidates: TopicSelectorRankedCandidate[];
}

export const TOPIC_SELECTOR_STRICT_SCHEMA: StrictStructuredToolSchema = {
  name: "rank_topic_candidates",
  description: "Rank every topic candidate in the selector pool with scorecards.",
  parameters: {
    type: "object",
    properties: {
      ranked_candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidate_id: {
              type: "string",
            },
            quality_rank: {
              type: "integer",
              minimum: 1,
            },
            quality_score: {
              type: "integer",
              minimum: 0,
              maximum: 100,
            },
            deductions: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  axis: {
                    type: "string",
                    enum: [
                      "opening_hook",
                      "conflict_pressure",
                      "scene_visibility",
                      "angle_freshness",
                      "script_expandability",
                      "ending_aftershock",
                      "fatigue_or_repetition",
                      "source_or_scope_risk",
                    ],
                  },
                  points_lost: {
                    type: "integer",
                    minimum: 1,
                    maximum: 30,
                  },
                  reason: {
                    type: "string",
                  },
                },
                required: ["axis", "points_lost", "reason"],
                additionalProperties: false,
              },
            },
            risk_summary: {
              type: "string",
            },
            consistency_status: {
              type: "string",
              enum: [...TOPIC_CONSISTENCY_STATUSES],
            },
            primary_consistency_issue: {
              type: "string",
              enum: [...TOPIC_CONSISTENCY_ISSUES],
            },
            consistency_note: {
              type: "string",
            },
          },
          required: [
            "candidate_id",
            "quality_rank",
            "quality_score",
            "deductions",
            "risk_summary",
            "consistency_status",
            "primary_consistency_issue",
            "consistency_note",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["ranked_candidates"],
    additionalProperties: false,
  },
};

export async function recommendTopicCandidatesWithTrace(
  db: DbClient,
  input: BuildTopicCandidatesInput,
  options?: TopicRecommendationOptions,
) {
  const recommendationStartedAt = new Date();
  const existingCacheRecordIds = [...db.candidateCache.keys()];
  const gateway = options?.llmGateway ?? createTopicRecommendationGateway();
  const project = options?.projectId ? db.projects.get(options.projectId) : null;
  const runId = `topic_run_${db.generateId()}`;
  const recentEventMemory = await buildRecentEventMemory({
    db,
    projectId: options?.projectId ?? null,
    createdBefore: recommendationStartedAt,
    existingCacheRecordIds,
  });
  const graphInput = {
    ...input,
    recent_event_memory: recentEventMemory,
  };
  const interactionLogWriter = project
    ? createCompositeInteractionLogWriter({
        project,
        phase: "topic",
        runId,
      })
    : undefined;

  try {
    const result = await runTopicRecommendationGraph(
    {
      db,
      input: graphInput,
      projectId: options?.projectId ?? null,
      runId,
    },
    {
      invokeStructuredPrompt: <T>(runnerInput: {
        promptId: string;
        input: unknown;
      }) =>
        invokeTopicStructuredPromptWithSafetyRetry<T>({
          gateway,
          promptId: runnerInput.promptId,
          promptInput: runnerInput.input,
          interactionLogWriter,
        }),
    },
  );
  const postProcessed = await postProcessTopicCandidates({
    db,
    seedInput: input,
    candidates: result.candidates,
    projectId: options?.projectId ?? null,
    createdBefore: recommendationStartedAt,
    existingCacheRecordIds,
  });
  const topicCandidateLibraryRepository =
    options?.topicCandidateLibraryRepository ??
    createTopicCandidateLibraryRepository();
  const fallbackCandidates = options?.projectId
    ? await loadFallbackCandidates({
        db,
        input,
        repository: topicCandidateLibraryRepository,
        existingRankings: postProcessed.rankings,
      })
    : {
        rankings: [],
        selectorPool: [],
        diagnostics: [],
      };
  const selectorRankings = [
    ...postProcessed.rankings,
    ...fallbackCandidates.rankings,
  ];
  const selectorPool = [
    ...postProcessed.selectorPool,
    ...fallbackCandidates.selectorPool,
  ];
  const selected = selectorPool.length >= TOPIC_CANDIDATE_TARGET_COUNT
    ? await selectFinalCandidatesWithTrace({
        input,
        llmGateway: gateway,
        selectorPool,
        recentEventMemory,
        rankings: selectorRankings,
        interactionLogWriter,
      })
    : {
        candidates: selectorRankings
          .slice(0, TOPIC_CANDIDATE_TARGET_COUNT)
          .map((entry) => entry.candidate),
        rankings: selectorRankings.slice(0, TOPIC_CANDIDATE_TARGET_COUNT),
        selectorTrace: null,
        diagnostics: [...fallbackCandidates.diagnostics],
      };
  const candidatePreviewTrace = buildCandidatePreviewTrace({
    rawCandidates: result.candidates,
    rankings: selectorRankings,
    selectorPool,
    finalRankings: selected.rankings,
    selectorTrace: selected.selectorTrace,
  });
  const finalDiagnostics = finalizeRecommendationDiagnostics({
    checks: result.diagnostics.checks,
    finalCandidateCount: selected.candidates.length,
    additionalChecks: [
      ...postProcessed.diagnostics,
      ...fallbackCandidates.diagnostics,
      ...selected.diagnostics,
    ],
    candidatePreviewTrace,
  });

  if (project) {
    writeRecommendationDiagnosticsMarkdown({
      project,
      runId,
      diagnostics: finalDiagnostics.checks,
      candidates: selected.candidates,
      annotations: postProcessed.annotations,
    });
  }

  if (!options?.projectId) {
    return {
      ...result,
      raw_candidates: result.candidates,
      selector_pool: selectorPool,
      selector_trace: selected.selectorTrace,
      candidates: selected.candidates,
      diagnostics: finalDiagnostics,
    };
  }

  if (project) {
    project.latestTopicRunTraceJson = result.trace as unknown as Record<string, unknown>;
    persistProjectRunArtifacts({
      project,
      phase: "topic",
      runId,
      traceSummary: result.trace as unknown as Record<string, unknown>,
      runtimeDiagnostics: finalDiagnostics as Record<string, unknown>,
    });
  }

  await persistTopicCandidateLibraryEntries({
    input,
    projectId: options.projectId,
    runId,
    rawCandidates: result.candidates,
    selectorPool,
    finalRankings: selected.rankings,
    repository: topicCandidateLibraryRepository,
    persistedAt: recommendationStartedAt,
  });

  await persistPostProcessedCandidates(db, {
    projectId: options.projectId,
    candidates: selected.rankings,
  });
  await recordProjectRecommendationRound(db, {
    projectId: options.projectId,
    createdAt: recommendationStartedAt,
    candidates: selected.rankings.map((candidate) => ({
      eventRegistryEntryId: candidate.eventId,
      eventIdentity: candidate.eventIdentity,
      title: candidate.candidate.title,
      fingerprint: candidate.fingerprint,
    })),
  });

  const previousRoundCount = db.topicRunCounts.get(options.projectId) ?? 0;
  const roundIndex = previousRoundCount + 1;
  db.topicRunCounts.set(options.projectId, roundIndex);

  return {
    ...result,
    raw_candidates: result.candidates,
    selector_pool: selectorPool,
    selector_trace: selected.selectorTrace,
    candidates: selected.candidates,
    diagnostics: finalDiagnostics,
    topic_run: {
      project_id: options.projectId,
      round_id: `topic_run_${db.generateId()}`,
      round_index: roundIndex,
      previous_round_count: previousRoundCount,
    },
  };
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    interactionLogWriter?.writeError(message);
    throw error;
  }
}

export async function recommendTopicCandidates(
  db: DbClient,
  input: BuildTopicCandidatesInput,
  options?: TopicRecommendationOptions,
) {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);

  return result.candidates;
}

function createTopicRecommendationGateway(): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubTopicRecommendationProvider()
      : createOpenAiCompatibleProvider({});

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createStubTopicRecommendationProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      const candidates = request.operationName === "topic.selector"
        ? (createDefaultSelectorDecision(
            (request.input as { selector_pool?: Array<{ candidate_id: string }> })
              .selector_pool ?? [],
          ) as T)
        : (buildTopicCandidates(
            request.input as BuildTopicCandidatesInput,
          ) as T);

      await request.interactionLogWriter?.write({
        generatedAt: new Date().toISOString(),
        provider: "stub",
        model: "stub",
        operationName: request.operationName,
        promptId: request.prompt.metadata.id,
        promptStage: request.prompt.metadata.stage,
        promptLanguage: request.prompt.metadata.language,
        promptFilePath: request.prompt.filePath,
        systemPrompt: request.prompt.body,
        input: request.input,
        rawOutput: JSON.stringify(candidates, null, 2),
        parsedOutput: candidates,
        errorMessage: null,
      });

      return candidates;
    },
  };
}

async function invokeTopicStructuredPromptWithSafetyRetry<T>(input: {
  gateway: LlmGateway;
  promptId: string;
  promptInput: unknown;
  interactionLogWriter?: LlmInteractionLogWriter;
}): Promise<T> {
  try {
    return await input.gateway.invokeStructuredPrompt<T>({
      promptId: input.promptId,
      input: input.promptInput,
      interactionLogWriter: input.interactionLogWriter,
    });
  } catch (error) {
    if (!isProviderContentFilterError(error)) {
      throw error;
    }

    try {
      return await input.gateway.invokeStructuredPrompt<T>({
        promptId: input.promptId,
        input: withTopicSafetyRetryContext(input.promptInput),
        interactionLogWriter: input.interactionLogWriter,
      });
    } catch {
      throw error;
    }
  }
}

async function invokeTopicStrictStructuredWithSafetyRetry<T>(input: {
  gateway: LlmGateway;
  options: InvokeStrictStructuredOptions<T>;
}): Promise<T> {
  try {
    return await input.gateway.invokeStrictStructured<T>(input.options);
  } catch (error) {
    if (!isProviderContentFilterError(error)) {
      throw error;
    }

    try {
      return await input.gateway.invokeStrictStructured<T>({
        ...input.options,
        input: withTopicSafetyRetryContext(input.options.input),
      });
    } catch {
      throw error;
    }
  }
}

function withTopicSafetyRetryContext(promptInput: unknown): unknown {
  const safetyRetryContext = {
    reason: "provider_content_filter",
    mode: "strict_neutral_historical_planning",
  } as const;

  if (
    promptInput &&
    typeof promptInput === "object" &&
    !Array.isArray(promptInput)
  ) {
    return {
      ...(promptInput as Record<string, unknown>),
      safety_retry_context: safetyRetryContext,
    };
  }

  return {
    original_input: promptInput,
    safety_retry_context: safetyRetryContext,
  };
}

export function isProviderContentFilterError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const code = record.code;
  const status = record.status ?? record.statusCode;
  const message = error instanceof Error ? error.message : "";
  const providerError = extractProviderErrorPayload(message);
  const codeText = String(code ?? providerError.code ?? "");
  const providerMessage = String(providerError.message ?? "");
  const combinedText = `${message}\n${providerMessage}`;
  const statusMatches =
    status === undefined || status === 400 || status === "400";

  return (
    statusMatches &&
    (code === 1301 ||
      code === "1301" ||
      codeText === "1301" ||
      /content[_ -]?filter/i.test(codeText) ||
      /content[_ -]?filter/i.test(combinedText) ||
      /不安全|敏感内容|安全策略/.test(combinedText))
  );
}

function extractProviderErrorPayload(message: string): {
  code?: unknown;
  message?: unknown;
} {
  const jsonStart = message.indexOf("{");
  if (jsonStart < 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(message.slice(jsonStart)) as {
      error?: {
        code?: unknown;
        message?: unknown;
      };
      code?: unknown;
      message?: unknown;
    };

    return {
      code: parsed.error?.code ?? parsed.code,
      message: parsed.error?.message ?? parsed.message,
    };
  } catch {
    return {};
  }
}

function createDefaultSelectorDecision(
  selectorPool: Array<{ candidate_id: string }>,
): TopicSelectorDecision {
  return {
    ranked_candidates: selectorPool.map((candidate, index) => ({
      candidate_id: candidate.candidate_id,
      quality_rank: index + 1,
      quality_score: Math.max(1, 100 - index),
      deductions: [],
      risk_summary: "stub selector ranking",
      consistency_status: "pass",
      primary_consistency_issue: "none",
      consistency_note: "stub selector consistency pass",
    })),
  };
}

type RecommendationCandidate = ReturnType<typeof TopicCandidateCard.parse>;

interface RankedRecommendationCandidate {
  candidateId: string;
  candidate: RecommendationCandidate;
  eventId: string;
  eventIdentity: string;
  fingerprint: string;
  originalIndex: number;
  fatigueScore: number;
  recentlySeen: boolean;
}

interface SelectorPoolCandidate {
  candidate_id: string;
  event_identity: string;
  normalized_event_identity: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  core_conflict: string;
  strong_scene: string;
  must_cover_preview: string[];
  risk_hints: string[];
  viral_rubric: RecommendationCandidate["viral_rubric"];
  fatigue_score: number;
  recently_seen: boolean;
}

interface RecentEventMemoryEntry {
  event_identity: string;
  title: string;
  one_line_angle: string;
}

interface SelectorTrace {
  selected_candidate_ids: string[];
  ranked_candidates: TopicSelectorRankedCandidate[];
  skipped_candidate_ids: string[];
  repair_attempts: number;
}

interface TopicCandidateLibrarySeedContext {
  seedFamily: string;
  seedProfile: string;
}

interface RecommendationDiagnostic {
  code: string;
  level: "info" | "warning" | "error";
  reason?: string;
}

type TopicRecommendationProject = NonNullable<
  DbClient["projects"] extends Map<string, infer T> ? T : never
>;

function toCandidatePreviewTraceEntry(input: {
  candidateId: string;
  candidate: RecommendationCandidate;
  scorecard?: TopicSelectorRankedCandidate;
}) {
  return {
    candidate_id: input.candidateId,
    event_identity: input.candidate.event_identity,
    title: input.candidate.title,
    one_line_angle: input.candidate.one_line_angle,
    must_cover_preview: input.candidate.must_cover_preview,
    ...(input.scorecard
      ? {
          quality_rank: input.scorecard.quality_rank,
          quality_score: input.scorecard.quality_score,
          deductions: input.scorecard.deductions,
          risk_summary: input.scorecard.risk_summary,
          consistency_status: input.scorecard.consistency_status,
          primary_consistency_issue: input.scorecard.primary_consistency_issue,
          consistency_note: input.scorecard.consistency_note,
        }
      : {}),
  };
}

function buildCandidatePreviewTrace(input: {
  rawCandidates: RecommendationCandidate[];
  rankings: RankedRecommendationCandidate[];
  selectorPool: SelectorPoolCandidate[];
  finalRankings: RankedRecommendationCandidate[];
  selectorTrace?: SelectorTrace | null;
}): CandidatePreviewTrace {
  const rankingsById = new Map(
    input.rankings.map((entry) => [entry.candidateId, entry] as const),
  );
  const scorecardsById = new Map(
    (input.selectorTrace?.ranked_candidates ?? []).map(
      (scorecard) => [scorecard.candidate_id, scorecard] as const,
    ),
  );

  return {
    raw_candidates: input.rawCandidates.map((candidate, index) =>
      toCandidatePreviewTraceEntry({
        candidateId: `raw_candidate_${index + 1}`,
        candidate,
      }),
    ),
    selector_pool: input.selectorPool
      .map((candidate) => rankingsById.get(candidate.candidate_id))
      .filter((entry): entry is RankedRecommendationCandidate => Boolean(entry))
      .map((entry) =>
        toCandidatePreviewTraceEntry({
          candidateId: entry.candidateId,
          candidate: entry.candidate,
          scorecard: scorecardsById.get(entry.candidateId),
        }),
      ),
    ranked_candidates: (input.selectorTrace?.ranked_candidates ?? [])
      .flatMap((scorecard) => {
        const entry = rankingsById.get(scorecard.candidate_id);

        return entry
          ? [toCandidatePreviewTraceEntry({
              candidateId: entry.candidateId,
              candidate: entry.candidate,
              scorecard,
            })]
          : [];
      }),
    final_candidates: input.finalRankings.map((entry) =>
      toCandidatePreviewTraceEntry({
        candidateId: entry.candidateId,
        candidate: entry.candidate,
        scorecard: scorecardsById.get(entry.candidateId),
      }),
    ),
  };
}

async function postProcessTopicCandidates(input: {
  db: DbClient;
  seedInput: BuildTopicCandidatesInput;
  candidates: RecommendationCandidate[];
  projectId?: string | null;
  createdBefore: Date;
  existingCacheRecordIds: string[];
}) {
  const historyUpperBound = new Date(input.createdBefore.getTime() + 1);
  const deduplicatedCandidates: Omit<
    RankedRecommendationCandidate,
    "fatigueScore" | "recentlySeen"
  >[] = [];
  const seenEventIdentities = new Set<string>();
  const duplicateReasons: string[] = [];

  for (const [originalIndex, candidate] of input.candidates.entries()) {
    const normalized = await normalizeEventInput(input.db, {
      rawInput: candidate.event_identity,
      canonicalQuotes: input.seedInput.canonicalQuotes,
      canonicalQuoteIntents: input.seedInput.canonicalQuoteIntents,
      sourceType: "system_recommendation",
    });
    const eventIdentity = normalizeEventIdentityValue(candidate.event_identity);
    const fingerprint = buildEventIdentityFingerprint({
      eventIdentity,
      angle: candidate.one_line_angle,
    });

    if (seenEventIdentities.has(eventIdentity)) {
      duplicateReasons.push(
        `${candidate.title}｜${candidate.one_line_angle} 与已保留候选事件 identity 重复`,
      );
      continue;
    }

    seenEventIdentities.add(eventIdentity);
    deduplicatedCandidates.push({
      candidateId: `selector_candidate_${originalIndex + 1}`,
      candidate,
      eventId: normalized.event.id,
      eventIdentity,
      fingerprint,
      originalIndex,
    });
  }

  if (deduplicatedCandidates.length === 1 && input.candidates.length > 1) {
    const anchoredEventIdentity = deduplicatedCandidates[0]?.eventIdentity;
    const allCandidatesShareSameEventIdentity =
      typeof anchoredEventIdentity === "string" &&
      input.candidates.every(
        (candidate) =>
          normalizeEventIdentityValue(candidate.event_identity) === anchoredEventIdentity,
      );

    if (allCandidatesShareSameEventIdentity && anchoredEventIdentity) {
      deduplicatedCandidates.length = 0;
      duplicateReasons.length = 0;
      const seenFingerprints = new Set<string>();

      for (const [originalIndex, candidate] of input.candidates.entries()) {
        const fingerprint = buildEventIdentityFingerprint({
          eventIdentity: anchoredEventIdentity,
          angle: candidate.one_line_angle,
        });

        if (seenFingerprints.has(fingerprint)) {
          duplicateReasons.push(
            `${candidate.title}｜${candidate.one_line_angle} 与已保留候选切口完全重复`,
          );
          continue;
        }

        seenFingerprints.add(fingerprint);
        const normalized = await normalizeEventInput(input.db, {
          rawInput: candidate.event_identity,
          sourceType: "system_recommendation",
        });

        deduplicatedCandidates.push({
          candidateId: `selector_candidate_${originalIndex + 1}`,
          candidate,
          eventId: normalized.event.id,
          eventIdentity: anchoredEventIdentity,
          fingerprint,
          originalIndex,
        });
      }
    }
  }

  const recentCandidates = input.projectId
    ? await listRecentCachedCandidates(input.db, {
      projectId: input.projectId,
      createdBefore: historyUpperBound,
      finalOnly: true,
      recordIds: input.existingCacheRecordIds,
    })
    : [];
  const recentProjectRounds = input.projectId
    ? await listRecentProjectRecommendationRounds(input.db, {
        projectId: input.projectId,
        createdBefore: historyUpperBound,
      })
    : [];
  const cacheFatigueByEventId = new Map<string, number>();
  const cacheFatigueByIdentity = new Map<string, number>();
  const roundFatigueByEventId = new Map<string, number>();
  const roundFatigueByIdentity = new Map<string, number>();

  for (const record of recentCandidates) {
    if (record.eventRegistryEntryId) {
      cacheFatigueByEventId.set(
        record.eventRegistryEntryId,
        (cacheFatigueByEventId.get(record.eventRegistryEntryId) ?? 0) + 1,
      );
    }

    if (record.eventIdentity) {
      const eventIdentity = normalizeEventIdentityValue(record.eventIdentity);
      cacheFatigueByIdentity.set(
        eventIdentity,
        (cacheFatigueByIdentity.get(eventIdentity) ?? 0) + 1,
      );
    }
  }

  for (const round of recentProjectRounds) {
    for (const candidate of round.candidates) {
      roundFatigueByEventId.set(
        candidate.eventRegistryEntryId,
        (roundFatigueByEventId.get(candidate.eventRegistryEntryId) ?? 0) + 1,
      );

      if (!candidate.eventIdentity) {
        continue;
      }
      const eventIdentity = normalizeEventIdentityValue(candidate.eventIdentity);

      roundFatigueByIdentity.set(
        eventIdentity,
        (roundFatigueByIdentity.get(eventIdentity) ?? 0) + 1,
      );
    }
  }

  const fatigueReasons: string[] = [];
  const rankings = deduplicatedCandidates
    .map((candidate) => {
      const cacheFatigueScore = Math.max(
        cacheFatigueByEventId.get(candidate.eventId) ?? 0,
        cacheFatigueByIdentity.get(candidate.eventIdentity) ?? 0,
      );
      const roundFatigueScore = Math.max(
        roundFatigueByEventId.get(candidate.eventId) ?? 0,
        roundFatigueByIdentity.get(candidate.eventIdentity) ?? 0,
      );
      const fatigueScore = Math.max(cacheFatigueScore, roundFatigueScore);
      if (fatigueScore > 0) {
        fatigueReasons.push(
          `${candidate.candidate.title}｜${candidate.candidate.one_line_angle} 命中近期历史 ${fatigueScore} 次`,
        );
      }

      return {
        ...candidate,
        fatigueScore,
        recentlySeen: fatigueScore > 0,
      };
    })
    .sort(
      (left, right) =>
        left.fatigueScore - right.fatigueScore ||
        left.originalIndex - right.originalIndex,
    );

  const diagnostics: RecommendationDiagnostic[] = [];
  if (duplicateReasons.length > 0) {
    diagnostics.push({
      code: "topic_candidate_duplicate_removed",
      level: "info",
      reason: `已剔除重复候选：${duplicateReasons.join("；")}`,
    });
  }
  if (fatigueReasons.length > 0) {
    diagnostics.push({
      code: "topic_candidate_fatigue_penalty_applied",
      level: "info",
      reason: `已对近期重复候选施加疲劳降权：${fatigueReasons.join("；")}`,
    });
  }

  const selectorPool: SelectorPoolCandidate[] = rankings.map((entry) => ({
    candidate_id: entry.candidateId,
    event_identity: entry.candidate.event_identity,
    normalized_event_identity: entry.eventIdentity,
    title: entry.candidate.title,
    one_line_angle: entry.candidate.one_line_angle,
    family_label: entry.candidate.family_label,
    scope_label: entry.candidate.scope_label,
    core_conflict: entry.candidate.core_conflict,
    strong_scene: entry.candidate.strong_scene,
    must_cover_preview: entry.candidate.must_cover_preview,
    risk_hints: entry.candidate.risk_hints,
    viral_rubric: entry.candidate.viral_rubric,
    fatigue_score: entry.fatigueScore,
    recently_seen: entry.recentlySeen,
  }));

  return {
    candidates: rankings
      .slice(0, TOPIC_CANDIDATE_TARGET_COUNT)
      .map((entry) => entry.candidate),
    rankings,
    selectorPool,
    diagnostics,
    annotations: [
      ...rankings.map(
        (entry, index) =>
          `候选保留：第 ${index + 1} 槽位 ${entry.candidate.title}｜${entry.candidate.one_line_angle}`,
      ),
      ...duplicateReasons.map((reason) => `候选剔除：${reason}`),
      ...fatigueReasons.map((reason) => `排序降权：${reason}`),
    ],
  };
}

function finalizeRecommendationDiagnostics(input: {
  checks: RecommendationDiagnostic[];
  finalCandidateCount: number;
  additionalChecks: RecommendationDiagnostic[];
  candidatePreviewTrace?: CandidatePreviewTrace;
}) {
  const checks = input.checks
    .filter((check) => {
    if (check.code === "topic_candidate_slot_guard_passed") {
      return input.finalCandidateCount === TOPIC_CANDIDATE_TARGET_COUNT;
    }

    if (check.code === "topic_candidate_slots_insufficient") {
      return input.finalCandidateCount < TOPIC_CANDIDATE_TARGET_COUNT;
    }

    return true;
    })
    .map((check) => enrichDiagnosticReason(check, input.finalCandidateCount));

  checks.push(...input.additionalChecks);

  if (
    input.finalCandidateCount === TOPIC_CANDIDATE_TARGET_COUNT &&
    !checks.some((check) => check.code === "topic_candidate_slot_guard_passed")
  ) {
    checks.push({
      code: "topic_candidate_slot_guard_passed",
      level: "info",
      reason: `最终保留 ${input.finalCandidateCount} 个候选，已满足目标槽位数`,
    });
  }

  if (
    input.finalCandidateCount < TOPIC_CANDIDATE_TARGET_COUNT &&
    !checks.some((check) => check.code === "topic_candidate_slots_insufficient")
  ) {
    checks.push({
      code: "topic_candidate_slots_insufficient",
      level: "error",
      reason: `最终仅保留 ${input.finalCandidateCount} 个候选，未满足目标槽位数 ${TOPIC_CANDIDATE_TARGET_COUNT}`,
    });
  }

  return {
    checks,
    candidate_preview_trace: input.candidatePreviewTrace,
  };
}

async function selectFinalCandidatesWithTrace(input: {
  input: BuildTopicCandidatesInput;
  llmGateway: LlmGateway;
  selectorPool: SelectorPoolCandidate[];
  recentEventMemory: RecentEventMemoryEntry[];
  rankings: RankedRecommendationCandidate[];
  interactionLogWriter?: LlmInteractionLogWriter;
}) {
  const diagnostics: RecommendationDiagnostic[] = [];
  const decision = await invokeTopicSelector({
    llmGateway: input.llmGateway,
    selectorInput: {
      recommendation_seed: input.input,
      selector_pool: projectTopicSelectorPool(input.selectorPool),
      recent_event_memory: input.recentEventMemory,
    },
    interactionLogWriter: input.interactionLogWriter,
  });

  const selection = selectRankedCandidates({
    decision,
    selectorPool: input.selectorPool,
    rankings: input.rankings,
  });

  if (selection.selected.length === 0) {
    throw new Error("topic_selector_empty_after_dedup");
  }

  if (selection.selectedRiskCandidateIds.length > 0) {
    diagnostics.push({
      code: "topic_selector_consistency_risk_backfill",
      level: "warning",
      reason: `一致性 pass 候选不足 ${TOPIC_CANDIDATE_TARGET_COUNT} 项，已按 Selector 原排名受控补入 ${selection.selectedRiskCandidateIds.length} 项：${selection.selectedRiskCandidateIds.join(", ")}`,
    });
  }

  return {
    candidates: selection.selected.map((entry) => entry.candidate),
    rankings: selection.selected,
    selectorTrace: {
      selected_candidate_ids: selection.selectedIds,
      ranked_candidates: selection.rankedCandidates,
      skipped_candidate_ids: selection.skippedCandidateIds,
      repair_attempts: 0,
    } satisfies SelectorTrace,
    diagnostics,
  };
}

async function invokeTopicSelector(input: {
  llmGateway: LlmGateway;
  selectorInput: unknown;
  interactionLogWriter?: LlmInteractionLogWriter;
}): Promise<TopicSelectorDecision> {
  if ((input.llmGateway as unknown as Record<string, unknown>).invokeStrictStructured) {
    try {
      return await invokeTopicStrictStructuredWithSafetyRetry<TopicSelectorDecision>({
        gateway: input.llmGateway,
        options: {
          promptId: "topic.selector",
          input: input.selectorInput,
          schema: TOPIC_SELECTOR_STRICT_SCHEMA,
          parse: parseStrictSelectorDecision,
          options: {
            strategy: "tool_call",
            thinking: "disabled",
            // Task 10：capability probe 已证明当前 provider/API 路由支持指定目标 function，
            // 显式强制目标 function 以提升结构可靠性。返回错误工具或缺少目标工具时
            // provider 会抛 strict_structured_target_tool_mismatch / strict_structured_no_tool_call，
            // 由 shouldFallbackToStructuredSelector 进入既有受控 structured fallback。
            toolChoice: "target_function",
          },
          interactionLogWriter: input.interactionLogWriter,
        },
      });
    } catch (error) {
      if (shouldFallbackToStructuredSelector(error)) {
        return normalizeSelectorDecision(
          await invokeTopicStructuredPromptWithSafetyRetry<unknown>({
            gateway: input.llmGateway,
            promptId: "topic.selector",
            promptInput: input.selectorInput,
            interactionLogWriter: input.interactionLogWriter,
          }),
        );
      }

      throw error;
    }
  }

  return normalizeSelectorDecision(
    await invokeTopicStructuredPromptWithSafetyRetry<unknown>({
      gateway: input.llmGateway,
      promptId: "topic.selector",
      promptInput: input.selectorInput,
      interactionLogWriter: input.interactionLogWriter,
    }),
  );
}

function shouldFallbackToStructuredSelector(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "strict_structured_provider_not_supported",
    "strict_structured_no_tool_call",
    "strict_structured_target_tool_mismatch",
    "strict_structured_strategy_not_supported",
    "topic_selector_strict_schema_failed",
    "strict_selector_bad_scorecard",
    "LLM API key or base URL is not configured.",
    "Unexpected token",
    "is not valid JSON",
    "invalid tool arguments",
  ].some((pattern) => error.message.includes(pattern));
}

export function parseStrictSelectorDecision(rawOutput: unknown): TopicSelectorDecision {
  if (!rawOutput || typeof rawOutput !== "object" || Array.isArray(rawOutput)) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  const record = rawOutput as Record<string, unknown>;
  const rankedCandidates = record.ranked_candidates;

  if (!Array.isArray(rankedCandidates)) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  const extraKeys = Object.keys(record).filter(
    (key) => key !== "ranked_candidates",
  );
  if (extraKeys.length > 0) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  return {
    ranked_candidates: parseSelectorScorecards(
      rankedCandidates,
      "topic_selector_strict_schema_failed",
    ),
  };
}

function normalizeSelectorDecision(rawOutput: unknown): TopicSelectorDecision {
  if (!rawOutput || typeof rawOutput !== "object") {
    throw new Error("topic_selector_not_object");
  }

  const record = rawOutput as Record<string, unknown>;
  const answerRecord =
    record.answer && typeof record.answer === "object" && !Array.isArray(record.answer)
      ? (record.answer as Record<string, unknown>)
      : null;
  const rankedCandidates =
    (Array.isArray(record.answer) ? record.answer : undefined) ??
    answerRecord?.ranked_candidates ??
    answerRecord?.rankedCandidates ??
    (record.rank_topic_candidates &&
     typeof record.rank_topic_candidates === "object" &&
     !Array.isArray(record.rank_topic_candidates)
      ? (record.rank_topic_candidates as Record<string, unknown>).ranked_candidates
      : undefined) ??
    record.ranked_candidates ??
    record.rankedCandidates;

  if (!Array.isArray(rankedCandidates)) {
    throw new Error("topic_selector_no_ranked_array");
  }

  return {
    ranked_candidates: parseSelectorScorecards(
      rankedCandidates,
      "topic_selector_bad_scorecard",
    ),
  };
}

function parseSelectorScorecards(
  rawScorecards: unknown[],
  errorCode: "topic_selector_bad_scorecard" | "topic_selector_strict_schema_failed",
): TopicSelectorRankedCandidate[] {
  const seenRanks = new Set<number>();
  const result: TopicSelectorRankedCandidate[] = [];
  const isStrict = errorCode === "topic_selector_strict_schema_failed";
  const prefix = isStrict ? "strict_selector_bad_scorecard" : "selector_bad_scorecard";

  for (let i = 0; i < rawScorecards.length; i++) {
    const rawScorecard = rawScorecards[i];
    const idx = `index ${i}`;

    if (
      !rawScorecard ||
      typeof rawScorecard !== "object" ||
      Array.isArray(rawScorecard)
    ) {
      throw new Error(`${prefix}: ${idx} is not a valid scorecard object`);
    }

    const record = rawScorecard as Record<string, unknown>;
    const candidateId = record.candidate_id;

    if (typeof candidateId !== "string") {
      throw new Error(`${prefix}: ${idx} missing string candidate_id, got ${typeof candidateId}`);
    }

    const idxLabel = `candidate ${candidateId}`;

    const qualityRank = record.quality_rank;
    if (typeof qualityRank !== "number" || !Number.isInteger(qualityRank)) {
      throw new Error(`${prefix}: ${idxLabel} quality_rank must be integer, got ${typeof qualityRank} (${JSON.stringify(qualityRank)})`);
    }
    if (qualityRank < 1) {
      throw new Error(`${prefix}: ${idxLabel} quality_rank ${qualityRank} < 1`);
    }

    const qualityScore = record.quality_score;
    if (typeof qualityScore !== "number" || !Number.isInteger(qualityScore)) {
      throw new Error(`${prefix}: ${idxLabel} quality_score must be integer, got ${typeof qualityScore} (${JSON.stringify(qualityScore)})`);
    }
    if (qualityScore < 0 || qualityScore > 100) {
      throw new Error(`${prefix}: ${idxLabel} quality_score ${qualityScore} out of [0,100]`);
    }

    const deductions = record.deductions;
    if (!Array.isArray(deductions)) {
      throw new Error(`${prefix}: ${idxLabel} deductions must be array, got ${typeof deductions}`);
    }

    const riskSummary = record.risk_summary;
    if (typeof riskSummary !== "string") {
      throw new Error(`${prefix}: ${idxLabel} risk_summary must be string, got ${typeof riskSummary}`);
    }

    const consistencyStatus = record.consistency_status;
    if (
      typeof consistencyStatus !== "string" ||
      !TOPIC_CONSISTENCY_STATUSES.includes(
        consistencyStatus as TopicConsistencyStatus,
      )
    ) {
      throw new Error(
        `${prefix}: ${idxLabel} consistency_status is invalid`,
      );
    }

    const primaryConsistencyIssue = record.primary_consistency_issue;
    if (
      typeof primaryConsistencyIssue !== "string" ||
      !TOPIC_CONSISTENCY_ISSUES.includes(
        primaryConsistencyIssue as TopicConsistencyIssue,
      )
    ) {
      throw new Error(
        `${prefix}: ${idxLabel} primary_consistency_issue is invalid`,
      );
    }

    if (
      (consistencyStatus === "pass" && primaryConsistencyIssue !== "none") ||
      (consistencyStatus === "risk" && primaryConsistencyIssue === "none")
    ) {
      throw new Error(
        `${prefix}: ${idxLabel} consistency status and issue disagree`,
      );
    }

    const consistencyNote = record.consistency_note;
    if (typeof consistencyNote !== "string" || consistencyNote.trim().length === 0) {
      throw new Error(
        `${prefix}: ${idxLabel} consistency_note must be non-empty string`,
      );
    }

    if (seenRanks.has(qualityRank)) {
      continue;
    }
    seenRanks.add(qualityRank);

    result.push({
      candidate_id: candidateId,
      quality_rank: qualityRank,
      quality_score: qualityScore,
      deductions: parseSelectorDeductions(deductions, `${prefix}: ${idxLabel}`),
      risk_summary: riskSummary,
      consistency_status: consistencyStatus as TopicConsistencyStatus,
      primary_consistency_issue: primaryConsistencyIssue as TopicConsistencyIssue,
      consistency_note: consistencyNote.trim(),
    });
  }

  return result;
}

function parseSelectorDeductions(
  rawDeductions: unknown[],
  errorLabel: string,
): TopicSelectorRankedCandidate["deductions"] {
  return rawDeductions.map((rawDeduction, j) => {
    const dLabel = `${errorLabel} deduction[${j}]`;
    if (
      !rawDeduction ||
      typeof rawDeduction !== "object" ||
      Array.isArray(rawDeduction)
    ) {
      throw new Error(`${dLabel}: not a valid deduction object`);
    }

    const record = rawDeduction as Record<string, unknown>;
    const axis = record.axis;

    if (typeof axis !== "string") {
      throw new Error(`${dLabel}: invalid fields (axis=${JSON.stringify(axis)} points_lost=${JSON.stringify(record.points_lost)} reason=${JSON.stringify(record.reason)})`);
    }

    let pointsLost: number;
    const rawPointsLost = record.points_lost;
    if (typeof rawPointsLost === "number" && Number.isInteger(rawPointsLost)) {
      pointsLost = rawPointsLost;
    } else {
      pointsLost = 1;
    }

    let reason: string;
    const rawReason = record.reason;
    if (typeof rawReason === "string") {
      reason = rawReason;
    } else {
      reason = `扣分项：${axis}`;
    }

    if (pointsLost < 1 || pointsLost > 30) {
      pointsLost = Math.max(1, Math.min(30, pointsLost));
    }

    return {
      axis,
      points_lost: pointsLost,
      reason,
    };
  });
}

function selectRankedCandidates(input: {
  decision: TopicSelectorDecision;
  selectorPool: SelectorPoolCandidate[];
  rankings: RankedRecommendationCandidate[];
}) {
  const rankingsById = new Map(
    input.rankings.map((candidate) => [candidate.candidateId, candidate] as const),
  );
  const knownIds = new Set(input.selectorPool.map((candidate) => candidate.candidate_id));
  const coveredKnownIds = new Set<string>();
  const skippedCandidateIds: string[] = [];

  for (const scorecard of input.decision.ranked_candidates) {
    if (!knownIds.has(scorecard.candidate_id)) {
      throw new Error(`topic_selector_unknown_candidate: ${scorecard.candidate_id}`);
    }
    coveredKnownIds.add(scorecard.candidate_id);
  }

  for (const candidateId of knownIds) {
    if (!coveredKnownIds.has(candidateId)) {
      skippedCandidateIds.push(candidateId);
    }
  }

  const allowRepeatedEventIdentities =
    new Set(input.selectorPool.map((candidate) => candidate.normalized_event_identity)).size === 1;
  const selected: RankedRecommendationCandidate[] = [];
  const selectedIds: string[] = [];
  const selectedEventIdentities = new Set<string>();
  const seenCandidateIds = new Set<string>();
  const selectedRiskCandidateIds: string[] = [];
  const rankedCandidates = [...input.decision.ranked_candidates].sort(
    (left, right) => {
      const leftRanking = rankingsById.get(left.candidate_id);
      const rightRanking = rankingsById.get(right.candidate_id);
      return (
        (leftRanking?.fatigueScore ?? 0) - (rightRanking?.fatigueScore ?? 0) ||
        (left.consistency_status === "pass" ? 0 : 1) -
          (right.consistency_status === "pass" ? 0 : 1) ||
        left.quality_rank - right.quality_rank ||
        right.quality_score - left.quality_score
      );
    },
  );

  for (const scorecard of rankedCandidates) {
    if (seenCandidateIds.has(scorecard.candidate_id)) {
      skippedCandidateIds.push(scorecard.candidate_id);
      continue;
    }
    seenCandidateIds.add(scorecard.candidate_id);

    const match = rankingsById.get(scorecard.candidate_id);
    if (!match) {
      throw new Error(`topic_selector_no_ranking_match: ${scorecard.candidate_id}`);
    }

    // Recent events are a hard exclusion whenever fresh candidates are present
    // in the selector pool; fatigue must not merely influence model ranking.
    if (match.fatigueScore > 0 && input.rankings.some((candidate) => candidate.fatigueScore === 0)) {
      skippedCandidateIds.push(scorecard.candidate_id);
      continue;
    }

    if (!allowRepeatedEventIdentities && selectedEventIdentities.has(match.eventIdentity)) {
      skippedCandidateIds.push(scorecard.candidate_id);
      continue;
    }

    selected.push(match);
    selectedIds.push(scorecard.candidate_id);
    if (scorecard.consistency_status === "risk") {
      selectedRiskCandidateIds.push(scorecard.candidate_id);
    }
    if (!allowRepeatedEventIdentities) {
      selectedEventIdentities.add(match.eventIdentity);
    }

    if (selected.length === TOPIC_CANDIDATE_TARGET_COUNT) {
      break;
    }
  }

  return {
    selected,
    selectedIds,
    rankedCandidates,
    skippedCandidateIds,
    selectedRiskCandidateIds,
  };
}

function enrichDiagnosticReason(
  check: RecommendationDiagnostic,
  finalCandidateCount: number,
): RecommendationDiagnostic {
  if (check.reason) {
    return check;
  }

  if (check.code === "topic_candidate_repair_triggered") {
    return {
      ...check,
      reason: `首轮原始候选不足 ${TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT} 个，已触发补位回填`,
    };
  }

  if (check.code === "topic_candidate_builder_repair_triggered") {
    return {
      ...check,
      reason: "builder 首轮候选缺少正式字段，已触发一次字段补全 repair",
    };
  }

  if (check.code === "topic_candidate_builder_repair_passed") {
    return {
      ...check,
      reason: "builder 字段补全 repair 后已满足 TopicCandidateCard 最小字段合同",
    };
  }

  if (check.code === "topic_candidate_builder_degraded") {
    return {
      ...check,
      reason: "builder 字段补全 repair 后仍有缺失字段，已降级为本地 fallback 结果",
    };
  }

  if (check.code === "topic_candidate_slots_insufficient") {
    return {
      ...check,
      reason: `最终仅保留 ${finalCandidateCount} 个候选，仍低于目标槽位数 ${TOPIC_CANDIDATE_TARGET_COUNT}`,
    };
  }

  return check;
}

async function buildRecentEventMemory(input: {
  db: DbClient;
  projectId?: string | null;
  createdBefore: Date;
  existingCacheRecordIds: string[];
}): Promise<RecentEventMemoryEntry[]> {
  if (!input.projectId) {
    return [];
  }

  const historyUpperBound = new Date(input.createdBefore.getTime() + 1);
  const recentRounds = await listRecentProjectRecommendationRounds(input.db, {
    projectId: input.projectId,
    createdBefore: historyUpperBound,
    limit: 3,
  });
  const recentCandidates = await listRecentCachedCandidates(input.db, {
    projectId: input.projectId,
    createdBefore: historyUpperBound,
    finalOnly: true,
    recordIds: input.existingCacheRecordIds,
    limit: 12,
  });
  const recentCandidatesByIdentity = new Map(
    recentCandidates
      .filter((candidate) => candidate.eventIdentity)
      .map((candidate) => [
        normalizeEventIdentityValue(candidate.eventIdentity as string),
        candidate,
      ] as const),
  );
  const recentEventMemory: RecentEventMemoryEntry[] = [];
  const seenEventIdentities = new Set<string>();

  for (const round of recentRounds) {
    for (const candidate of round.candidates) {
      if (!candidate.eventIdentity) {
        continue;
      }

      const normalizedIdentity = normalizeEventIdentityValue(candidate.eventIdentity);
      if (seenEventIdentities.has(normalizedIdentity)) {
        continue;
      }

      const cachedCandidate = recentCandidatesByIdentity.get(normalizedIdentity);
      const [, fingerprintAngle = ""] = candidate.fingerprint.split("::");

      recentEventMemory.push({
        event_identity: candidate.eventIdentity,
        title: candidate.title ?? candidate.eventIdentity,
        one_line_angle: cachedCandidate?.oneLineAngle ?? fingerprintAngle,
      });
      seenEventIdentities.add(normalizedIdentity);
    }
  }

  return recentEventMemory;
}

async function persistPostProcessedCandidates(
  db: DbClient,
  input: {
    projectId: string;
    candidates: RankedRecommendationCandidate[];
  },
) {
  for (const candidate of input.candidates) {
    await saveCachedCandidate(db, {
      projectId: input.projectId,
      eventRegistryEntryId: candidate.eventId,
      eventIdentity: candidate.eventIdentity,
      fingerprint: candidate.fingerprint,
      oneLineAngle: candidate.candidate.one_line_angle,
      familyLabel: candidate.candidate.family_label,
      scopeLabel: candidate.candidate.scope_label,
      viralRubricJson: candidate.candidate.viral_rubric,
      estimatedDurationBandJson: candidate.candidate.estimated_duration_band,
      strongScene: candidate.candidate.strong_scene,
      coreConflict: candidate.candidate.core_conflict,
      mustCoverPreviewJson: candidate.candidate.must_cover_preview,
      sourceHint: candidate.candidate.source_hint,
      recentUsageHint: candidate.candidate.recent_usage_hint,
      whyThisNow: candidate.candidate.why_this_now,
      riskHintsJson: candidate.candidate.risk_hints,
    });
  }
}

async function loadFallbackCandidates(input: {
  db: DbClient;
  input: BuildTopicCandidatesInput;
  repository: TopicCandidateLibraryRepository;
  existingRankings: RankedRecommendationCandidate[];
}) {
  const seedContext = buildTopicCandidateLibrarySeedContext(input.input);
  const fallbackDocuments = await input.repository.listBySeed({
    seedFamily: seedContext.seedFamily,
    seedProfile: seedContext.seedProfile,
    statuses: ["fallback_ready"],
  });
  const existingEventIdentities = new Set(
    input.existingRankings.map((candidate) => candidate.eventIdentity),
  );
  const diagnostics: RecommendationDiagnostic[] = [];
  const fallbackRankings: RankedRecommendationCandidate[] = [];

  for (const [index, document] of fallbackDocuments.entries()) {
    const eventIdentity = normalizeEventIdentityValue(document.eventIdentity);
    if (existingEventIdentities.has(eventIdentity)) {
      continue;
    }

    const normalized = await normalizeEventInput(input.db, {
      rawInput: document.eventIdentity,
      sourceType: "system_recommendation",
    });
    const candidate = TopicCandidateCard.parse({
      event_identity: document.eventIdentity,
      title: document.title,
      one_line_angle: document.oneLineAngle,
      family_label: document.familyLabel ?? "通用安全槽位",
      scope_label: document.scopeLabel ?? "单事件",
      estimated_duration_band: "medium",
      why_this_now: "同 seed family/profile 下的受控 fallback 候选。",
      core_conflict: document.notes?.trim() || "受控 fallback 候选，等待 selector 再决策。",
      strong_scene: document.oneLineAngle,
      must_cover_preview: [document.oneLineAngle],
      risk_hints: ["fallback 候选仍需经过 selector，不得直接顶替最终结果"],
      source_hint: `topic-candidate-library:${document.sourceProjectId}`,
      recent_usage_hint: "受控 fallback 复用",
      viral_rubric: {
        hook_power: "medium",
        novelty_gap: "medium",
        emotion_gap: "medium",
        share_impulse: "medium",
        visual_promise: "medium",
      },
    });
    const fingerprint = buildEventIdentityFingerprint({
      eventIdentity,
      angle: candidate.one_line_angle,
    });

    fallbackRankings.push({
      candidateId: `fallback_candidate_${index + 1}`,
      candidate,
      eventId: normalized.event.id,
      eventIdentity,
      fingerprint,
      originalIndex: input.existingRankings.length + index,
      fatigueScore: 0,
      recentlySeen: false,
    });
    existingEventIdentities.add(eventIdentity);
  }

  if (fallbackRankings.length > 0) {
    diagnostics.push({
      code: "topic_candidate_library_fallback_loaded",
      level: "info",
      reason: `已从同 seed family/profile 的候选库加载 ${fallbackRankings.length} 个 fallback 候选进入 selector pool`,
    });
  }

  return {
    rankings: fallbackRankings,
    selectorPool: fallbackRankings.map((entry) => ({
      candidate_id: entry.candidateId,
      event_identity: entry.candidate.event_identity,
      normalized_event_identity: entry.eventIdentity,
      title: entry.candidate.title,
      one_line_angle: entry.candidate.one_line_angle,
      family_label: entry.candidate.family_label,
      scope_label: entry.candidate.scope_label,
      core_conflict: entry.candidate.core_conflict,
      strong_scene: entry.candidate.strong_scene,
      must_cover_preview: entry.candidate.must_cover_preview,
      risk_hints: entry.candidate.risk_hints,
      viral_rubric: entry.candidate.viral_rubric,
      fatigue_score: entry.fatigueScore,
      recently_seen: entry.recentlySeen,
    })),
    diagnostics,
  };
}

async function persistTopicCandidateLibraryEntries(input: {
  input: BuildTopicCandidatesInput;
  projectId: string;
  runId: string;
  rawCandidates: RecommendationCandidate[];
  selectorPool: SelectorPoolCandidate[];
  finalRankings: RankedRecommendationCandidate[];
  repository: TopicCandidateLibraryRepository;
  persistedAt: Date;
}) {
  const seedContext = buildTopicCandidateLibrarySeedContext(input.input);
  const persistedAtIso = input.persistedAt.toISOString();

  for (const [index, candidate] of input.rawCandidates.entries()) {
    await input.repository.save({
      candidateId: `raw-${input.runId}-${index + 1}`,
      seedFamily: seedContext.seedFamily,
      seedProfile: seedContext.seedProfile,
      status: "raw_generated",
      sourceProjectId: input.projectId,
      sourceTopicRunId: input.runId,
      eventIdentity: candidate.event_identity,
      title: candidate.title,
      oneLineAngle: candidate.one_line_angle,
      familyLabel: candidate.family_label,
      scopeLabel: candidate.scope_label,
      firstGeneratedAt: persistedAtIso,
      timesSelected: 0,
      timesSeenInPool: 0,
      notes: buildTopicCandidateLibraryNotes("raw_generated"),
    });
  }

  for (const candidate of input.selectorPool) {
    await input.repository.save({
      candidateId: `selector-pool-${input.runId}-${candidate.candidate_id}`,
      seedFamily: seedContext.seedFamily,
      seedProfile: seedContext.seedProfile,
      status: "selector_pool",
      sourceProjectId: input.projectId,
      sourceTopicRunId: input.runId,
      eventIdentity: candidate.event_identity,
      title: candidate.title,
      oneLineAngle: candidate.one_line_angle,
      familyLabel: candidate.family_label,
      scopeLabel: candidate.scope_label,
      firstGeneratedAt: persistedAtIso,
      timesSelected: 0,
      timesSeenInPool: 1,
      notes: buildTopicCandidateLibraryNotes("selector_pool"),
    });
  }

  for (const candidate of input.finalRankings) {
    await input.repository.save({
      candidateId: `final-selected-${input.runId}-${candidate.candidateId}`,
      seedFamily: seedContext.seedFamily,
      seedProfile: seedContext.seedProfile,
      status: "final_selected",
      sourceProjectId: input.projectId,
      sourceTopicRunId: input.runId,
      eventIdentity: candidate.candidate.event_identity,
      title: candidate.candidate.title,
      oneLineAngle: candidate.candidate.one_line_angle,
      familyLabel: candidate.candidate.family_label,
      scopeLabel: candidate.candidate.scope_label,
      firstGeneratedAt: persistedAtIso,
      lastSelectedAt: persistedAtIso,
      timesSelected: 1,
      timesSeenInPool: 1,
      notes: buildTopicCandidateLibraryNotes("final_selected"),
    });
  }
}

function buildTopicCandidateLibrarySeedContext(
  input: BuildTopicCandidatesInput,
): TopicCandidateLibrarySeedContext {
  return {
    seedFamily: input.familyHint?.trim() || input.canonicalName.trim(),
    seedProfile: input.canonicalName.trim(),
  };
}

function buildTopicCandidateLibraryNotes(status: string) {
  return `## 系统备注

- 沉淀状态：${status}
- 由 topic recommendation runtime 自动写入
`;
}

function writeRecommendationDiagnosticsMarkdown(input: {
  project: TopicRecommendationProject;
  runId: string;
  diagnostics: RecommendationDiagnostic[];
  candidates: RecommendationCandidate[];
  annotations: string[];
}) {
  const profile = getProjectStorageProfile(input.project);
  const runDir = resolve(process.cwd(), profile.topic_runs_dir, input.runId);

  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    resolve(runDir, "recommendation-diagnostics.md"),
    renderRecommendationDiagnosticsMarkdown({
      generatedAt: new Date().toISOString(),
      diagnostics: input.diagnostics,
      candidates: input.candidates.map((candidate) => ({
        event_identity: candidate.event_identity,
        title: candidate.title,
        one_line_angle: candidate.one_line_angle,
      })),
      annotations: input.annotations,
    }),
    "utf8",
  );

  /*
  return {
    generatedAt: new Date().toISOString(),
    provider: "runtime",
    model: "post-process",
    operationName: "topic.candidate-builder.diagnostics",
    promptId: prompt.metadata.id,
    promptStage: prompt.metadata.stage,
    promptLanguage: prompt.metadata.language,
    promptFilePath: prompt.filePath,
    systemPrompt:
      "记录开放发现推荐在本地后处理阶段的保留、剔除、降权与补位归因，不重新生成候选。",
    input: {
      canonicalName: input.input.canonicalName,
      tags: input.input.tags ?? [],
    },
    rawOutput: JSON.stringify(
      {
        diagnostics: input.diagnostics,
        candidates: input.candidates,
      },
      null,
      2,
    ),
    parsedOutput: {
      diagnostics: input.diagnostics,
      candidates: input.candidates,
    },
    annotations: input.annotations.length > 0
      ? input.annotations
      : ["候选保留：本轮未触发额外过滤或降权"],
    errorMessage: null,
  };
  */
}
