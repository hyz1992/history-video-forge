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
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { renderRecommendationDiagnosticsMarkdown } from "../../runtime/llm/interaction-log.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { runTopicRecommendationGraph } from "../../runtime/orchestration/topic-recommendation-graph.js";
import {
  TOPIC_CANDIDATE_TARGET_COUNT,
  TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT,
} from "../../runtime/orchestration/topic-recommendation-nodes.js";
import {
  createProjectRunInteractionLogWriter,
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

export interface TopicRecommendationOptions {
  llmGateway?: LlmGateway;
  projectId?: string | null;
  topicCandidateLibraryRepository?: TopicCandidateLibraryRepository;
}

interface TopicSelectorDecision {
  selected_candidate_ids: string[];
}

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
    ? createProjectRunInteractionLogWriter({
        project,
        phase: "topic",
        runId,
      })
    : undefined;
  const result = await runTopicRecommendationGraph(
    {
      db,
      input: graphInput,
      projectId: options?.projectId ?? null,
      runId,
    },
    {
      invokeStructuredPrompt: (runnerInput) =>
        gateway.invokeStructuredPrompt<unknown[]>({
          ...runnerInput,
          interactionLogWriter,
      }),
    },
  );
  const postProcessed = await postProcessTopicCandidates({
    db,
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
  const finalDiagnostics = finalizeRecommendationDiagnostics({
    checks: result.diagnostics.checks,
    finalCandidateCount: selected.candidates.length,
    additionalChecks: [
      ...postProcessed.diagnostics,
      ...fallbackCandidates.diagnostics,
      ...selected.diagnostics,
    ],
  });

  if (project) {
    writeRecommendationDiagnosticsMarkdown({
      project,
      runId,
      diagnostics: finalDiagnostics.checks,
      candidates: postProcessed.candidates,
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
    project.latestTopicRunTraceJson = result.trace as Record<string, unknown>;
    persistProjectRunArtifacts({
      project,
      phase: "topic",
      runId,
      traceSummary: result.trace as Record<string, unknown>,
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
    async invokeStructuredPrompt<T>(request): Promise<T> {
      const candidates = request.operationName === "topic.selector"
        ? ({
            selected_candidate_ids: (
              (request.input as { selector_pool?: Array<{ candidate_id: string }> })
                .selector_pool ?? []
            )
              .slice(0, TOPIC_CANDIDATE_TARGET_COUNT)
              .map((candidate) => candidate.candidate_id),
          } as T)
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

async function postProcessTopicCandidates(input: {
  db: DbClient;
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
  };
}

async function selectFinalCandidatesWithTrace(input: {
  input: BuildTopicCandidatesInput;
  llmGateway: LlmGateway;
  selectorPool: SelectorPoolCandidate[];
  recentEventMemory: RecentEventMemoryEntry[];
  rankings: RankedRecommendationCandidate[];
  interactionLogWriter?: {
    write: (...args: unknown[]) => Promise<void> | void;
  };
}) {
  const diagnostics: RecommendationDiagnostic[] = [];
  const firstDecision = normalizeSelectorDecision(
    await input.llmGateway.invokeStructuredPrompt<unknown>({
      promptId: "topic.selector",
      input: {
        recommendation_seed: input.input,
        selector_pool: input.selectorPool,
        recent_event_memory: input.recentEventMemory,
      },
      interactionLogWriter: input.interactionLogWriter,
    }),
  );
  const firstPass = inspectSelectorDecision({
    decision: firstDecision,
    selectorPool: input.selectorPool,
    rankings: input.rankings,
  });

  let finalSelection = firstPass.selected;
  let finalIds = [...firstPass.selectedIds];
  let repairAttempts = 0;

  if (firstPass.missingSlotCount > 0) {
    repairAttempts = 1;
    diagnostics.push({
      code: "topic_selector_repair_triggered",
      level: "info",
      reason: `selector 首轮仅返回 ${firstPass.selectedIds.length} 个有效候选，已触发一次受控补位`,
    });

    const repairDecision = normalizeSelectorDecision(
      await input.llmGateway.invokeStructuredPrompt<unknown>({
        promptId: "topic.selector",
        input: {
          recommendation_seed: input.input,
          selector_pool: input.selectorPool,
          recent_event_memory: input.recentEventMemory,
          repair_context: {
            missing_slot_count: firstPass.missingSlotCount,
            kept_candidate_ids: firstPass.selectedIds,
            excluded_candidate_ids: firstPass.excludedCandidateIds,
            excluded_event_identities: firstPass.excludedEventIdentities,
          },
        },
        interactionLogWriter: input.interactionLogWriter,
      }),
    );

    const repairPass = inspectSelectorDecision({
      decision: repairDecision,
      selectorPool: input.selectorPool,
      rankings: input.rankings,
      allowedCount: firstPass.missingSlotCount,
      excludedCandidateIds: new Set(firstPass.excludedCandidateIds),
      excludedEventIdentities: new Set(firstPass.excludedEventIdentities),
    });

    if (repairPass.missingSlotCount > 0) {
      throw new Error("topic_selector_invalid_selection");
    }

    finalSelection = [...firstPass.selected, ...repairPass.selected];
    finalIds = [...firstPass.selectedIds, ...repairPass.selectedIds];
  }

  if (finalSelection.length !== TOPIC_CANDIDATE_TARGET_COUNT) {
    throw new Error("topic_selector_invalid_selection");
  }

  return {
    candidates: finalSelection.map((entry) => entry.candidate),
    rankings: finalSelection,
    selectorTrace: {
      selected_candidate_ids: finalIds,
      repair_attempts: repairAttempts,
    } satisfies SelectorTrace,
    diagnostics,
  };
}

function normalizeSelectorDecision(rawOutput: unknown): TopicSelectorDecision {
  if (Array.isArray(rawOutput)) {
    return {
      selected_candidate_ids: rawOutput.filter(
        (candidateId): candidateId is string => typeof candidateId === "string",
      ),
    };
  }

  if (!rawOutput || typeof rawOutput !== "object") {
    throw new Error("topic_selector_invalid_selection");
  }

  const record = rawOutput as Record<string, unknown>;
  const answerRecord =
    record.answer && typeof record.answer === "object" && !Array.isArray(record.answer)
      ? (record.answer as Record<string, unknown>)
      : null;
  const ids =
    (Array.isArray(record.answer) ? record.answer : undefined) ??
    answerRecord?.selected_candidates ??
    answerRecord?.selected_candidate_ids ??
    answerRecord?.selectedIds ??
    answerRecord?.candidate_ids ??
    answerRecord?.ids ??
    record.selected_candidates ??
    record.selected_candidate_ids ??
    record.selectedIds ??
    record.candidate_ids ??
    record.ids;

  if (!Array.isArray(ids)) {
    throw new Error("topic_selector_invalid_selection");
  }

  return {
    selected_candidate_ids: ids.filter(
      (candidateId): candidateId is string => typeof candidateId === "string",
    ),
  };
}

function inspectSelectorDecision(input: {
  decision: TopicSelectorDecision;
  selectorPool: SelectorPoolCandidate[];
  rankings: RankedRecommendationCandidate[];
  allowedCount?: number;
  excludedCandidateIds?: Set<string>;
  excludedEventIdentities?: Set<string>;
}) {
  const rankingsById = new Map(
    input.rankings.map((candidate) => [candidate.candidateId, candidate] as const),
  );
  const knownIds = new Set(input.selectorPool.map((candidate) => candidate.candidate_id));
  const excludedCandidateIds = input.excludedCandidateIds ?? new Set<string>();
  const excludedEventIdentities = input.excludedEventIdentities ?? new Set<string>();
  const selected: RankedRecommendationCandidate[] = [];
  const selectedIds: string[] = [];

  for (const candidateId of input.decision.selected_candidate_ids) {
    if (!knownIds.has(candidateId) || excludedCandidateIds.has(candidateId)) {
      throw new Error("topic_selector_invalid_selection");
    }

    const match = rankingsById.get(candidateId);
    if (!match) {
      throw new Error("topic_selector_invalid_selection");
    }

    if (selectedIds.includes(candidateId)) {
      throw new Error("topic_selector_invalid_selection");
    }

    if (excludedEventIdentities.has(match.eventIdentity)) {
      throw new Error("topic_selector_invalid_selection");
    }

    selected.push(match);
    selectedIds.push(candidateId);
    excludedCandidateIds.add(candidateId);
    excludedEventIdentities.add(match.eventIdentity);
  }

  const targetCount = input.allowedCount ?? TOPIC_CANDIDATE_TARGET_COUNT;

  const trimmedSelected = selected.slice(0, targetCount);
  const trimmedSelectedIds = selectedIds.slice(0, targetCount);

  return {
    selected: trimmedSelected,
    selectedIds: trimmedSelectedIds,
    missingSlotCount: targetCount - trimmedSelected.length,
    excludedCandidateIds: [...excludedCandidateIds],
    excludedEventIdentities: [...excludedEventIdentities],
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
