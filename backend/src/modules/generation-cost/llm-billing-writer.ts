import type { DbClient, RunConfigurationSnapshotRecord } from "../../db/client.js";
import type { LlmInteractionLogEntry, LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import type { ResolvedGenerationConfigurationV1 } from "../../../../shared/src/index.js";
import type { GenerationOperation } from "../../../../shared/src/index.js";
import { recordLlmUsage } from "./usage-cost-recorder.js";

/**
 * S2-2A 任务 9B：LLM interaction 的计费包装 writer。
 *
 * 包装生成链原有的 interaction log writer：
 * - 为每条 interaction 注入稳定 id（`<runId>:<operationName>:<attemptIndex>`），
 *   供 usage.interactionId 反查 interaction log；
 * - 按 promptId → LLM tier 映射记账（与 OPERATION_LLM_SLOTS 同一 truth：
 *   topic/script/storyboard/asset-planning 主链为 llm.smart，publish 为 llm.flash）；
 * - provider 返回 token → provider_usage actual；缺失 → null actual + estimate；
 * - 记账失败不阻断生成主链路（与媒体记账同一留痕策略，由 recorder 内部处理）。
 *
 * 仅付费 quote 绑定 run 的调用点使用本包装；stub/local 免 quote 路径
 * 保持原 writer 不记账。
 */

/** promptId → LLM tier（与 generation-cost.service OPERATION_LLM_SLOTS 对齐）。 */
const PROMPT_ID_TO_TIER: Record<string, "llm.smart" | "llm.flash"> = {
  // topic.generate（llm.smart）
  "topic.candidate-builder": "llm.smart",
  "topic.candidate-builder-repair": "llm.smart",
  "topic.selector": "llm.smart",
  "topic.custom-refine": "llm.smart",
  // script.generate（llm.smart）
  "script.writer": "llm.smart",
  "script.semantic-reviewer": "llm.smart",
  // storyboard.generate（llm.smart）
  "storyboard.planner": "llm.smart",
  "storyboard.segment-regen": "llm.smart",
  // asset_plan.generate（llm.smart）
  "asset-planning.planner": "llm.smart",
  "asset-planning.global-structural-repair": "llm.smart",
  "asset-planning.segment-intent-planner": "llm.smart",
  "asset-planning.segment-intent-repair": "llm.smart",
  "asset-planning.asset-structural-repair": "llm.smart",
  // publish.generate（llm.flash）
  "publish.cover-prompt-generator": "llm.flash",
  "publish.description-generator": "llm.flash",
  "publish.title-generator": "llm.flash",
  "publish.cover-prompt-optimizer": "llm.flash",
  // assets.generate（llm.flash，prompt 优化入口）
  "asset.prompt-optimizer": "llm.flash",
};

/** operation → 回退 tier（未知 promptId 时按 operation 默认 slot 记账）。 */
const OPERATION_FALLBACK_TIER: Record<GenerationOperation, "llm.smart" | "llm.flash"> = {
  "topic.generate": "llm.smart",
  "script.generate": "llm.smart",
  "storyboard.generate": "llm.smart",
  "asset_plan.generate": "llm.smart",
  "assets.generate": "llm.flash",
  "publish.generate": "llm.flash",
};

export interface LlmBillingContext {
  db: DbClient;
  snapshot: RunConfigurationSnapshotRecord;
  runId: string;
  operation: GenerationOperation;
  resolved: ResolvedGenerationConfigurationV1;
}

export function createBillingInteractionLogWriter(input: {
  billing: LlmBillingContext;
  inner: LlmInteractionLogWriter;
}): LlmInteractionLogWriter & { writeError(message: string): void } {
  const counters = new Map<string, number>();

  const writer = {
    write(entry: LlmInteractionLogEntry) {
      const operationName = entry.operationName ?? "unknown";
      const attemptIndex = counters.get(operationName) ?? 0;
      counters.set(operationName, attemptIndex + 1);
      const interactionId = `${input.billing.runId}:${operationName}:${attemptIndex}`;
      const enriched: LlmInteractionLogEntry = { ...entry, id: interactionId };

      const innerResult = input.inner.write(enriched);

      void recordUsage(interactionId, operationName, attemptIndex, entry).catch(() => {
        // 记账失败不阻断生成主链路；缺口由对账工具兜底（与媒体记账同策略）
      });

      return innerResult;
    },
  };

  // 透传 composite writer 的扩展方法（trace 追加器）
  const innerWithError = input.inner as LlmInteractionLogWriter & {
    writeError?: (message: string) => void;
  };
  return {
    ...writer,
    writeError(message: string) {
      innerWithError.writeError?.(message);
    },
  };

  async function recordUsage(
    interactionId: string,
    operationName: string,
    attemptIndex: number,
    entry: LlmInteractionLogEntry,
  ): Promise<void> {
    const { db, snapshot, runId, operation, resolved } = input.billing;
    const tier =
      PROMPT_ID_TO_TIER[operationName] ?? OPERATION_FALLBACK_TIER[operation];
    const resolvedCapability = resolved.resolved_capabilities[tier];
    if (!resolvedCapability) return;

    const metadata = entry.responseMetadata;
    await recordLlmUsage({
      db,
      snapshot,
      runId,
      operationOf: operation,
      interactionId,
      operationName,
      capability: tier,
      providerKey: resolvedCapability.provider_key,
      modelId: resolvedCapability.model_id,
      inputTokens: typeof metadata?.promptTokens === "number" ? metadata.promptTokens : null,
      outputTokens:
        typeof metadata?.completionTokens === "number" ? metadata.completionTokens : null,
      durationMs: entry.timing?.durationMs,
      status: entry.errorMessage ? "failed" : "succeeded",
      attemptIndex,
    });
  }
}
