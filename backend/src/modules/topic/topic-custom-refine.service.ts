import { CustomRefinedEvent } from "../../../../shared/src/topic/topic-custom-refine-output.schema.js";
import { createLlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import { env } from "../../config/env.js";
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
 */
export async function refineCustomTopic(
  input: CustomRefineInput,
): Promise<CustomRefineResult> {
  if (env.llm.provider === "stub") {
    return refineCustomTopicStub(input);
  }

  const provider = createTierAwareProviderFromEnv();
  const registry = createPromptRegistry();
  const gateway = createLlmGateway({ registry, provider });

  const raw = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "topic.custom-refine",
    input: { rawDigest: input.rawDigest },
  });

  const parsed = CustomRefinedEvent.parse(raw);
  return { refined: parsed };
}

/** stub 模式：从输入文本提取关键词，返回最小合法结构 */
function refineCustomTopicStub(input: CustomRefineInput): CustomRefineResult {
  const text = input.rawDigest;
  // 取前 30 字符作为标题
  const roughTitle = text.replace(/[，。！？、\s]/g, "").slice(0, 30) || "自定义事件";
  // 取前 100 字符作为摘要
  const summary = text.slice(0, 100).replace(/\n/g, " ");

  const refined: CustomRefinedEventType = {
    canonicalName: roughTitle,
    summary: summary.length >= 20 ? summary : `${summary}（用户提交的梗概摘要）`,
    dynasty: "唐",
    characterTags: ["自定义人物"],
    eventTypeTags: ["自定义事件"],
  };

  return { refined };
}
