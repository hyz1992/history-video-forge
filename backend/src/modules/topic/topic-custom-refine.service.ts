import { CustomRefinedEvent } from "../../../../shared/src/topic/topic-custom-refine-output.schema.js";
import { createLlmGateway } from "../../runtime/llm/llm-gateway.js";
import { parseLlmOutput } from "../../runtime/llm/llm-output-error.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import type { CustomRefinedEvent as CustomRefinedEventType } from "../../../../shared/src/topic/topic-custom-refine-output.schema.js";

export interface CustomRefineInput {
  rawDigest: string;
}

export interface CustomRefineResult {
  refined: CustomRefinedEventType;
}

/**
 * 调用 LLM 将用户自由文本梗概提炼为结构化历史事件。
 * 输出经 Zod strict 校验，失败抛异常（调用方负责 catch + 返回 422）。
 *
 * 设计约束（AGENTS.md）：
 * - 不允许在本地后处理中抢做 LLM 才能完成的语义判断。
 * - 因此 stub 模式下不提供占位"提炼"实现；stub provider 走真实 gateway 时
 *   由 createTierAwareProviderFromEnv 在缺凭据时抛错，调用方 catch 后返回 503。
 */
export async function refineCustomTopic(
  input: CustomRefineInput,
): Promise<CustomRefineResult> {
  const provider = createTierAwareProviderFromEnv();
  const registry = createPromptRegistry();
  const gateway = createLlmGateway({ registry, provider });

  const raw = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "topic.custom-refine",
    input: { rawDigest: input.rawDigest },
  });

  const parsed = parseLlmOutput(
    CustomRefinedEvent,
    raw,
    "topic_custom_refine_schema_invalid",
  );
  return { refined: parsed };
}
