import { checkNarrationExecutionCompatibility } from "../narration/narration-execution-compatibility.js";
import type { ProviderModelCatalogRecord } from "../../db/client.js";
import { CAPABILITY_SLOTS } from "../../../../shared/src/index.js";
import {
  resolveLlmTierTarget,
  type DashscopeDeploymentScope,
  type LlmTierSeedInput,
} from "./pricing-catalog.seed.js";
import type { LlmModelCandidate } from "./llm-model-catalog.js";

/**
 * S2-2A 任务 7：生成能力 readiness 交叉校验。
 *
 * 设计依据：详细设计 4.3 节（目录与 providers.json / adapter registry / 凭据的
 * 交叉校验、默认项唯一性硬约束）与实施计划任务 7 步骤 1。
 *
 * 规则：
 * - 每个 capability 恰好一个 active + isDefault=true 项；零个或多个都使该 capability
 *   readiness 失败（resolver auto 解析硬合同），不得静默通过。
 * - LLM active 项必须与当前 tier 解析结果（providers.json 注册 + tier resolver +
 *   健康服务端凭据）一致；tier 解析失败时 LLM 全部不可报价。
 * - 媒体 active 项必须与媒体 adapter registry（注册的 provider key）和媒体凭据一致。
 * - demo/test/unconfigured 环境下视频 catalog 强制不可真实派发。
 * - 不一致项 quotable=false，不得进入报价与新运行。
 * - 输出不得包含密钥、apiKeyEnv 引用或环境变量名（issue 使用公开原因码）。
 */

/** demo/test 环境强制禁止真实派发的 capability（真实付费视频 API）。 */
const REAL_VIDEO_CAPABILITIES = ["video.image_to_video"] as const;

export type ReadinessIssueCode =
  | "catalog_missing_active_default"
  | "catalog_multiple_active_defaults"
  | "llm_tier_mismatch"
  | "llm_provider_unavailable"
  | "llm_candidate_not_declared"
  | "media_adapter_unregistered"
  | "media_model_not_registered"
  | "media_execution_protocol_incompatible"
  | "media_credential_unconfigured"
  | "media_deployment_scope_unknown"
  | "media_deployment_scope_mismatch"
  | "real_video_dispatch_disabled";

/** 受 adapter/凭据约束的媒体 capability slot。 */
type MediaCapability = "image.generate" | "video.image_to_video" | "tts.synthesize";

/**
 * 当前实际注册的媒体 adapter 支持矩阵条目。
 * readiness 用 (capability, providerKey, modelId) 精确匹配目录项，防止
 * "按 seed 模型报价、按另一个模型实际调用"（codex 审计 P1-2）。
 */
export interface MediaRegisteredModel {
  capability: MediaCapability;
  providerKey: string;
  modelId: string;
}

export interface GenerationCapabilityReadinessInput {
  catalog: ProviderModelCatalogRecord[];
  llm: LlmTierSeedInput;
  /**
   * S2-2C（§7.3）：本轮 seed 声明的 LLM 候选集（bootstrap 预解析后的子集）。
   * 非默认 LLM 条目必须属于该集合（防目录手工改动漂移）；缺省（旧调用方 /
   * 无候选部署）时非默认 LLM 条目一律按目录漂移拒绝（安全方向）。
   */
  llmCandidates?: LlmModelCandidate[];
  media: {
    /**
     * 当前实际注册的媒体 adapter 支持矩阵（每个 capability 实际配置的
     * provider + model，含 env 覆盖后的真实执行模型）。
     */
    registeredModels: MediaRegisteredModel[];
    /** 服务端媒体凭据是否已配置（非空）。 */
    credentialConfigured: boolean;
    /** 当前 DashScope 部署区域（由运行 baseUrl 推导）。 */
    deploymentScope: DashscopeDeploymentScope;
  };
  environment: {
    demoMode: boolean;
    testEnv: boolean;
  };
}

