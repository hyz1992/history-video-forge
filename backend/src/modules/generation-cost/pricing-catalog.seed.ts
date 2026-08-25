import type { ProviderModelCatalogRecord } from "../../db/client.js";
import type { LlmModelCandidate } from "./llm-model-catalog.js";

/**
 * S2-2A 任务 7：服务端受控 provider/model 目录与价格 seed。
 *
 * 设计依据：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-design.md 4.3 节
 * （ProviderModelCatalog 职责边界）与实施计划任务 7 步骤 2。
 *
 * 边界：
 * - 价格必须集中在后端：本文件是媒体与 LLM 价格元数据的唯一 seed 真相源，
 *   每个价格条目必须携带 source_note（可解释来源）。
 * - 本 seed 不从只含连接信息的 backend/providers.json 自动派生任何内容；
 *   LLM 条目只把当前 tier 解析结果（provider/model）映射进目录，连接信息仍由
 *   provider registry / tier resolver 管理。启动 readiness 负责交叉校验两者一致。
 * - 输出中不得出现密钥、apiKeyEnv 引用或环境变量名。
 * - 只有已核实公开价格的模型才写入 LLM 价格表；未核实条目保持 unpriced，
 *   计价服务对其返回 unbounded（预算门禁必须显式授权），禁止"未知所以零元"。
 */

/** seed 生效时间（ISO 8601，价格快照的生效起点）。 */
export const SEED_EFFECTIVE_AT = "2026-08-17T00:00:00+08:00";

/** DashScope 媒体价格版本（北京 workspace；按区域生成的版本串见 mediaPricingVersion）。 */
export const MEDIA_PRICING_VERSION = "dashscope-media-cn-beijing-2026-08-17";

/**
 * LLM seed 输入：当前真实 tier 解析结果的抽象。
 * - stub：本地 stub 模式（env.llm.provider === "stub"），零外部费用。
 * - resolved：tier 解析成功（providers.json 注册 + 凭据健康由 tier resolver 保证）。
 * - resolution_failed：tier 解析失败（如凭据缺失），readiness 必须判 LLM 不可报价。
 */
export type LlmTierSeedInput =
  | { mode: "stub" }
  | {
      mode: "resolved";
      smart: { providerKey: string; modelId: string };
      flash?: { providerKey: string; modelId: string } | { reusesSmart: true };
    }
  | { mode: "resolution_failed" };

/**
 * 媒体 additionalModels 候选（S2-2C §7.2）：运营扩展媒体候选的接口。
 * 首版为空数组（不伪造模型）；候选价格未核实一律 unpriced（诚实原则），
 * 运营核实后在定价表登记即可获得可信上界。
 */
export interface MediaAdditionalModel {
  capability: "image.generate" | "video.image_to_video" | "tts.synthesize";
  providerKey: string;
  modelId: string;
  displayName?: string;
  qualityTier?: string | null;
  speedTier?: string | null;
}

/**
 * tier → slot 目标解析的唯一实现（seed 与 readiness 共用，禁止各自复制一份）。
 * flash 未配置或声明 reusesSmart 时复用 smart；resolution_failed 由调用方处理。
 */
export function resolveLlmTierTarget(
  llm: Extract<LlmTierSeedInput, { mode: "resolved" }>,
  slot: "llm.smart" | "llm.flash",
): { providerKey: string; modelId: string } {
  if (slot === "llm.smart") return llm.smart;
  if (llm.flash && "reusesSmart" in llm.flash) return llm.smart;
  return llm.flash ?? llm.smart;
}

/**
 * 已核实的 LLM token 价格表（CNY，微元/百万 token）。
 *
 * 只允许写入来源可核实的公开价（官方定价页快照 + 核实日期）。
 * 当前环境使用的 deepseek:deepseek-v4-pro、zhipu:glm-4 尚无已核实价格来源，
 * 因此不在表内：对应目录条目 unpriced，报价按 unbounded 处理并要求显式授权。
 * 运营核实后在此追加条目即可让报价获得可信上界。
 */
const VERIFIED_LLM_TOKEN_PRICING: Record<
  string,
  {
    pricingVersion: string;
    input_price_micros_per_million_tokens: string;
    output_price_micros_per_million_tokens: string;
    source_note: string;
  }
