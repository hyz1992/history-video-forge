/**
 * env → tier-aware provider 工厂（S2-1 Task 4b）。
 *
 * 设计约束（见 docs/plans/archive/2026-07-17-s2-1-multi-provider-model-routing-design.md §4.3 / §4.4 / §5.1）：
 *
 * - 启动时一次性 load providers.json + 解析 smart/flash tier，构造 inner provider 缓存。
 * - 兼容回退链（design §4.4）：
 *   1. LLM_SMART_MODEL 未配置 → smart tier 用 "default:" + LLM_MODEL，provider=default（单 provider 兼容模式）
 *   2. LLM_FLASH_MODEL 未配置 → flash tier 复用 smart tier 的 inner provider（等价单模型）
 *   3. providers.json 不存在 → 单 provider 模式（apiKeyEnv=null，使用 LLM_API_KEY）
 * - 不支持 hot reload：工厂返回的 provider 在构造时绑定具体 model/baseUrl/apiKey。
 *
 * 职责拆分（与 tier-aware-provider.ts 正交）：
 * - tier-aware-provider.ts：operation → tier → inner provider 选择（纯逻辑）
 * - 本模块：env + providers.json → 具体 inner provider 构造（IO + 解析）
 *
 * 关于直接读 process.env 而非 env 对象（重要约定）：
 * - LLM_SMART_MODEL / LLM_FLASH_MODEL / LLM_PROVIDERS_CONFIG_PATH 通过 env 对象读取
 *   （这几个变量已在 AppEnv.llm 显式建模）。
 * - 但 LLM_PROVIDER_*_API_KEY（如 LLM_PROVIDER_DEEPSEEK_API_KEY）由 providers.json 的 apiKeyEnv
 *   动态引用，变量名是数据，无法在 env.ts 静态枚举——因此 resolveTierModel 的 env 参数
 *   直接传 process.env，由 tier-resolver 按 entry.apiKeyEnv 动态查询。
 * - 这是有意为之的设计（design §4.1.2 "apiKeyEnv 引用 env 变量名"），不是疏漏。
 * - 正确性保证：env.ts 的 loadLocalDotEnv 在 import 时把 .env 写入 process.env（env.ts L228-233），
 *   本模块在 import env.ts 之后才被调用，所以 process.env 已含 .env 值。
 */

import path from "node:path";

import { env } from "../../config/env.js";
import {
  ResolvedCapabilityMapSchema,
  type ResolvedCapabilityMap,
} from "../../../../shared/src/index.js";
import { loadProviderRegistry } from "./provider-registry.js";
import { resolveTierModel, type ResolvedModel } from "./tier-resolver.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible-provider.js";
import { createTierAwareProvider } from "./tier-aware-provider.js";
import type { StructuredPromptProvider } from "./provider-contract.js";

class TierAwareProviderFactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TierAwareProviderFactoryError";
  }
}

/** 解析后的 tier 配置（用于诊断日志，Task 7 使用）。 */
export interface TierProviderSnapshot {
  smart: ResolvedModel;
  /** flash 是否与 smart 共享 inner provider（兼容期 LLM_FLASH_MODEL 未配置时为 true）。 */
  flashReusesSmart: boolean;
  flash?: ResolvedModel;
}

/**
 * 根据当前 env 构造 tier-aware provider。
 *
 * 行为：
 * - 始终返回 StructuredPromptProvider（兼容 llm-gateway 接口）。
 * - 启动时若 providers.json 解析失败或 smart tier 无法解析，抛错（不静默回退）。
 * - 单 provider 兼容模式（无 providers.json + 无 LLM_SMART_MODEL）也能工作。
 *
 * S2-2C（详细设计 §6.1）：`snapshotCapabilities` 提供时（付费 dispatch 路径，
 * 来源 `billingContext.resolved.resolved_capabilities`），**无论槽位是 auto 还是
 * fixed**，smart/flash 都按快照冻结的 provider_key + model_id 经 provider
 * registry 构造 inner provider（`mode` 只说明选择来源，不改变执行绑定）。
 * 快照参数存在时五槽必须齐备（合法快照恒满足）；缺任一必需槽位 → 抛错
 * fail-closed，不得混合快照与 env 回退。stub 部署忽略快照（调用方在 stub
 * 模式下直接构造 stub provider，不经本工厂）。
 *
 * 注意：本工厂不接管 stub 模式。调用方需自行判断 env.llm.provider === "stub"
 * 并走 stub 分支（与既有调用方模式一致，4b 改造时保留此约定）。
 */