export interface GenerationCapabilityReadinessIssue {
  code: ReadinessIssueCode;
  capability?: string;
  provider_model_id?: string;
  /** 公开原因，不含凭据细节、密钥或环境变量名。 */
  message: string;
}

export interface GenerationCapabilityReadinessItem {
  quotable: boolean;
  /** 是否允许真实（付费）provider 派发；视频项在 demo/test/unconfigured 下为 false。 */
  realDispatchAllowed: boolean;
  issues: ReadinessIssueCode[];
}

export interface GenerationCapabilityReadinessResult {
  ok: boolean;
  issues: GenerationCapabilityReadinessIssue[];
  /** provider_model_id → readiness 项。 */
  items: Record<string, GenerationCapabilityReadinessItem>;
  /** 全部不可报价项（供计价服务与提交协议拒绝）。 */
  nonQuotableProviderModelIds: string[];
}

export function evaluateGenerationCapabilityReadiness(
  input: GenerationCapabilityReadinessInput,
): GenerationCapabilityReadinessResult {
  const issues: GenerationCapabilityReadinessIssue[] = [];
  const itemIssues = new Map<string, ReadinessIssueCode[]>();

  const pushIssue = (
    entry: ProviderModelCatalogRecord | undefined,
    issue: GenerationCapabilityReadinessIssue,
  ) => {
    issues.push(issue);
    if (entry) {
      const list = itemIssues.get(entry.id) ?? [];
      list.push(issue.code);
      itemIssues.set(entry.id, list);
    }
  };

  // 1. 默认项唯一性 + 逐项一致性。
  // capability 级失败（零个/多个默认项）会同时打到该 capability 的全部 active 条目上：
  // auto 解析不可稳定进行时，任何条目都不得报价。
  for (const capability of CAPABILITY_SLOTS) {
    const entries = input.catalog.filter((e) => e.capability === capability);
    const activeEntries = entries.filter((e) => e.status === "active");
    const activeDefaults = activeEntries.filter((e) => e.isDefault);

    let capabilityLevelCode: ReadinessIssueCode | null = null;
    if (activeDefaults.length === 0) {
      capabilityLevelCode = "catalog_missing_active_default";
      issues.push({
        code: capabilityLevelCode,
        capability,
        message: `capability ${capability} 没有 active + isDefault=true 目录项；auto 解析无法稳定进行`,
      });
    } else if (activeDefaults.length > 1) {
      capabilityLevelCode = "catalog_multiple_active_defaults";
      issues.push({
        code: capabilityLevelCode,
        capability,
        message: `capability ${capability} 有 ${activeDefaults.length} 个 active 默认项，期望恰好 1 个（seed 漂移）`,
      });
    }
    if (capabilityLevelCode) {
      for (const entry of activeEntries) {
        const list = itemIssues.get(entry.id) ?? [];
        list.push(capabilityLevelCode);
        itemIssues.set(entry.id, list);
      }
    }

    // capability 级环境原因码（P3-B）：LLM tier 解析失败 / 媒体部署区域未知时，
    // 即使没有目录条目可挂，也必须输出可区分的公开原因码，供运维定位
    // （目录损坏 ≠ provider/凭据解析失败 ≠ 区域未知）。
    if (input.llm.mode === "resolution_failed" && isLlmCapability(capability)) {
      issues.push({
        code: "llm_provider_unavailable",
        capability,
        message: "LLM tier 解析失败（provider 未注册或服务端凭据缺失），LLM 目录项不可报价",
      });
    }
    if (
      input.media.deploymentScope === "unknown" &&
      isMediaCapability(capability)
    ) {
      issues.push({
        code: "media_deployment_scope_unknown",
        capability,
        message: "DashScope 接入区域无法识别，付费媒体目录项不可报价或派发（fail-closed）",
      });
    }

    for (const entry of activeEntries) {
      validateEntryConsistency(entry, input, pushIssue);
    }
    // disabled 行是目录的合法状态（详细设计 4.3：status=disabled 表示不可用于新运行），
    // 不构成 readiness issue——否则任务 2 迁移占位行被 seed 禁用后，Prisma 部署态
    // readiness 会永久 ok=false。disabled 行的不可报价语义由下方 items 的
    // quotable=false 与计价服务的 status 检查共同保证。
  }

  // 2. demo/test 环境强制视频不可真实派发（即使凭据已配置）。
  if (input.environment.demoMode || input.environment.testEnv) {
    for (const entry of input.catalog) {
      if (
        (REAL_VIDEO_CAPABILITIES as readonly string[]).includes(entry.capability) &&
        entry.status === "active"
      ) {
        pushIssue(entry, {
          code: "real_video_dispatch_disabled",
          capability: entry.capability,
          provider_model_id: entry.id,
          message: "演示/测试环境禁用真实付费视频 API，视频目录项不可真实派发",
        });
      }
    }
  }

  // 3. 汇总 item 结果。任何 readiness issue（含 capability 级默认项失败、demo/test
  //    视频禁派发）都使条目不可报价；realDispatchBlocked 同时阻止真实派发。
  const items: Record<string, GenerationCapabilityReadinessItem> = {};
  for (const entry of input.catalog) {
    const entryIssues = itemIssues.get(entry.id) ?? [];
    const quotable = entry.status === "active" && entryIssues.length === 0;
    const realDispatchBlocked =
      !quotable ||
      (entryIssues.includes("real_video_dispatch_disabled") &&
        (REAL_VIDEO_CAPABILITIES as readonly string[]).includes(entry.capability));
    items[entry.id] = {
      quotable,
      realDispatchAllowed: !realDispatchBlocked,
      issues: entryIssues,
    };
  }

  const nonQuotableProviderModelIds = Object.entries(items)
    .filter(([, item]) => !item.quotable)
    .map(([id]) => id);

  return {
    ok: issues.length === 0,
    issues,
    items,
    nonQuotableProviderModelIds,
  };
}

