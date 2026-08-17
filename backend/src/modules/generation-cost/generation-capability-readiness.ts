import type { ProviderModelCatalogRecord } from "../../db/client.js";
import { CAPABILITY_SLOTS } from "../../../../shared/src/index.js";
import type { LlmTierSeedInput } from "./pricing-catalog.seed.js";

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

/** LLM capability slot（readiness 侧的显式集合，避免字符串前缀猜测）。 */
const LLM_CAPABILITIES = ["llm.smart", "llm.flash"] as const;
/** 受凭据/adapter 约束的媒体 capability slot。 */
const MEDIA_CAPABILITIES = [
  "image.generate",
  "video.image_to_video",
  "tts.synthesize",
] as const;
/** demo/test 环境强制禁止真实派发的 capability（真实付费视频 API）。 */
const REAL_VIDEO_CAPABILITIES = ["video.image_to_video"] as const;

export type ReadinessIssueCode =
  | "catalog_missing_active_default"
  | "catalog_multiple_active_defaults"
  | "catalog_entry_disabled"
  | "llm_tier_mismatch"
  | "llm_provider_unavailable"
  | "media_adapter_unregistered"
  | "media_credential_unconfigured"
  | "real_video_dispatch_disabled";

export interface GenerationCapabilityReadinessInput {
  catalog: ProviderModelCatalogRecord[];
  llm: LlmTierSeedInput;
  media: {
    /** 媒体 adapter registry 当前注册的 provider key（如 ["dashscope"]）。 */
    adapterProviderKeys: string[];
    /** 服务端媒体凭据是否已配置（非空）。 */
    credentialConfigured: boolean;
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

    for (const entry of activeEntries) {
      validateEntryConsistency(entry, input, pushIssue);
    }
    for (const entry of entries.filter((e) => e.status !== "active")) {
      pushIssue(entry, {
        code: "catalog_entry_disabled",
        capability,
        provider_model_id: entry.id,
        message: `目录项 ${entry.id} 处于 disabled 状态，不得报价或进入新运行`,
      });
    }
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

function validateEntryConsistency(
  entry: ProviderModelCatalogRecord,
  input: GenerationCapabilityReadinessInput,
  pushIssue: (
    entry: ProviderModelCatalogRecord | undefined,
    issue: GenerationCapabilityReadinessIssue,
  ) => void,
): void {
  if ((LLM_CAPABILITIES as readonly string[]).includes(entry.capability)) {
    validateLlmEntry(entry, input, pushIssue);
    return;
  }
  if ((MEDIA_CAPABILITIES as readonly string[]).includes(entry.capability)) {
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

  const target =
    input.llm.mode === "stub"
      ? { providerKey: "stub", modelId: "stub-model" }
      : entry.capability === "llm.smart"
        ? input.llm.smart
        : input.llm.flash && "reusesSmart" in input.llm.flash
          ? input.llm.smart
          : (input.llm.flash ?? input.llm.smart);

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
  if (!input.media.adapterProviderKeys.includes(entry.providerKey)) {
    pushIssue(entry, {
      code: "media_adapter_unregistered",
      capability: entry.capability,
      provider_model_id: entry.id,
      message: `媒体目录项 ${entry.id} 的 provider (${entry.providerKey}) 未在 adapter registry 注册，不得报价或进入新运行`,
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