export function createTierAwareProviderFromEnv(options?: {
  snapshotCapabilities?: ResolvedCapabilityMap;
}): StructuredPromptProvider {
  // S2-2C：快照提供且非 stub 部署 → 按快照冻结模型构造（auto/fixed 一律）。
  if (options?.snapshotCapabilities && env.llm.provider !== "stub") {
    const configPath = resolveProvidersConfigPath();
    const registry = loadProviderRegistry({
      configPath,
      envFallback: {
        baseUrl: env.llm.baseUrl,
        apiKey: env.llm.apiKey,
      },
    });
    const models = resolveSnapshotLlmModels(
      options.snapshotCapabilities,
      registry,
      process.env as Record<string, string | undefined>,
      env.llm.apiKey,
    );
    return createTierAwareProvider({
      smartProvider: createInnerProvider(models.smart),
      flashProvider: createInnerProvider(models.flash),
    });
  }

  const snapshot = resolveTierProviderSnapshot();

  const smartInner = createInnerProvider(snapshot.smart);
  const flashInner = snapshot.flash
    ? createInnerProvider(snapshot.flash)
    : smartInner;

  return createTierAwareProvider({
    smartProvider: smartInner,
    flashProvider: flashInner,
  });
}

/**
 * S2-2C：把快照冻结的 capabilities 解析为 smart/flash 两个 ResolvedModel。
 *
 * 纯函数（registry/env 显式注入，便于测试）：
 * - 快照完整映射（复审整改 P2）：先用 `ResolvedCapabilityMapSchema` 校验五槽
 *   齐备——缺任一必需槽位或形状损坏 → 抛错 fail-closed（合法快照由 schema
 *   合同保证恒满足；损坏快照不得混合快照与 env 回退）。
 * - 逐槽按 `provider_key:model_id` 经 `resolveTierModel` 解析 registry 连接与
 *   凭据；provider 未注册或 apiKeyEnv 缺失 → TierResolverError 上抛（与 env
 *   路径同语义，fail-closed）。
 */
export function resolveSnapshotLlmModels(
  capabilities: ResolvedCapabilityMap,
  registry: ReturnType<typeof loadProviderRegistry>,
  envVars: Record<string, string | undefined>,
  fallbackApiKey: string | undefined,
): { smart: ResolvedModel; flash: ResolvedModel } {
  const parsed = ResolvedCapabilityMapSchema.safeParse(capabilities);
  if (!parsed.success) {
    throw new TierAwareProviderFactoryError(
      `快照 capabilities 不完整或损坏（${parsed.error.message}）——禁止混合快照与 env 构造`,
    );
  }
  const caps = parsed.data;
  const smart = resolveTierModel({
    tier: "smart",
    tierModelRaw: `${caps["llm.smart"].provider_key}:${caps["llm.smart"].model_id}`,
    registry,
    env: envVars,
    fallbackApiKey,
  });
  const flash = resolveTierModel({
    tier: "flash",
    tierModelRaw: `${caps["llm.flash"].provider_key}:${caps["llm.flash"].model_id}`,
    registry,
    env: envVars,
    fallbackApiKey,
  });
  return { smart, flash };
}

/**
 * 解析当前 env 下的 tier provider 快照（不构造 provider，只做解析）。
 * Task 7 启动诊断日志会调用此函数打印实际生效配置。
 */
export function resolveTierProviderSnapshot(): TierProviderSnapshot {
  const configPath = resolveProvidersConfigPath();
  const registry = loadProviderRegistry({
    configPath,
    envFallback: {
      baseUrl: env.llm.baseUrl,
      apiKey: env.llm.apiKey,
    },
  });

  const smart = resolveSmartTierModel(registry);
  const flashRaw = env.llm.flashModel;
  if (!flashRaw) {
    return { smart, flashReusesSmart: true };
  }

  const flash = resolveTierModel({
    tier: "flash",
    tierModelRaw: flashRaw,
    registry,
    env: process.env as Record<string, string | undefined>,
    fallbackApiKey: env.llm.apiKey,
  });
  return { smart, flashReusesSmart: false, flash };
}

