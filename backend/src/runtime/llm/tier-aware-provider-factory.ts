/**
 * env → tier-aware provider 工厂（S2-1 Task 4b）。
 *
 * 设计约束（见 docs/plans/2026-07-17-s2-1-multi-provider-model-routing-design.md §4.3 / §4.4 / §5.1）：
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

  // 兼容回退：LLM_SMART_MODEL 未配置 → 使用旧 LLM_MODEL，provider=default（单 provider 模式）。
  // 此时 registry 中应有 default provider（由 loadProviderRegistry 的 envFallback 注入）。
  // 用 "default:" + LLM_MODEL 作为 tierModelRaw 走同一解析路径，保证 baseUrl/apiKey 解析逻辑一致。
  // 注意：env.ts 中 LLM_MODEL 缺省会回退到 "stub-model"（env.ts L74），
  // 此兜底值不应被当作真实模型——factory 检测到 "stub-model" 时视为"真未配置"并抛错。
  const legacyModel = env.llm.model;
  if (!legacyModel || legacyModel === "stub-model") {
    throw new TierAwareProviderFactoryError(
      "tier-aware provider 构造失败：LLM_SMART_MODEL 与 LLM_MODEL 均未配置，无法解析 smart tier。请配置 LLM_SMART_MODEL 或保留旧 LLM_MODEL。",
    );
  }
  return resolveTierModel({
    tier: "smart",
    tierModelRaw: `default:${legacyModel}`,
    registry,
    env: process.env as Record<string, string | undefined>,
    fallbackApiKey: env.llm.apiKey,
  });
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