function isLlmCapability(capability: string): boolean {
  return capability === "llm.smart" || capability === "llm.flash";
}

function isMediaCapability(capability: string): capability is "image.generate" | "video.image_to_video" | "tts.synthesize" {
  return (
    capability === "image.generate" ||
    capability === "video.image_to_video" ||
    capability === "tts.synthesize"
  );
}

function validateEntryConsistency(
  entry: ProviderModelCatalogRecord,
  input: GenerationCapabilityReadinessInput,
  pushIssue: (
    entry: ProviderModelCatalogRecord | undefined,
    issue: GenerationCapabilityReadinessIssue,
  ) => void,
): void {
  if (isLlmCapability(entry.capability)) {
    validateLlmEntry(entry, input, pushIssue);
    return;
  }
  if (isMediaCapability(entry.capability)) {
    validateMediaEntry(entry, input, pushIssue);
  }
}

function validateLlmEntry(
  entry: ProviderModelCatalogRecord,
  input: GenerationCapabilityReadinessInput,
  pushIssue: (
    entry: ProviderModelCatalogRecord | undefined,
    issue: GenerationCapabilityReadinessIssue,
  ) => void,
): void {
  if (input.llm.mode === "resolution_failed") {
    pushIssue(entry, {
      code: "llm_provider_unavailable",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: "LLM tier 解析失败（provider 未注册或服务端凭据缺失），LLM 目录项不可报价",
    });
    return;
  }

  // S2-2C（§7.3）分层校验：llm_tier_mismatch 只对默认条目；非默认条目
  // （候选）按 (providerKey, modelId) 校验属于本轮候选集——目录被手工改动
  // 出候选集外、或无候选声明时出现非默认条目，都按目录漂移拒绝。
  if (!entry.isDefault) {
    const declared = input.llmCandidates?.some(
      (candidate) =>
        candidate.providerKey === entry.providerKey && candidate.modelId === entry.modelId,
    );
    if (!declared) {
      pushIssue(entry, {
        code: "llm_candidate_not_declared",
        capability: entry.capability,
        provider_model_id: entry.id,
        message: `LLM 非默认目录项 (${entry.providerKey}:${entry.modelId}) 不在本轮候选声明中（目录漂移或候选预解析未通过），不得报价或进入新运行`,
      });
    }
    return;
  }

  const target =
    input.llm.mode === "stub"
      ? { providerKey: "stub", modelId: "stub-model" }
      : resolveLlmTierTarget(
          input.llm,
          entry.capability === "llm.smart" ? "llm.smart" : "llm.flash",
        );

  if (
    entry.providerKey !== target.providerKey ||
    entry.modelId !== target.modelId
  ) {
    pushIssue(entry, {
      code: "llm_tier_mismatch",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: `LLM 目录项 (${entry.providerKey}:${entry.modelId}) 与当前 tier 解析结果 (${target.providerKey}:${target.modelId}) 不一致，不得报价或进入新运行`,
    });
  }
}

