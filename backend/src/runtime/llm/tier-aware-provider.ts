/**
 * Tier-aware provider：按 operationName 路由到 smart/flash inner provider（S2-1 Task 4a）。
 *
 * 设计约束（见 docs/plans/2026-07-17-s2-1-multi-provider-model-routing-design.md §3.1 / §4.3 / §5.2）：
 *
 * - tier 是模型路由的唯一维度，与 mode（tool_call vs json_object）正交。
 * - 本 provider 不解析具体 provider:model，只做 operation → tier → inner provider 的选择。
 * - 具体 provider:model 解析（基于 env + providers.json）在 createTierAwareProviderFromEnv
 *   工厂中完成（S2-1 Task 4b），本模块只接受已构造好的 smart/flash inner provider。
 * - 与 operation-policy.ts 正交：本模块管"用哪个模型"，operation-policy 管"怎么调"。
 * - 兼容期：若调用方只传入 smartProvider（flashProvider === smartProvider），等价 S2-0 单模型行为。
 *
 * 不变量：
 * - 路由决策按 operation-tier-registry 白名单；未知 operation 默认 smart。
 * - 不修改 request，整对象透传给 inner provider（保留 interactionLogWriter/options 等）。
 * - 错误透传，不吞错、不重试（重试由 inner provider / operation-policy 管）。
 */

import { getOperationTier } from "./operation-tier-registry.js";
import type {
  StrictStructuredInvocation,
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "./provider-contract.js";

/** createTierAwareProvider 的输入参数。 */
export interface TierAwareProviderInput {
  /**
   * smart tier 对应的 inner provider（用于需要 reasoning 的 operation）。
   * 必须存在——未知 operation 与所有 smart operation 都路由到此处。
   */
  smartProvider: StructuredPromptProvider;
  /**
   * flash tier 对应的 inner provider（用于短结构化输出 operation）。
   * 必须存在；兼容期可由调用方传入与 smartProvider 同一实例（等价单模型）。
   */
  flashProvider: StructuredPromptProvider;
}

class TierAwareProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierAwareProviderError";
  }
}

function selectProvider(
  operationName: string,
  smartProvider: StructuredPromptProvider,
  flashProvider: StructuredPromptProvider,
): StructuredPromptProvider {
  const tier = getOperationTier(operationName);
  return tier === "flash" ? flashProvider : smartProvider;
}

export function createTierAwareProvider(
  input: TierAwareProviderInput,
): StructuredPromptProvider {
  if (!input.smartProvider) {
    throw new TierAwareProviderError(
      "tier-aware provider 构造失败：smartProvider 缺失。smart tier 必须有 inner provider（未知 operation 默认走 smart）。",
    );
  }
  if (!input.flashProvider) {
    throw new TierAwareProviderError(
      "tier-aware provider 构造失败：flashProvider 缺失。flash tier 必须有 inner provider（兼容期可传入与 smartProvider 同一实例）。",
    );
  }

  const { smartProvider, flashProvider } = input;

  return {
    // capabilities 由 smart provider 透传：smart 是默认 tier，其能力代表整体上限。
    // 若 smart 不支持 tool_call 而 flash 支持，调用方需自行评估；S2-1 不做 capability 降级。
    capabilities: smartProvider.capabilities,

    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      const inner = selectProvider(
        request.operationName,
        smartProvider,
        flashProvider,
      );
      return inner.invokeStructuredPrompt<T>(request);
    },

    async invokeStrictStructured<T>(
      request: StrictStructuredInvocation<T>,
    ): Promise<T> {
      const inner = selectProvider(
        request.operationName,
        smartProvider,
        flashProvider,
      );
      if (!inner.invokeStrictStructured) {
        throw new TierAwareProviderError(
          `tier-aware provider 路由失败：operation "${request.operationName}" 选中的 inner provider 不支持 invokeStrictStructured。`,
        );
      }
      return inner.invokeStrictStructured<T>(request);
    },
  };
}
