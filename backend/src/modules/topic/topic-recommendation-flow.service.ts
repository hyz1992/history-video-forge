import { randomUUID } from "node:crypto";
import type { AppResponse, ProjectTopicCandidateState } from "../../app.js";
import type { DbClient, ProjectRecord } from "../../db/client.js";
import { StoredTopicCandidate } from "./topic-confirm.service.js";
import { writeRefluxDraft } from "../event-library/event-library-draft.writer.js";
import { normalizeEventInput } from "./event-normalizer.js";
import { recommendTopicCandidatesWithTrace } from "./topic-recommendation.service.js";
import type { LlmBillingContext } from "../generation-cost/llm-billing-writer.js";
import type { TopicRecommendationFilterInput } from "../../../../shared/src/topic/topic-recommendation-filter.schema.js";

/**
 * S2-2A 任务 9B：topic 推荐的"推荐 + 候选组装"流程（controller 与
 * dispatcher handler 共用，避免双实现漂移）。
 *
 * 独立文件的原因：经模块 namespace 调用 recommendTopicCandidatesWithTrace，
 * 保持既有测试的 vi.spyOn(topic-recommendation.service, ...) 兼容
 * （模块内直接调用会绕过 spy）。
 */

export interface RunTopicRecommendationWithStoreInput {
  db: DbClient;
  project: ProjectRecord;
  topicCandidateStore: Map<string, ProjectTopicCandidateState>;
  seed: {
    canonicalName: string;
    summary: string;
    coreConflict: string;
    strongScene: string;
    sourceHint: string;
    recentUsageHint: string;
    canonicalQuotes?: string[];
    canonicalQuoteIntents?: Array<{ quote: string; intent: string }>;
    tags?: string[];
  };
  filters?: TopicRecommendationFilterInput;
  actorUserId?: string | null;
  prismaClient?: import("../../db/prisma-client.types.js").AppPrismaClient;
  billingContext?: LlmBillingContext;
}

export function toResponseCandidate(candidate: StoredTopicCandidate) {
  return {
    candidate_id: candidate.candidateId,
    title: candidate.title,
    one_line_angle: candidate.oneLineAngle,
    family_label: candidate.familyLabel,
    scope_label: candidate.scopeLabel,
    strong_scene: candidate.strongScene,
    must_cover_preview: candidate.mustCoverPreview ?? [],
    why_this_now: candidate.whyThisNow ?? "",
    risk_hints: candidate.riskHints ?? [],
    core_conflict: candidate.coreConflict,
    source_hint: candidate.sourceHint,
    viral_rubric: candidate.viralRubric ?? {},
  };
}

/**
 * 推荐 + 候选归一/入库/round 记账/响应组装（与 topic.controller 直调路径同一形状）。
 */
export async function runTopicRecommendationWithStore(
  input: RunTopicRecommendationWithStoreInput,
): Promise<AppResponse> {
  const { db, project, topicCandidateStore } = input;
  const recommendation = await recommendTopicCandidatesWithTrace(
    db,
    {
      canonicalName: input.seed.canonicalName,
      summary: input.seed.summary,
      coreConflict: input.seed.coreConflict,
      strongScene: input.seed.strongScene,
      sourceHint: input.seed.sourceHint,
      recentUsageHint: input.seed.recentUsageHint,
      canonicalQuotes: input.seed.canonicalQuotes,
      canonicalQuoteIntents: input.seed.canonicalQuoteIntents,
      tags: input.seed.tags,
      ...(input.filters ? { filters: input.filters } : {}),
    },
    {
      projectId: project.id,
      billingContext: input.billingContext,
    },
  );
  const candidates = recommendation.candidates;

  const storedCandidates = new Map<string, StoredTopicCandidate>();
  const responseCandidates = [];

  for (const candidate of candidates) {
    const normalizedCandidate = await normalizeEventInput(db, {
      rawInput: candidate.title,
      canonicalQuotes: input.seed.canonicalQuotes,
      canonicalQuoteIntents: input.seed.canonicalQuoteIntents,
      sourceType: "system_recommendation",
    });
    const candidateId = randomUUID();
    storedCandidates.set(candidateId, {
      candidateId,
      projectId: project.id,
      event: normalizedCandidate.event,
      title: candidate.title,
      oneLineAngle: candidate.one_line_angle,
      familyLabel: candidate.family_label,
      scopeLabel: candidate.scope_label,
      coreConflict: candidate.core_conflict,
      strongScene: candidate.strong_scene,
      mustCoverPreview: candidate.must_cover_preview,
      sourceHint: candidate.source_hint,
      recentUsageHint: candidate.recent_usage_hint,
      whyThisNow: candidate.why_this_now,
      riskHints: [...candidate.risk_hints],
      viralRubric: candidate.viral_rubric
        ? { ...(candidate.viral_rubric as Record<string, string>) }
        : {},
    });

    responseCandidates.push({
      candidate_id: candidateId,
      ...candidate,
    });
  }

  const topicRun =
    ((recommendation as Record<string, unknown>).topic_run as Record<string, unknown> | undefined) ?? {
      project_id: project.id as string,
      round_id: `topic_run_${randomUUID()}`,
      round_index: (topicCandidateStore.get(project.id)?.rounds.length ?? 0) + 1,
      previous_round_count: topicCandidateStore.get(project.id)?.rounds.length ?? 0,
    };
  const projectTopicState = topicCandidateStore.get(project.id) ?? {
    candidatesById: new Map<string, StoredTopicCandidate>(),
    rounds: [],
  };

  for (const [candidateId, storedCandidate] of storedCandidates.entries()) {
    projectTopicState.candidatesById.set(candidateId, storedCandidate);
  }

  projectTopicState.rounds.push({
    roundId: String(topicRun.round_id),
    roundIndex: Number(topicRun.round_index),
    createdAt: new Date().toISOString(),
    candidates: [...storedCandidates.values()],
  } as never);
  topicCandidateStore.set(project.id, projectTopicState);

  // 生成成功，状态转换为 candidates_ready
  project.status = "topic_candidates_ready";
  project.updatedAt = new Date();
  await db.firstAggregateWriter?.syncProject(project);

  // 推荐回流：异步写 EventLibraryDraft(recommendation_reflux)，不阻塞响应
  if (input.prismaClient && input.actorUserId) {
    setImmediate(() => {
      for (const storedCandidate of storedCandidates.values()) {
        writeRefluxDraft({
          prisma: input.prismaClient!,
          candidate: storedCandidate,
          projectId: project.id,
          ownerId: input.actorUserId!,
        });
      }
    });
  }

  const currentRound = projectTopicState.rounds.at(-1);
  const historyRounds = projectTopicState.rounds.slice(0, -1);

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      event_id: projectTopicState.rounds.at(-1)?.candidates[0]?.event.id ?? null,
      topic_run_id: (topicRun["round_id"] ?? topicRun["topic_run_id"]) as string,
      topic_run_index: (topicRun["round_index"] ?? topicRun["topic_run_index"]) as number,
      candidates: responseCandidates,
      current_round: currentRound
        ? {
            round_id: currentRound.roundId,
            round_index: currentRound.roundIndex,
            created_at: currentRound.createdAt,
            candidates: currentRound.candidates.map(toResponseCandidate),
          }
        : null,
      history_rounds: historyRounds.map((round) => ({
        round_id: round.roundId,
        round_index: round.roundIndex,
        created_at: round.createdAt,
        candidates: round.candidates.map(toResponseCandidate),
      })),
      graph_trace_summary: recommendation.trace,
      runtime_diagnostics: recommendation.diagnostics,
    },
  };
}
