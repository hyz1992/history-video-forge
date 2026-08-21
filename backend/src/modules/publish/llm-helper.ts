import { env } from "../../config/env";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry";
import type { ResolvedCapabilityMap } from "../../../../shared/src/index";

let cachedGateway: LlmGateway | null = null;

/**
 * Shared LLM gateway for publish-stage services.
 * Cached so description and title generators share the same instance.
 *
 * S2-1 修复（审查 P1-3）：stub 模式下不调用 createTierAwareProviderFromEnv
 * （factory 不接管 stub，且 stub 环境下没有任何 provider:model 配置会让 factory 抛错）。
 * stub 模式返回一个总是抛 publish_stub_not_supported 的 gateway，由调用方
 * 既有的 try/catch 兜底（与 S2-0 阶段 stub 行为一致）。
 *
 * S2-2C（详细设计 §6.1）：`snapshotCapabilities` 提供时（付费 dispatch 路径，
 * 来源 `billingContext.resolved.resolved_capabilities`）按快照冻结模型构造
 * 新 gateway——**不命中进程级缓存**（快照与 env 路径分离，避免快照结果被
 * 缓存污染后续调用）；缺省走缓存 env gateway（现状行为不变）。
 */
export function getPublishLlmGateway(snapshotCapabilities?: ResolvedCapabilityMap): LlmGateway {
  if (snapshotCapabilities) {
    if (env.llm.provider === "stub") {
      return createStubPublishGateway();
    }
    const registry = createPromptRegistry();
    const provider: StructuredPromptProvider = createTierAwareProviderFromEnv({
      snapshotCapabilities,
    });
    return createLlmGateway({ registry, provider });
  }
  if (!cachedGateway) {
    if (env.llm.provider === "stub") {
      cachedGateway = createStubPublishGateway();
    } else {
      const registry = createPromptRegistry();
      const provider: StructuredPromptProvider = createTierAwareProviderFromEnv();
      cachedGateway = createLlmGateway({ registry, provider });
    }
  }
  return cachedGateway;
}

function createStubPublishGateway(): LlmGateway {
  const stubError = new Error("publish_stub_not_supported");
  return {
    async invokeStructuredPrompt() {
      throw stubError;
    },
    async invokeStrictStructured() {
      throw stubError;
    },
  };
}
