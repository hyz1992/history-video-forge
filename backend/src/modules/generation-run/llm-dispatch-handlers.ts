import type { AppResponse } from "../../app";
import { env } from "../../config/env.js";
import type { DbClient, GenerationRunRecord, ProjectRecord } from "../../db/client.js";
import type { ResolvedGenerationConfigurationV1 } from "../../../../shared/src/index.js";
import type { GenerationOperation } from "../../../../shared/src/index.js";
import type { LlmBillingContext } from "../generation-cost/llm-billing-writer.js";
import type { DispatchOutcome, GenerationRunDispatchHandler } from "./generation-run-dispatcher.js";
import { runScriptGeneration } from "../script/script-run.service.js";
import {
  runStoryboardGeneration,
  runStoryboardSegmentRegeneration,
} from "../storyboard/storyboard-run.service.js";
import { runAssetPlanningGeneration } from "../asset-planning/asset-planning-run.service.js";
import { runPublishGeneration } from "../publish/publish-run.service.js";
import { runTopicRecommendationWithStore } from "../topic/topic-recommendation-flow.service.js";
import type { ProjectTopicCandidateState } from "../../app.js";

/**
 * S2-2A 任务 9B：五个 LLM 生成 operation 的 dispatcher handler。
 *
 * 与 assets 的 createAssetsDispatchHandler 同一模式：从 run.dispatchPayloadJson
 * 恢复提交参数，从 run 快照构建计费上下文（执行绑定授权身份），同步执行
 * 现有生成 service 并透传 AppResponse。
 */

/** 从 run 快照构建 LLM 计费上下文（授权同源：快照即提交时解析结果）。 */
function billingFor(run: GenerationRunRecord, db: DbClient): LlmBillingContext | undefined {
  const snapshot = db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId);
  if (!snapshot) return undefined;
  return {
    db,
    snapshot,
    runId: run.id,
    operation: run.operation as GenerationOperation,
    resolved: snapshot.resolvedConfigurationJson as unknown as ResolvedGenerationConfigurationV1,
  };
}

function toOutcome(response: AppResponse): DispatchOutcome {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return { status: "succeeded", response };
  }
  const errorCode =
    (response.body as { error?: string } | undefined)?.error ?? "generation_failed";
  return {
    status: "failed",
    reason_code: errorCode,
    message: `generation returned HTTP ${response.statusCode}`,
    response,
  };
}

export function createScriptDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, { db, project }) => {
    const payload = run.dispatchPayloadJson as Record<string, unknown>;
    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: payload.allow_patch as boolean | undefined,
      allowRegen: payload.allow_regen as boolean | undefined,
      allowLocalRepairRegen: payload.allow_local_repair_regen as boolean | undefined,
      forceRegen: payload.force_regen as boolean | undefined,
      userFeedback: payload.user_feedback as string | undefined,
      billingContext: billingFor(run, db),
    });
    return toOutcome(response);
  };
}

export function createStoryboardDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, { db, project }) => {
    const payload = run.dispatchPayloadJson as Record<string, unknown>;
    const billingContext = billingFor(run, db);
    let response: AppResponse;
    if (typeof payload.segment_id === "string") {
      // 分段重生入口（同一 storyboard.generate operation）
      response = await runStoryboardSegmentRegeneration({
        db,
        project,
        segmentId: payload.segment_id,
        userFeedback: payload.user_feedback as string,
        billingContext,
      });
    } else {
      response = await runStoryboardGeneration({
        db,
        project,
        userFeedback: payload.user_feedback as string | undefined,
        billingContext,
      });
    }
    return toOutcome(response);
  };
}

export function createAssetPlanDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, { db, project }) => {
    const response = await runAssetPlanningGeneration({
      db,
      project,
      demoMode: env.demoMode,
      billingContext: billingFor(run, db),
    });
    return toOutcome(response);
  };
}

export function createPublishDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, { db, project }) => {
    const response = await runPublishGeneration({
      db,
      project,
      billingContext: billingFor(run, db),
    });
    return toOutcome(response);
  };
}

export function createTopicDispatchHandler(options: {
  topicCandidateStore: Map<string, ProjectTopicCandidateState>;
}): GenerationRunDispatchHandler {
  return async (run, { db, project }) => {
    const payload = run.dispatchPayloadJson as Record<string, unknown>;
    const billingContext = billingFor(run, db);
    // 从提交 payload 恢复 topic 推荐 seed（controller 已做 schema 校验，此处直接映射）
    const seed = {
      canonicalName: payload.canonical_name as string,
      summary: payload.summary as string,
      coreConflict: payload.core_conflict as string,
      strongScene: payload.strong_scene as string,
      sourceHint: payload.source_hint as string,
      recentUsageHint: payload.recent_usage_hint as string,
      canonicalQuotes: Array.isArray(payload.canonical_quotes)
        ? (payload.canonical_quotes as string[])
        : undefined,
      canonicalQuoteIntents: Array.isArray(payload.canonical_quote_intents)
        ? (payload.canonical_quote_intents as Array<{ quote: string; intent: string }>)
        : undefined,
      tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : undefined,
    };
    const filters = payload.filters as Record<string, unknown> | undefined;
    const response = await runTopicRecommendationWithStore({
      db,
      project,
      topicCandidateStore: options.topicCandidateStore,
      seed,
      filters: filters as never,
      billingContext,
    });
    return toOutcome(response);
  };
}
