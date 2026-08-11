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
 * 注意：本工厂不接管 stub 模式。调用方需自行判断 env.llm.provider === "stub"
 * 并走 stub 分支（与既有调用方模式一致，4b 改造时保留此约定）。
 */
export function createTierAwareProviderFromEnv(): StructuredPromptProvider {
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
