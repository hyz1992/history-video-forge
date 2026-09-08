import type { AppResponse } from "../../app";
import { env } from "../../config/env.js";
import type { DbClient, GenerationRunRecord, ProjectRecord } from "../../db/client.js";
import type { ResolvedGenerationConfigurationV1 } from "../../../../shared/src/index.js";
import type { GenerationOperation } from "../../../../shared/src/index.js";
import type { LlmBillingContext } from "../generation-cost/llm-billing-writer.js";
import type {
  DispatchOutcome,
  GenerationRunDispatchContext,
  GenerationRunDispatchHandler,
} from "./generation-run-dispatcher.js";
import type { GenerationRunRepository } from "./generation-run.repository.js";
import { runScriptGeneration } from "../script/script-run.service.js";
import {
  runStoryboardGeneration,
  runStoryboardSegmentRegeneration,
} from "../storyboard/storyboard-run.service.js";
import { runAssetPlanningGeneration } from "../asset-planning/asset-planning-run.service.js";
import { extractArtStylePresetFromResolved } from "../asset-planning/creative-context.js";
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

/**
 * 从 run 构建 LLM 计费上下文（授权同源：快照即提交时解析结果）。
 * 外部审查 P1-2 整改：本实例内存镜像缺 snapshot（跨实例 sweep 冷恢复）时，
 * 以数据库为权威经 repository 加载；repository 也找不到（数据异常）时
 * 返回 null，调用方必须 fail-closed 拒绝派发——绝不无 billing context
 * 执行真实 LLM（免 quote 只属于 stub/local 旧路径，不属派发协议）。
 */
async function resolveBillingContext(
  run: GenerationRunRecord,
  context: GenerationRunDispatchContext,
): Promise<LlmBillingContext | null> {
  const inMemory = context.db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId);
  const snapshot = inMemory ?? (await context.repository.getSnapshotById(run.runConfigurationSnapshotId));
  if (!snapshot) return null;
  return {
    db: context.db,
    snapshot,
    runId: run.id,
    operation: run.operation as GenerationOperation,
    resolved: snapshot.resolvedConfigurationJson as unknown as ResolvedGenerationConfigurationV1,
  };
}

/** snapshot 不可用（数据异常）的统一 fail-closed 结局。 */
const SNAPSHOT_MISSING_OUTCOME: DispatchOutcome = {
  status: "failed",
  reason_code: "dispatch_snapshot_missing",
  message:
    "run 的配置快照不可用（内存镜像与数据库均缺失），拒绝派发——禁止无计费上下文执行真实 LLM",
};

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
  return async (run, context) => {
    const billing = await resolveBillingContext(run, context);
    if (!billing) return SNAPSHOT_MISSING_OUTCOME;
    const payload = run.dispatchPayloadJson as Record<string, unknown>;
    const response = await runScriptGeneration({
      db: context.db,
      project: context.project,
      allowPatch: payload.allow_patch as boolean | undefined,
      allowRegen: payload.allow_regen as boolean | undefined,
      allowLocalRepairRegen: payload.allow_local_repair_regen as boolean | undefined,
      forceRegen: payload.force_regen as boolean | undefined,
      userFeedback: payload.user_feedback as string | undefined,
      billingContext: billing,
    });
    return toOutcome(response);
  };
}

export function createStoryboardDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, context) => {
    const payload = run.dispatchPayloadJson as Record<string, unknown>;
    const billing = await resolveBillingContext(run, context);
    if (!billing) return SNAPSHOT_MISSING_OUTCOME;
    let response: AppResponse;
    if (typeof payload.segment_id === "string") {
      // 分段重生入口（同一 storyboard.generate operation）
      response = await runStoryboardSegmentRegeneration({
        expectedNarrationSource: payload.narration_source,
        db: context.db,
        project: context.project,
        segmentId: payload.segment_id,
        userFeedback: payload.user_feedback as string,
        billingContext: billing,
      });
    } else {
      response = await runStoryboardGeneration({
        expectedNarrationSource: payload.narration_source,
        db: context.db,
        project: context.project,
        userFeedback: payload.user_feedback as string | undefined,
        billingContext: billing,
      });
    }
    return toOutcome(response);
  };
}

export function createAssetPlanDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, context) => {
    const billing = await resolveBillingContext(run, context);
    if (!billing) return SNAPSHOT_MISSING_OUTCOME;
    // S2-2B：执行端只消费快照冻结的画风参数（外部审查 P1-3），
    // 绝不重新读取 preset 注册表当前版本。
    const artStylePreset = extractArtStylePresetFromResolved(billing.resolved);
    const response = await runAssetPlanningGeneration({
      expectedNarrationSource: run.dispatchPayloadJson.narration_source,
      db: context.db,
      project: context.project,
      demoMode: env.demoMode,
      billingContext: billing,
      artStylePreset,
    });
    return toOutcome(response);
  };
}

export function createPublishDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, context) => {
    const billing = await resolveBillingContext(run, context);
    if (!billing) return SNAPSHOT_MISSING_OUTCOME;
    const response = await runPublishGeneration({
      db: context.db,
      project: context.project,
      billingContext: billing,
    });
    return toOutcome(response);
  };
}

export function createTopicDispatchHandler(options: {
  topicCandidateStore: Map<string, ProjectTopicCandidateState>;
}): GenerationRunDispatchHandler {
  return async (run, context) => {
    const payload = run.dispatchPayloadJson as Record<string, unknown>;
    const billing = await resolveBillingContext(run, context);
    if (!billing) return SNAPSHOT_MISSING_OUTCOME;
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
      db: context.db,
      project: context.project,
      topicCandidateStore: options.topicCandidateStore,
      seed,
      filters: filters as never,
      billingContext: billing,
      prismaClient: context.prismaClient,
      // 推荐回流（EventLibraryDraft）以 run 的提交者为归属
      actorUserId: run.userId ?? undefined,
    });
    return toOutcome(response);
  };
}