function resolveProvidersConfigPath(): string {
  const explicit = env.llm.providersConfigPath;
  if (explicit) {
    return explicit;
  }
  // 缺省路径：backend/providers.json（与 backend/providers.json 示例文件位置一致）
  return path.resolve(process.cwd(), "backend/providers.json");
}

function resolveSmartTierModel(
  registry: ReturnType<typeof loadProviderRegistry>,
): ResolvedModel {
  const smartRaw = env.llm.smartModel;
  if (smartRaw) {
    return resolveTierModel({
      tier: "smart",
      tierModelRaw: smartRaw,
      registry,
      env: process.env as Record<string, string | undefined>,
      fallbackApiKey: env.llm.apiKey,
    });
  }

  // 兼容回退：LLM_SMART_MODEL 未配置 → 直接用旧 LLM_MODEL + LLM_BASE_URL + LLM_API_KEY
  // 构造 ResolvedModel，不依赖 providers.json 是否注册了 default provider。
  //
  // 设计依据（design §4.4 第 3 点）：providers.json 不存在 → 单 provider 模式
  // 使用 LLM_API_KEY。这里的等价扩展：即使 providers.json 存在，只要
  // LLM_SMART_MODEL 缺失，smart tier 也走旧 env 单 provider 回退——否则默认
  // 仓库状态下（backend/providers.json 已提交 + 用户只配旧 env）会报
  // provider_not_registered，违反 design §10.5 验收"删除 LLM_SMART_MODEL 时
  // smart tier 回退旧 LLM_MODEL 正常工作"。
  //
  // 注意：env.ts 中 LLM_MODEL 缺省会回退到 "stub-model"（env.ts L83），
  // 此兜底值不应被当作真实模型——factory 检测到 "stub-model" 时视为"真未配置"并抛错。
  const legacyModel = env.llm.model;
  if (!legacyModel || legacyModel === "stub-model") {
    throw new TierAwareProviderFactoryError(
      "tier-aware provider 构造失败：LLM_SMART_MODEL 与 LLM_MODEL 均未配置，无法解析 smart tier。请配置 LLM_SMART_MODEL 或保留旧 LLM_MODEL。",
    );
  }
  const legacyBaseUrl = env.llm.baseUrl;
  if (!legacyBaseUrl) {
    throw new TierAwareProviderFactoryError(
      "tier-aware provider 构造失败：LLM_SMART_MODEL 未配置且旧 LLM_BASE_URL 也未配置，无法解析 smart tier。请配置 LLM_SMART_MODEL 或保留旧 LLM_BASE_URL。",
    );
  }
  const legacyApiKey = env.llm.apiKey;
  if (!legacyApiKey) {
    throw new TierAwareProviderFactoryError(
      "tier-aware provider 构造失败：LLM_SMART_MODEL 未配置且旧 LLM_API_KEY 也未配置，无法解析 smart tier。请配置 LLM_SMART_MODEL 或保留旧 LLM_API_KEY。",
    );
  }
  return {
    tier: "smart",
    provider: "default",
    model: legacyModel,
    baseUrl: legacyBaseUrl,
    apiKey: legacyApiKey,
  };
}

function createInnerProvider(
  resolved: ResolvedModel,
): StructuredPromptProvider {
  if (!resolved.baseUrl) {
    throw new TierAwareProviderFactoryError(
      `tier-aware provider 构造失败：provider "${resolved.provider}" 的 baseUrl 为空。请检查 providers.json 或配置旧 LLM_BASE_URL。`,
    );
  }
  if (!resolved.apiKey) {
    throw new TierAwareProviderFactoryError(
      `tier-aware provider 构造失败：provider "${resolved.provider}" 的 apiKey 为空。请检查 .env 中对应的 LLM_PROVIDER_*_API_KEY 变量或旧 LLM_API_KEY。`,
    );
  }
  return createOpenAiCompatibleProvider({
    profile: "main",
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
  });
}
