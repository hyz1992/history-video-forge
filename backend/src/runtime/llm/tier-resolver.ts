/**
 * Tier → Provider:Model 解析器（S2-1 Task 3）。
 *
 * 设计约束（见 docs/plans/2026-07-17-s2-1-multi-provider-model-routing-design.md §4.1.1 / §4.3 / §4.4）：
 *
 * - tier 走 env 变量（LLM_SMART_MODEL / LLM_FLASH_MODEL），格式固定 `<provider>:<model>`（opencode 风格）。
 * - 解析时关联 provider-registry 拿到 baseUrl 与 apiKeyEnv 引用，再从 env 取实际 api key。
 * - 不在代码硬编码模型名或 provider 名。
 * - 与 tier registry（operation → tier）正交：本模块只做 tier → 具体模型 的转换。
 *
 * 兼容回退（Task 3 仅定义原语，回退组装在 env 层 / Task 5）：
 * - tier env 缺失时上层走旧 LLM_MODEL（在 env.ts 处理，不在本模块）。
 * - LLM_FLASH_MODEL 缺失时回退到 smart tier 解析结果（在 gateway 层处理，不在本模块）。
 * - 单 provider 兼容模式下 apiKeyEnv 为 null，使用 fallbackApiKey（旧 LLM_API_KEY）。
 */

import type { ProviderRegistryEntry } from "./provider-registry.js";
import type { OperationTier } from "./operation-tier-registry.js";

/** tier 解析后的具体模型与连接信息。 */
export interface ResolvedModel {
  /** 解析来源 tier。 */
  tier: OperationTier;
  /** provider 名（来自 env 中冒号前的部分）。 */
  provider: string;
  /** model 名（来自 env 中冒号后的部分）。 */
  model: string;
  /** provider 的 base url（来自 provider registry）。 */
  baseUrl: string;
  /** 实际 api key（已从 env 解出，或在单 provider 模式下来自 fallbackApiKey）。 */
  apiKey: string;
}

/** resolveTierModel 的输入参数。 */
export interface TierResolverInput {
  /** 要解析的 tier。 */
  tier: OperationTier;
  /**
   * env 中该 tier 的原始字符串，格式 `<provider>:<model>`。
   * 例如 "deepseek:deepseek-v4-pro"。空字符串/缺失格式时抛错。
   */
  tierModelRaw: string;
  /** 已加载的 provider 注册表。 */
  registry: Map<string, ProviderRegistryEntry>;
  /** 当前进程 env（用于按 apiKeyEnv 取 api key）。 */
  env: Record<string, string | undefined>;
  /**
   * 单 provider 兼容模式下使用的 api key 回退值。
   * 当 provider entry 的 apiKeyEnv 为 null 时使用（对应旧 LLM_API_KEY）。
   */
  fallbackApiKey?: string;
}

export class TierResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierResolverError";
  }
}

/**
 * 把单个 tier 的 `<provider>:<model>` 字符串解析为具体的 ResolvedModel。
 *
 * 抛错场景（均抛 TierResolverError）：
 * - tierModelRaw 格式非法（空、无冒号、多冒号、provider 或 model 为空）
 * - 引用的 provider 不在 registry 中
 * - apiKeyEnv 引用的 env 变量未设置，且无 fallbackApiKey
 */
export function resolveTierModel(input: TierResolverInput): ResolvedModel {
  const { provider, model } = parseProviderModel(input.tierModelRaw, input.tier);

  const entry = input.registry.get(provider);
  if (!entry) {
    throw new TierResolverError(
      `tier "${input.tier}" 解析失败：provider_not_registered（provider "${provider}" 未在 providers.json 中注册）。`,
    );
  }

  const apiKey = resolveApiKey(entry, input.env, input.fallbackApiKey, input.tier);

  return {
    tier: input.tier,
    provider: entry.name,
    model,
    baseUrl: entry.baseUrl,
    apiKey,
  };
}

function parseProviderModel(
  raw: string,
  tier: OperationTier,
): { provider: string; model: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new TierResolverError(
      `tier "${tier}" 解析失败：env 值为空，期望格式 "<provider>:<model>"。`,
    );
  }

  const colonIndex = raw.indexOf(":");
  if (colonIndex < 0) {
    throw new TierResolverError(
      `tier "${tier}" 解析失败：env 值 "${raw}" 缺少冒号，期望格式 "<provider>:<model>"。`,
    );
  }
  // 多冒号检查：第二个冒号位置
  const secondColon = raw.indexOf(":", colonIndex + 1);
  if (secondColon >= 0) {
    throw new TierResolverError(
      `tier "${tier}" 解析失败：env 值 "${raw}" 包含多个冒号，格式必须严格为 "<provider>:<model>"。`,
    );
  }

  const provider = raw.slice(0, colonIndex);
  const model = raw.slice(colonIndex + 1);

  if (provider.length === 0) {
    throw new TierResolverError(
      `tier "${tier}" 解析失败：provider 部分为空。`,
    );
  }
  if (model.length === 0) {
    throw new TierResolverError(
      `tier "${tier}" 解析失败：model 部分为空。`,
    );
  }

  return { provider, model };
}

function resolveApiKey(
  entry: ProviderRegistryEntry,
  env: Record<string, string | undefined>,
  fallbackApiKey: string | undefined,
  tier: OperationTier,
): string {
  if (entry.apiKeyEnv === null) {
    // 单 provider 兼容模式：apiKeyEnv 为 null，依赖 fallbackApiKey（旧 LLM_API_KEY）
    if (!fallbackApiKey || fallbackApiKey.length === 0) {
      throw new TierResolverError(
        `tier "${tier}" 解析失败：provider "${entry.name}" 处于单 provider 兼容模式（apiKeyEnv=null），但未提供 fallbackApiKey。请设置旧 LLM_API_KEY 或改用 providers.json 配置。`,
      );
    }
    return fallbackApiKey;
  }

  const value = env[entry.apiKeyEnv];
  if (typeof value !== "string" || value.length === 0) {
    throw new TierResolverError(
      `tier "${tier}" 解析失败：api_key_missing（provider "${entry.name}" 的 apiKeyEnv 引用 "${entry.apiKeyEnv}" 未在 env 中设置）。`,
    );
  }
  return value;
}