> = {
  // 示例形状（保留注释说明，不启用未核实条目）：
  // "deepseek:deepseek-chat": {
  //   pricingVersion: "deepseek-llm-YYYY-MM-DD",
  //   input_price_micros_per_million_tokens: "...",
  //   output_price_micros_per_million_tokens: "...",
  //   source_note: "DeepSeek 官方定价页快照（核实日期）",
  // },
};

const DASHSCOPE_MEDIA_SOURCE_NOTE =
  "backend/src/modules/generation-cost/pricing-catalog.seed.ts（沿用 frontend/src/utils/pricing.ts 引用的阿里云百炼定价页快照，任务 7 落后端真相源）";

interface SeedEntryInput {
  id: string;
  capability: ProviderModelCatalogRecord["capability"];
  providerKey: string;
  modelId: string;
  displayName: string;
  qualityTier: string | null;
  speedTier: string | null;
  parameterCapabilitiesJson: Record<string, unknown>;
  pricingVersion: string;
  pricingJson: Record<string, unknown>;
  isDefault: boolean;
}

function toRecord(input: SeedEntryInput): ProviderModelCatalogRecord {
  const now = new Date();
  return {
    id: input.id,
    capability: input.capability,
    providerKey: input.providerKey,
    modelId: input.modelId,
    modelVersion: null,
    displayName: input.displayName,
    qualityTier: input.qualityTier,
    speedTier: input.speedTier,
    parameterCapabilitiesJson: input.parameterCapabilitiesJson,
    pricingVersion: input.pricingVersion,
    pricingJson: input.pricingJson,
    status: "active",
    isDefault: input.isDefault,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * DashScope 部署区域（deployment scope）。
 * 同一模型在北京与新加坡（dashscope-intl）价格不同；价格目录与 readiness
 * 都必须绑定区域，未知 endpoint fail-closed（不得按猜测区域报价/派发）。
 */
export type DashscopeDeploymentScope = "cn-beijing" | "singapore" | "unknown";

/**
 * 从 DashScope baseUrl 推导部署区域。
 * - 未配置（undefined）→ cn-beijing（DashScope SDK 默认接入域名，adapter 的
 *   nullish 默认值即 https://dashscope.aliyuncs.com）。
 * - 仅接受 https: 协议、空端口或 443、官方精确主机；其他（含**显式空字符串**、
 *   http/ftp/非 443 端口/私有域名/无法解析）→ unknown（fail-closed：不种媒体
 *   目录、不报价、不派发）。空字符串会被 adapter 保留并拼出相对 endpoint，
 *   必须视为畸形而非"未配置"（codex 四审 I-1）。
 */
export function resolveDashscopeDeploymentScope(
  baseUrl: string | undefined,
): DashscopeDeploymentScope {
  if (baseUrl === undefined) return "cn-beijing";
  if (typeof baseUrl !== "string" || baseUrl.length === 0) return "unknown";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return "unknown";
  }
  if (url.protocol !== "https:") return "unknown";
  const port = url.port;
  if (port !== "" && port !== "443") return "unknown";
  const hostname = url.hostname.toLowerCase();
  if (hostname === "dashscope-intl.aliyuncs.com") return "singapore";
  if (hostname === "dashscope.aliyuncs.com") return "cn-beijing";
  return "unknown";
}

/**
 * 构建五个 capability slot 的目录 seed。
 *
 * - 媒体三项（image / video / tts）固定映射当前真实 DashScope 模型
 *   （与 assets-run readDashscopeConfig 的服务端默认模型一致），目录 id 与
 *   价格按部署区域区分；unknown 区域不种媒体行（fail-closed）。
 *   `media.additionalModels`（S2-2C §7.2）种入对应槽位非默认候选行，价格
 *   未核实一律 unpriced（运营核实后登记）。
 * - LLM 两项按传入 tier 映射当前真实 provider/model；stub 模式映射为零外部费用。
 *   `llm.candidates`（S2-2C §7.1）在非 stub 下按槽种入非默认候选行
 *   （与默认重合去重）；条目元数据（displayName/qualityTier/speedTier）一律
 *   来自候选声明（外部审查 P2），tier 解析模型不在候选表时回退槽位默认。
 * - 每个 capability 恰好一个 active + isDefault=true 项（resolver auto 硬合同；
 *   readiness 会再校验一次，零个/多个默认项都会失败）。
 */
export function buildPricingCatalogSeed(input: {
  llm: LlmTierSeedInput & { candidates?: LlmModelCandidate[] };
  media: {
    deploymentScope: DashscopeDeploymentScope;
    additionalModels?: MediaAdditionalModel[];
  };
}): ProviderModelCatalogRecord[] {
  const scope = input.media.deploymentScope;
  if (scope === "unknown") {
    // 未知区域没有已核实价格真相：不种媒体行（readiness 报 capability 级
    // media_deployment_scope_unknown + 缺默认项），不得报价或派发。
    return buildLlmSeedEntries(input.llm);
  }
  const entries: ProviderModelCatalogRecord[] = [
    toRecord({
      id: `image.generate.dashscope.${scope}.wan2.6-t2i`,
      capability: "image.generate",
      providerKey: "dashscope",
      modelId: "wan2.6-t2i",
      displayName: "万相文生图（wan2.6-t2i）",
      qualityTier: "standard",
      speedTier: "standard",
      parameterCapabilitiesJson: { deployment_scope: scope },
      pricingVersion: mediaPricingVersion(scope),
      pricingJson:
        scope === "singapore"
          ? {
              // 新加坡 workspace 的 wan2.6-t2i 价格未核实：unpriced → unbounded。
              unit_type: "image",
              currency: "CNY",
              unpriced: true,
              effective_at: SEED_EFFECTIVE_AT,
              source_note:
                "dashscope-intl 新加坡文生图价格未核实：按 unbounded 处理，运营核实后登记",
            }
          : {
              unit_type: "image",
              currency: "CNY",
              price_micros_per_image: "200000",
              effective_at: SEED_EFFECTIVE_AT,
              source_note: DASHSCOPE_MEDIA_SOURCE_NOTE,
            },
      isDefault: true,
    }),
    toRecord({
      id: `video.image_to_video.dashscope.${scope}.wan2.7-i2v-2026-04-25`,
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
      displayName: "万相图生视频（wan2.7-i2v）",
      qualityTier: "high",
      speedTier: "slow",
      // api_video_qualities 是视频 API 质量档位（配置合同的 api_quality 枚举），
      // 与 Remotion 成片分辨率（720P/1080P 像素串）语义分离，禁止混用。
      // 时长边界与 provider 实际 clamp 行为一致（2-15 秒/任务）。
      parameterCapabilitiesJson: {
        deployment_scope: scope,
        api_video_qualities: ["standard_720p", "high_1080p"],
        min_duration_seconds_per_task: 2,
        max_duration_seconds_per_task: 15,
      },
      pricingVersion: mediaPricingVersion(scope),
      pricingJson: {
        unit_type: "video_second",
        currency: "CNY",
        price_micros_per_second_by_quality:
          scope === "singapore"
            ? // 阿里云百炼新加坡价（外部审计核实）：720P ¥0.74942/秒、1080P ¥1.12413/秒。
              { standard_720p: "749420", high_1080p: "1124130" }
            : { standard_720p: "600000", high_1080p: "1000000" },
        effective_at: SEED_EFFECTIVE_AT,
        source_note: `${DASHSCOPE_MEDIA_SOURCE_NOTE}${scope === "singapore" ? "（新加坡 workspace 价，help.aliyun.com/zh/model-studio/wan2-7-i2v）" : ""}`,
      },
      isDefault: true,
    }),
    toRecord({
      id: `tts.synthesize.dashscope.${scope}.qwen3-tts-instruct-flash`,
      capability: "tts.synthesize",
      providerKey: "dashscope",
      modelId: "qwen3-tts-instruct-flash",
      displayName: "通义千问 TTS（qwen3-tts-instruct-flash）",
      qualityTier: "standard",
      speedTier: "fast",
      parameterCapabilitiesJson: { deployment_scope: scope },
      pricingVersion: mediaPricingVersion(scope),
      pricingJson:
        scope === "singapore"
          ? {
              unit_type: "tts_character",
              currency: "CNY",
              unpriced: true,
              effective_at: SEED_EFFECTIVE_AT,
              source_note:
                "dashscope-intl 新加坡 TTS 价格未核实：按 unbounded 处理，运营核实后登记",
            }
          : {
              unit_type: "tts_character",
              currency: "CNY",
              price_micros_per_10k_characters: "800000",
              effective_at: SEED_EFFECTIVE_AT,
              // 服务端实际配置的 TTS 模型；价格沿用项目内已核实的 qwen3-tts 家族万字符价。
              source_note: DASHSCOPE_MEDIA_SOURCE_NOTE,
            },
      isDefault: true,
    }),
  ];

  // S2-2C §7.2：媒体候选种入对应槽位（非默认；与默认行同 provider:model 去重）。
  // 候选价格未核实 → unpriced（unbounded，预算门禁必须显式授权）。
  const defaultMediaKeys = new Set(
    entries.map((e) => `${e.capability}\u0000${e.providerKey}\u0000${e.modelId}`),
  );
  for (const candidate of input.media.additionalModels ?? []) {
    const key = `${candidate.capability}\u0000${candidate.providerKey}\u0000${candidate.modelId}`;
    if (defaultMediaKeys.has(key)) continue;
    defaultMediaKeys.add(key);
    entries.push(
      toRecord({
        id: `${candidate.capability}.${candidate.providerKey}.${scope}.${candidate.modelId}`,
        capability: candidate.capability,
        providerKey: candidate.providerKey,
        modelId: candidate.modelId,
        displayName: candidate.displayName ?? `${candidate.providerKey}:${candidate.modelId}`,
        qualityTier: candidate.qualityTier ?? null,
        speedTier: candidate.speedTier ?? null,
        parameterCapabilitiesJson: { deployment_scope: scope },
        pricingVersion: `dashscope-media-${scope}-2026-08-17-candidate`,
        pricingJson: {
          unit_type:
            candidate.capability === "image.generate"
              ? "image"
              : candidate.capability === "video.image_to_video"
                ? "video_second"
                : "tts_character",
          currency: "CNY",
          unpriced: true,
          effective_at: SEED_EFFECTIVE_AT,
          source_note:
            "媒体候选模型价格未核实：按 unbounded 处理（预算门禁必须显式授权），运营核实后登记",
        },
        isDefault: false,
      }),
    );
  }

  entries.push(...buildLlmSeedEntries(input.llm));
  return entries;
}

/** 媒体价格版本按部署区域区分（价格目录与区域绑定）。 */
function mediaPricingVersion(scope: Exclude<DashscopeDeploymentScope, "unknown">): string {
  return `dashscope-media-${scope}-2026-08-17`;
}

function buildLlmSeedEntries(
  llm: LlmTierSeedInput & { candidates?: LlmModelCandidate[] },
): ProviderModelCatalogRecord[] {
  if (llm.mode === "stub") {
    return [
      buildLlmEntry({
        slot: "llm.smart",
        providerKey: "stub",
        modelId: "stub-model",
        pricing: stubTokenPricing(),
        isDefault: true,
      }),
      buildLlmEntry({
        slot: "llm.flash",
        providerKey: "stub",
        modelId: "stub-model",
        pricing: stubTokenPricing(),
        isDefault: true,
      }),
    ];
  }

  // resolution_failed：仍种入 tier 声明的占位映射没有意义（无法得知真实 provider/model），
  // 这里返回空 LLM 条目，readiness 会因缺 active 默认项而失败——这正是期望的 fail-safe。
  if (llm.mode === "resolution_failed") {
    return [];
  }

  const smart = resolveLlmTierTarget(llm, "llm.smart");
  const flash = resolveLlmTierTarget(llm, "llm.flash");

  const entries = [
    buildLlmEntry({
      slot: "llm.smart",
      providerKey: smart.providerKey,
      modelId: smart.modelId,
      pricing: llmTokenPricing(smart),
      isDefault: true,
      candidates: llm.candidates,
    }),
    buildLlmEntry({
      slot: "llm.flash",
      providerKey: flash.providerKey,
      modelId: flash.modelId,
      pricing: llmTokenPricing(flash),
      isDefault: true,
      candidates: llm.candidates,
    }),
  ];

  // S2-2C §7.1：每个候选种入其声明槽位（缺省两槽；2026-08-25 起 DeepSeek
  // 按档位拆分：v4-pro 仅 smart、v4-flash 仅 flash）；与槽位默认（tier 解析
  // 结果）重合的候选去重，不重复种入。
  if (llm.candidates && llm.candidates.length > 0) {
    const slotTargets: Array<{ slot: "llm.smart" | "llm.flash"; target: { providerKey: string; modelId: string } }> = [
      { slot: "llm.smart", target: smart },
      { slot: "llm.flash", target: flash },
    ];
    for (const { slot, target } of slotTargets) {
      for (const candidate of llm.candidates) {
        if (candidate.slots && !candidate.slots.includes(slot)) {
          continue; // 候选声明不适用该槽位
        }
        if (
          candidate.providerKey === target.providerKey &&
          candidate.modelId === target.modelId
        ) {
          continue; // 与默认重合：去重
        }
        entries.push(
          buildLlmEntry({
            slot,
            providerKey: candidate.providerKey,
            modelId: candidate.modelId,
            pricing: llmTokenPricing(candidate),
            isDefault: false,
            candidates: llm.candidates,
          }),
        );
      }
    }
  }

  return entries;
}

function stubTokenPricing(): Record<string, unknown> {
  return {
    unit_type: "token",
    currency: "CNY",
    free: true,
    input_price_micros_per_million_tokens: "0",
    output_price_micros_per_million_tokens: "0",
    effective_at: SEED_EFFECTIVE_AT,
    source_note: "stub/local 模式：零外部费用（无真实 provider 调用）",
  };
}

function llmTokenPricing(target: {
  providerKey: string;
  modelId: string;
}): Record<string, unknown> {
  const key = `${target.providerKey}:${target.modelId}`;
  const verified = VERIFIED_LLM_TOKEN_PRICING[key];
  if (!verified) {
    return {
      unit_type: "token",
      currency: "CNY",
      unpriced: true,
      effective_at: SEED_EFFECTIVE_AT,
      source_note:
        "无已核实公开价：报价按 unbounded 处理（预算门禁必须显式授权），运营核实后在 VERIFIED_LLM_TOKEN_PRICING 登记",
    };
  }
  return {
    unit_type: "token",
    currency: "CNY",
    input_price_micros_per_million_tokens:
      verified.input_price_micros_per_million_tokens,
    output_price_micros_per_million_tokens:
      verified.output_price_micros_per_million_tokens,
    effective_at: SEED_EFFECTIVE_AT,
    source_note: verified.source_note,
  };
}

/**
 * LLM 目录条目构造（S2-2C §7.1 元数据合同，外部审查 P2）：
 * displayName/qualityTier/speedTier 一律来自候选声明（按 providerKey:modelId
 * 匹配），默认条目与候选条目统一；tier 解析模型不在候选表时回退槽位默认
 * （displayName=provider:model，质量/速度按槽位硬编码现状）。
 */
function buildLlmEntry(input: {
  slot: "llm.smart" | "llm.flash";
  providerKey: string;
  modelId: string;
  pricing: Record<string, unknown>;
  isDefault: boolean;
  candidates?: LlmModelCandidate[];
}): ProviderModelCatalogRecord {
  const declared = input.candidates?.find(
    (candidate) =>
      candidate.providerKey === input.providerKey && candidate.modelId === input.modelId,
  );
  return toRecord({
    id: `llm.${input.slot === "llm.smart" ? "smart" : "flash"}.${input.providerKey}.${input.modelId}`,
    capability: input.slot,
    providerKey: input.providerKey,
    modelId: input.modelId,
    displayName: declared?.displayName ?? `${input.providerKey}:${input.modelId}`,
    qualityTier: declared?.qualityTier ?? (input.slot === "llm.smart" ? "high" : "standard"),
    speedTier: declared?.speedTier ?? (input.slot === "llm.smart" ? "slow" : "fast"),
    parameterCapabilitiesJson: {},
    // LLM 价格版本与具体 provider/model 绑定；未核实条目也有稳定版本号，
    // 保证 unbounded 状态本身可被 pricing hash 追踪。
    pricingVersion: `llm-${input.providerKey}-2026-08-17`,
    pricingJson: input.pricing,
    isDefault: input.isDefault,
  });
}
