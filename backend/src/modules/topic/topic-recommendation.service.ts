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

export interface TopicRecommendationOptions {
  llmGateway?: LlmGateway;
  projectId?: string | null;
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
      input,
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
  const finalDiagnostics = finalizeRecommendationDiagnostics({
    checks: result.diagnostics.checks,
    finalCandidateCount: postProcessed.candidates.length,
    additionalChecks: postProcessed.diagnostics,
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
      candidates: postProcessed.candidates,
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

  await persistPostProcessedCandidates(db, {
    projectId: options.projectId,
    candidates: postProcessed.rankings,
  });
  await recordProjectRecommendationRound(db, {
    projectId: options.projectId,
    createdAt: recommendationStartedAt,
    candidates: postProcessed.rankings.map((candidate) => ({
      eventRegistryEntryId: candidate.eventId,
      fingerprint: candidate.fingerprint,
    })),
  });

  const previousRoundCount = db.topicRunCounts.get(options.projectId) ?? 0;
  const roundIndex = previousRoundCount + 1;
  db.topicRunCounts.set(options.projectId, roundIndex);

  return {
    ...result,
    raw_candidates: result.candidates,
    candidates: postProcessed.candidates,
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
      const candidates = buildTopicCandidates(
        request.input as BuildTopicCandidatesInput,
      ) as T;

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
  candidate: RecommendationCandidate;
  eventId: string;
  eventIdentity: string;
  fingerprint: string;
  originalIndex: number;
  fatigueScore: number;
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
  const deduplicatedCandidates: Omit<RankedRecommendationCandidate, "fatigueScore">[] = [];
  const seenFingerprints = new Set<string>();
  const duplicateReasons: string[] = [];

  for (const [originalIndex, candidate] of input.candidates.entries()) {
    const normalized = await normalizeEventInput(input.db, {
      rawInput: candidate.title,
      sourceType: "system_recommendation",
    });
    const eventIdentity = normalizeEventIdentityValue(normalized.event.canonicalName);
    const fingerprint = buildEventIdentityFingerprint({
      eventIdentity,
      angle: candidate.one_line_angle,
    });

    if (seenFingerprints.has(fingerprint)) {
      duplicateReasons.push(
        `${candidate.title}｜${candidate.one_line_angle} 与已保留候选事件/角度重复`,
      );
      continue;
    }

    seenFingerprints.add(fingerprint);
    deduplicatedCandidates.push({
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

    const [eventIdentity] = record.fingerprint.split("::");
    if (eventIdentity) {
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

      const [eventIdentity] = candidate.fingerprint.split("::");
      if (!eventIdentity) {
        continue;
      }

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

  return {
    candidates: rankings
      .slice(0, TOPIC_CANDIDATE_TARGET_COUNT)
      .map((entry) => entry.candidate),
    rankings: rankings.slice(0, TOPIC_CANDIDATE_TARGET_COUNT),
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

  if (check.code === "topic_candidate_slots_insufficient") {
    return {
      ...check,
      reason: `最终仅保留 ${finalCandidateCount} 个候选，仍低于目标槽位数 ${TOPIC_CANDIDATE_TARGET_COUNT}`,
    };
  }

  return check;
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