function validateMediaEntry(
  entry: ProviderModelCatalogRecord,
  input: GenerationCapabilityReadinessInput,
  pushIssue: (
    entry: ProviderModelCatalogRecord | undefined,
    issue: GenerationCapabilityReadinessIssue,
  ) => void,
): void {
  if (entry.capability === "tts.synthesize" && !checkNarrationExecutionCompatibility({
    catalog: input.catalog,
    operation: "assets.generate",
    model: entry,
  }).compatible) {
    pushIssue(entry, {
      code: "media_execution_protocol_incompatible",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: "旧媒体 adapter 不支持口播专用 WS 协议",
    });
  }
  const registered = input.media.registeredModels;
  const providerRegistered = registered.some((m) => m.providerKey === entry.providerKey);
  if (!providerRegistered) {
    pushIssue(entry, {
      code: "media_adapter_unregistered",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: `媒体目录项 ${entry.id} 的 provider (${entry.providerKey}) 未在 adapter registry 注册，不得报价或进入新运行`,
    });
  } else if (
    !registered.some(
      (m) =>
        m.capability === entry.capability &&
        m.providerKey === entry.providerKey &&
        m.modelId === entry.modelId,
    )
  ) {
    // (capability, provider, model) 精确匹配：目录模型必须与实际执行模型一致
    // （含 env 覆盖后的配置），否则"按 seed 模型报价、按另一模型调用"。
    pushIssue(entry, {
      code: "media_model_not_registered",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: `媒体目录项 ${entry.id} 的模型 (${entry.providerKey}:${entry.modelId}) 与该 capability 的实际 adapter 配置不一致，不得报价或进入新运行`,
    });
  }
  // 部署区域必须一致：目录行声明的区域与当前运行 baseUrl 推导的区域不同
  // （同一模型跨区域价格不同）时，不得按旧区域价格报价。
  const declaredScope =
    (entry.parameterCapabilitiesJson as Record<string, unknown>)["deployment_scope"];
  if (
    input.media.deploymentScope !== "unknown" &&
    declaredScope !== input.media.deploymentScope
  ) {
    pushIssue(entry, {
      code: "media_deployment_scope_mismatch",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: `媒体目录项 ${entry.id} 的部署区域 (${String(declaredScope)}) 与当前运行区域 (${input.media.deploymentScope}) 不一致，不得报价`,
    });
  }
  if (!input.media.credentialConfigured) {
    pushIssue(entry, {
      code: "media_credential_unconfigured",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: "服务端媒体凭据未配置，付费媒体目录项不可报价或进入新运行",
    });
  }
}

/** 口播WS独立注册能力；旧HTTP readiness矩阵及auto候选语义保持原样。 */
export function evaluateNarrationCapabilityReadiness(input: Parameters<typeof checkNarrationExecutionCompatibility>[0] & { wsAdapterRegistered: boolean; credentialConfigured: boolean ;}) {
  if (!input.wsAdapterRegistered) return { ready: false, reason: "narration_adapter_unregistered" };
  if (!input.credentialConfigured) return { ready: false, reason: "narration_credentials_missing" };
  const decision = checkNarrationExecutionCompatibility(input);
  return decision.compatible ? { ready: true, reason: null } : { ready: false, reason: decision.reason };
}
