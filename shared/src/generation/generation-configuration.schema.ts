import { z } from "zod";

import {
  ArtStyleResolvedParams,
  SubtitleStyleOverrideSet,
} from "../creative/creative-preset.schema.js";
import { SubtitleStyle } from "../assets/asset-manifest.schema.js";

/**
 * S2-2A 生成配置合同。
 *
 * 设计依据：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-design.md
 * （第 3 节）。
 *
 * 该 schema 是 S2-2A/B/C 三档共享的唯一配置作用域。A 只允许修改 `video` 与
 * `budget`；`creative` 与 `capabilities` 的 fixed 选择留给 B/C 直接扩展同一
 * schema，不再更换配置作用域或运行快照模型。
 */

// --- 基础枚举 --------------------------------------------------------------

export const VideoGenerationStrategy = z.enum([
  "all_api_video",
  "prefer_api_video",
  "prefer_remotion",
  "all_remotion",
]);
export type VideoGenerationStrategy = z.infer<typeof VideoGenerationStrategy>;

export const ApiVideoQuality = z.enum(["standard_720p", "high_1080p"]);
export type ApiVideoQuality = z.infer<typeof ApiVideoQuality>;

/**
 * Storyboard 分镜适配度。LLM/stub 只输出这四档，不自行决定付费调用。
 * 适配度到实际路线的映射由纯函数 resolver 完成（见 generation-configuration-resolver.ts）。
 */
export const ApiVideoSuitability = z.enum([
  "remotion_only",
  "remotion_sufficient",
  "api_video_beneficial",
  "api_video_strongly_recommended",
]);
export type ApiVideoSuitability = z.infer<typeof ApiVideoSuitability>;

/**
 * 已解析的实际视觉路线。`api_video` 走真实视频 provider，`remotion` 走静态图 + Remotion 运镜。
 */
export const ResolvedVisualRoute = z.enum(["api_video", "remotion"]);
export type ResolvedVisualRoute = z.infer<typeof ResolvedVisualRoute>;

/**
 * 用户可分镜覆盖的视觉策略值。`null` 表示继承项目策略解析结果。
 */
export const SegmentVisualStrategyOverride = z.union([
  z.literal("api_video"),
  z.literal("remotion_motion"),
  z.null(),
]);
export type SegmentVisualStrategyOverride = z.infer<
  typeof SegmentVisualStrategyOverride
>;

// --- Capability 与 Model 选择 ----------------------------------------------

export const CAPABILITY_SLOTS = [
  "llm.smart",
  "llm.flash",
  "image.generate",
  "video.image_to_video",
  "tts.synthesize",
] as const;
export type CapabilitySlot = (typeof CAPABILITY_SLOTS)[number];

/**
 * 单个 capability 的选择模式。
 * - `auto`: 由 resolver 在启用目录中选择当前平台默认能力（S2-2A 全部使用 auto）。
 * - `fixed`: S2-2C 起用户/管理员显式固定到某个 provider_model_id。
 */
export const ModelSelection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }).strict(),
  z
    .object({
      mode: z.literal("fixed"),
      provider_model_id: z.string().min(1),
    })
    .strict(),
]);
export type ModelSelection = z.infer<typeof ModelSelection>;

/**
 * 五个固定 capability slot 的选择集合。
 */
export const CapabilitySelectionMap = z
  .object({
    "llm.smart": ModelSelection,
    "llm.flash": ModelSelection,
    "image.generate": ModelSelection,
    "video.image_to_video": ModelSelection,
    "tts.synthesize": ModelSelection,
  })
  .strict();
export type CapabilitySelectionMap = z.infer<typeof CapabilitySelectionMap>;

// --- 预算 ------------------------------------------------------------------

/**
 * 微元金额的十进制字符串。
 *
 * 约束（与详细设计第 4 节和第 8 节一致）：
 * - 数据库/内部计算使用整数微元，不使用浮点。
 * - JSON API 边界统一序列化为十进制字符串，避免 number 超出安全整数。
 * - 字符串只允许 0-9 数字（无小数点、无符号、无科学计数法），表示整数微元。
 */
const decimalMicrosString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "micros amount must be a non-negative decimal integer string");

export const BudgetConfiguration = z
  .object({
    currency: z.literal("CNY"),
    /**
     * 单次运行的最大付费授权上限（微元）。`null` 表示不设上限。
     */
    max_paid_cost_micros_per_run: decimalMicrosString.nullable(),
  })
  .strict();
export type BudgetConfiguration = z.infer<typeof BudgetConfiguration>;

// --- Creative（S2-2A 占位，B 实施时填充） -----------------------------------

/**
 * 创作偏好（S2-2B 开放写入）。
 *
 * - 三个 preset 槽位是稳定 ID；`null` 表示自动/系统默认（音色 auto 匹配、
 *   画风不启用、字幕用系统默认样式）。
 * - `subtitle_style_overrides` 是有限安全参数覆盖（白名单见 creative-preset.schema），
 *   可选字段缺省 `{}`——旧存储 JSON（无该字段）解析自动补缺省，无需迁移。
 * - B 阶段支持单次运行覆盖（RunOverridesSchema / GenerationQuoteRunOverridesSchema
 *   的 creative 段），覆盖只进入当次运行快照。
 */
export const CreativePreferences = z
  .object({
    voice_profile_id: z.string().min(1).nullable(),
    art_style_preset_id: z.string().min(1).nullable(),
    subtitle_style_preset_id: z.string().min(1).nullable(),
    subtitle_style_overrides: SubtitleStyleOverrideSet.default({}),
  })
  .strict();
export type CreativePreferences = z.infer<typeof CreativePreferences>;

/**
 * 单次运行覆盖的 creative 段（逐字段覆盖语义）：
 * - 字段提供 → 覆盖项目配置对应值；
 * - 显式 `null` → 该槽位重置为 auto/none；
 * - 字段缺省 → 保持项目配置值。
 * 与 video/budget 覆盖一样：只进入当次运行快照，不写回项目配置。
 */
export const CreativeRunOverrideSchema = z
  .object({
    voice_profile_id: z.string().min(1).nullable().optional(),
    art_style_preset_id: z.string().min(1).nullable().optional(),
    subtitle_style_preset_id: z.string().min(1).nullable().optional(),
    subtitle_style_overrides: SubtitleStyleOverrideSet.optional(),
  })
  .strict();
export type CreativeRunOverride = z.infer<typeof CreativeRunOverrideSchema>;

// --- 主配置合同 ------------------------------------------------------------

export const GenerationConfigurationV1 = z
  .object({
    schema_version: z.literal("generation_configuration_v1"),
    video: z
      .object({
        strategy: VideoGenerationStrategy,
        api_quality: ApiVideoQuality,
      })
      .strict(),
    budget: BudgetConfiguration,
    creative: CreativePreferences,
    capabilities: CapabilitySelectionMap,
  })
  .strict();
export type GenerationConfigurationV1 = z.infer<typeof GenerationConfigurationV1>;

/**
 * S2-2A 默认配置（详细设计 3.2 节）：
 * prefer_remotion + standard_720p + 无预算上限 + creative 全 null + capabilities 全 auto。
 */
export const DEFAULT_GENERATION_CONFIGURATION: GenerationConfigurationV1 = {
  schema_version: "generation_configuration_v1",
  video: {
    strategy: "prefer_remotion",
    api_quality: "standard_720p",
  },
  budget: {
    currency: "CNY",
    max_paid_cost_micros_per_run: null,
  },
  creative: {
    voice_profile_id: null,
    art_style_preset_id: null,
    subtitle_style_preset_id: null,
    subtitle_style_overrides: {},
  },
  capabilities: {
    "llm.smart": { mode: "auto" },
    "llm.flash": { mode: "auto" },
    "image.generate": { mode: "auto" },
    "video.image_to_video": { mode: "auto" },
    "tts.synthesize": { mode: "auto" },
  },
};

/**
 * S2-2A 专用 PATCH schema（详细设计 3.1 节 + 实施计划任务 3）。
 * A 阶段只允许修改 video 和 budget；creative 三项必须保持 null，
 * 五个 capability 必须保持 {mode:"auto"}。
 * 完整 GenerationConfigurationV1 仍用于持久化和快照（B/C 可扩展），
 * 但 A 阶段 API 入口用此 strict schema 拒绝越权字段。
 */
export const S2_2A_PATCH_ALLOWED_FIELDS = z
  .object({
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
    // 强制 creative 全 null（A 阶段不接受 B/C 字段）
    creative: z.object({
      voice_profile_id: z.null(),
      art_style_preset_id: z.null(),
      subtitle_style_preset_id: z.null(),
    }),
    // 强制 capabilities 全 auto（A 阶段不接受 fixed）
    capabilities: z.object({
      "llm.smart": z.object({ mode: z.literal("auto") }),
      "llm.flash": z.object({ mode: z.literal("auto") }),
      "image.generate": z.object({ mode: z.literal("auto") }),
      "video.image_to_video": z.object({ mode: z.literal("auto") }),
      "tts.synthesize": z.object({ mode: z.literal("auto") }),
    }),
  })
  .strict();

/**
 * S2-2A 用户偏好 PATCH 请求包装：expected_revision 可 null（首次创建）。
 */
export const S2_2A_ConfigPatchRequest = z
  .object({
    expected_revision: z.number().int().nonnegative().nullable(),
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
  })
  .strict();
export type S2_2A_ConfigPatchRequest = z.infer<typeof S2_2A_ConfigPatchRequest>;

/**
 * S2-2A 项目配置 PATCH 请求包装：expected_revision 必须是非负整数（不接受 null）。
 * 项目配置在创建项目时已冻结，或首次读取时 backfill，因此始终有 revision。
 */
export const S2_2A_ProjectConfigPatchRequest = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
  })
  .strict();
export type S2_2A_ProjectConfigPatchRequest = z.infer<typeof S2_2A_ProjectConfigPatchRequest>;

/**
 * S2-2B PATCH schema（两阶段替换：本任务新增，任务 8 切换引用后删除 A 版）。
 * 在 A 的 `{ expected_revision, video, budget }` 基础上增加可选 `creative` 段：
 * - `creative` 提供时整体替换三个槽位 + 覆盖集合；
 * - `creative` 缺省时保持现值（A 期请求体兼容）。
 * capabilities 仍不开放（S2-2C 处理）。
 */
export const S2_2B_ConfigPatchRequest = z
  .object({
    expected_revision: z.number().int().nonnegative().nullable(),
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
    creative: CreativePreferences.optional(),
  })
  .strict();
export type S2_2B_ConfigPatchRequest = z.infer<typeof S2_2B_ConfigPatchRequest>;

export const S2_2B_ProjectConfigPatchRequest = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
    creative: CreativePreferences.optional(),
  })
  .strict();
export type S2_2B_ProjectConfigPatchRequest = z.infer<typeof S2_2B_ProjectConfigPatchRequest>;

/**
 * S2-2C PATCH schema（两阶段替换：本任务新增 C 版，后端 repository/controller
 * 在任务 3 切换引用；B 版符号按 B 先例保留为历史，切换后自审无业务引用）。
 * 在 B 的 `{ expected_revision, video, budget, creative? }` 基础上增加可选
 * `capabilities` 段：提供时五槽整体替换（`CapabilitySelectionMap` strict 五键）；
 * 缺省时的语义（保留现有配置值 / 首次创建全 auto）由 controller 组装层决定，
 * schema 层只保证形状（见 S2-2C 详细设计 §4.1）。
 */
export const S2_2C_ConfigPatchRequest = z
  .object({
    expected_revision: z.number().int().nonnegative().nullable(),
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
    creative: CreativePreferences.optional(),
    capabilities: CapabilitySelectionMap.optional(),
  })
  .strict();
export type S2_2C_ConfigPatchRequest = z.infer<typeof S2_2C_ConfigPatchRequest>;

export const S2_2C_ProjectConfigPatchRequest = z
  .object({
    expected_revision: z.number().int().nonnegative(),
    video: z.object({
      strategy: VideoGenerationStrategy,
      api_quality: ApiVideoQuality,
    }),
    budget: BudgetConfiguration,
    creative: CreativePreferences.optional(),
    capabilities: CapabilitySelectionMap.optional(),
  })
  .strict();
export type S2_2C_ProjectConfigPatchRequest = z.infer<typeof S2_2C_ProjectConfigPatchRequest>;

// --- S2-2A API 响应 DTO（实施计划任务 3：请求与响应都用共享 Zod 校验） -------

/** 失效预览（配置变更影响的最早阶段，不自动触发下游）。 */
export const ConfigurationInvalidationPreview = z
  .object({
    affected_stages: z.array(z.string().min(1)),
    note: z.string().min(1),
  })
  .strict();
export type ConfigurationInvalidationPreview = z.infer<typeof ConfigurationInvalidationPreview>;

/** GET/PATCH /api/me/generation-preferences 响应。 */
export const UserGenerationPreferenceResponse = z
  .object({
    source: z.enum(["stored", "backfilled_default"]),
    revision: z.number().int().nonnegative(),
    configuration: GenerationConfigurationV1,
    updated_at: z.string().min(1),
  })
  .strict();
export type UserGenerationPreferenceResponse = z.infer<typeof UserGenerationPreferenceResponse>;

/** GET/PATCH /api/projects/:id/generation-configuration 响应。 */
export const ProjectGenerationConfigurationResponse = z
  .object({
    source: z.enum(["stored", "backfilled_default"]),
    revision: z.number().int().nonnegative(),
    configuration: GenerationConfigurationV1,
    updated_at: z.string().min(1),
    source_user_preference_revision: z.number().int().nonnegative().nullable(),
    diff_from_user_default: z.record(z.string(), z.unknown()).nullable(),
    invalidation_preview: ConfigurationInvalidationPreview,
  })
  .strict();
export type ProjectGenerationConfigurationResponse = z.infer<typeof ProjectGenerationConfigurationResponse>;

/** GET /api/generation-capabilities 单项与整体响应。 */
export const PublicCapabilityEntrySchema = z
  .object({
    id: z.string().min(1),
    capability: z.enum(CAPABILITY_SLOTS),
    provider_key: z.string().min(1),
    model_id: z.string().min(1),
    model_version: z.string().min(1).nullable(),
    display_name: z.string().min(1),
    quality_tier: z.string().min(1).nullable(),
    speed_tier: z.string().min(1).nullable(),
    parameter_capabilities: z.record(z.string(), z.unknown()),
    pricing_version: z.string().min(1),
    pricing: z.record(z.string(), z.unknown()),
    status: z.enum(["active", "disabled"]),
    is_default: z.boolean(),
    availability: z.enum(["enabled", "disabled"]),
  })
  .strict();
export type PublicCapabilityEntryDto = z.infer<typeof PublicCapabilityEntrySchema>;

export const GenerationCapabilitiesResponse = z
  .object({
    capabilities: z.array(PublicCapabilityEntrySchema),
  })
  .strict();
export type GenerationCapabilitiesResponse = z.infer<typeof GenerationCapabilitiesResponse>;

/** GET /api/creative-presets 单项（画风/字幕 preset 公开目录）。 */
export const PublicCreativePresetSchema = z
  .object({
    preset_id: z.string().min(1),
    preset_version: z.string().min(1),
    display_name: z.string().min(1),
    description: z.string().min(1),
    /** 字幕 preset 允许被覆盖的字段白名单（画风为 null）。 */
    overridable_fields: z.array(z.string().min(1)).nullable(),
    /** 展示摘要（画风：视觉基调与负面清单数量；字幕：无）。 */
    summary: z.string().min(1),
  })
  .strict();
export type PublicCreativePresetDto = z.infer<typeof PublicCreativePresetSchema>;

export const CreativePresetsResponse = z
  .object({
    art_style: z.array(PublicCreativePresetSchema),
    subtitle: z.array(PublicCreativePresetSchema),
  })
  .strict();
export type CreativePresetsResponse = z.infer<typeof CreativePresetsResponse>;

/**
 * 验证完整配置是否符合 S2-2A 约束（creative 全 null + capabilities 全 auto）。
 * 用于在持久化前拒绝 B/C 字段被提前写入。
 */
export function assertS22AScopeConstraints(
  config: GenerationConfigurationV1,
): { ok: true } | { ok: false; reason: string } {
  if (config.creative.voice_profile_id !== null || config.creative.art_style_preset_id !== null || config.creative.subtitle_style_preset_id !== null) {
    return { ok: false, reason: "S2-2A 不允许设置 creative 偏好（voice_profile_id / art_style_preset_id / subtitle_style_preset_id 必须为 null）" };
  }
  for (const slot of Object.keys(config.capabilities)) {
    const sel = config.capabilities[slot as keyof typeof config.capabilities];
    if (sel.mode !== "auto") {
      return { ok: false, reason: `S2-2A 不允许 fixed capability（${slot} 必须为 auto）` };
    }
  }
  return { ok: true };
}

/**
 * S2-2B 配置 scope 校验：creative 开放（音色/画风/字幕 preset 与安全覆盖），
 * capabilities 仍必须全 auto（S2-2C 才开放 fixed）。
 */
export function assertS22BScopeConstraints(
  config: GenerationConfigurationV1,
): { ok: true } | { ok: false; reason: string } {
  for (const slot of Object.keys(config.capabilities)) {
    const sel = config.capabilities[slot as keyof typeof config.capabilities];
    if (sel.mode !== "auto") {
      return { ok: false, reason: `S2-2B 不允许 fixed capability（${slot} 必须为 auto）` };
    }
  }
  return { ok: true };
}

/**
 * S2-2C 配置 scope 校验：creative 开放（同 B），capabilities 开放 auto 与 fixed。
 * 形态合法性（mode 枚举、provider_model_id 非空）由 `ModelSelection` schema 层
 * 保证；本函数保留为 repository/controller 的统一 scope 检查点（错误码
 * `configuration_invalid_s2_2c_scope`），对 capabilities 只做防御性复核。
 */
export function assertS22CScopeConstraints(
  config: GenerationConfigurationV1,
): { ok: true } | { ok: false; reason: string } {
  for (const slot of Object.keys(config.capabilities)) {
    const sel = config.capabilities[slot as keyof typeof config.capabilities];
    if (sel.mode !== "auto" && sel.mode !== "fixed") {
      return { ok: false, reason: `S2-2C 不允许非法 capability 形态（${slot}）` };
    }
  }
  return { ok: true };
}

// --- Resolved creative（S2-2B：解析后冻结进快照的创作偏好） ------------------

/**
 * 解析后的音色选择。
 * - `mode=auto`：执行端按资产计划 voice_intent 确定性匹配（不冻结具体档案）。
 * - `mode=fixed`：冻结显式选择的档案**稳定身份字段**（id/kind/provider_name/
 *   target_model）。`provider_status`/`usage_count`/`preview_audio_uri` 等执行期
 *   可变状态**不参与解析与 hash**——保证报价→提交两次解析 hash 稳定。
 */
export const ResolvedCreativeVoiceSchema = z
  .object({
    mode: z.enum(["auto", "fixed"]),
    voice_profile_id: z.string().min(1).nullable(),
    kind: z.string().min(1).nullable(),
    provider_name: z.string().min(1).nullable(),
    target_model: z.string().min(1).nullable(),
  })
  .strict();
export type ResolvedCreativeVoice = z.infer<typeof ResolvedCreativeVoiceSchema>;

/** 解析后的画风选择：`mode=none` 表示不启用（保持 LLM 自由生成 art_bible）。 */
export const ResolvedArtStyleSchema = z
  .object({
    mode: z.enum(["none", "fixed"]),
    preset_id: z.string().min(1).nullable(),
    preset_version: z.string().min(1).nullable(),
    resolved_params: ArtStyleResolvedParams.nullable(),
  })
  .strict();
export type ResolvedArtStyle = z.infer<typeof ResolvedArtStyleSchema>;

/**
 * 解析后的字幕选择：`mode=none` 表示执行端用系统默认样式（DEFAULT_SUBTITLE_STYLE）；
 * `mode=fixed` 冻结最终完整样式（preset + 安全覆盖）与 applied_overrides。
 */
export const ResolvedSubtitleSchema = z
  .object({
    mode: z.enum(["none", "fixed"]),
    preset_id: z.string().min(1).nullable(),
    preset_version: z.string().min(1).nullable(),
    resolved_style: SubtitleStyle.nullable(),
    applied_overrides: SubtitleStyleOverrideSet,
  })
  .strict();
export type ResolvedSubtitle = z.infer<typeof ResolvedSubtitleSchema>;

export const ResolvedCreativeV1Schema = z
  .object({
    voice: ResolvedCreativeVoiceSchema,
    art_style: ResolvedArtStyleSchema,
    subtitle: ResolvedSubtitleSchema,
  })
  .strict();
export type ResolvedCreativeV1 = z.infer<typeof ResolvedCreativeV1Schema>;

/**
 * A 期语义的 resolved_creative 缺省值（creative 全 null）：
 * voice=auto、art_style/subtitle=none。用于读取旧快照 JSON 时的兼容缺省
 * （历史快照没有 resolved_creative 字段）；resolver 输出总是显式构造该值。
 */
export const DEFAULT_RESOLVED_CREATIVE: ResolvedCreativeV1 = {
  voice: {
    mode: "auto",
    voice_profile_id: null,
    kind: null,
    provider_name: null,
    target_model: null,
  },
  art_style: {
    mode: "none",
    preset_id: null,
    preset_version: null,
    resolved_params: null,
  },
  subtitle: {
    mode: "none",
    preset_id: null,
    preset_version: null,
    resolved_style: null,
    applied_overrides: {},
  },
};

// --- Resolution trace & applied constraints --------------------------------

export const ResolutionTraceEntry = z
  .object({
    layer: z.enum([
      "system_constraint",
      "admin_enabled_scope",
      "project_configuration",
      "run_override",
      "segment_override",
      "capability_catalog",
    ]),
    note: z.string().min(1),
  })
  .strict();
export type ResolutionTraceEntry = z.infer<typeof ResolutionTraceEntry>;

export const AppliedConstraint = z
  .object({
    constraint: z.enum([
      "api_video_provider_disabled",
      "capability_disabled",
      "segment_override_applied",
      "strategy_overrides_suitability",
    ]),
    note: z.string().min(1),
  })
  .strict();
export type AppliedConstraint = z.infer<typeof AppliedConstraint>;

// --- Hash algorithm identity ----------------------------------------------

/**
 * 漂移检测 hash 算法标识。
 *
 * 当前实现使用 64-bit FNV-1a（确定性、非加密）。它**只用于检测配置/目录漂移**：
 * 提交时服务端重新解析并比对 hash，确认 quote 基于的配置/目录未被改过。
 * 它**不得作为授权边界或防篡改指纹**——加密级 quote 绑定由任务 8 的
 * quote_fingerprint（SHA-256，提交事务在服务端生成）承担。
 *
 * 选择 FNV-1a 而非 node:crypto 是为了让 shared 包保持无 Node 依赖、resolver 保持
 * 纯同步纯函数。漂移检测不需要加密强度：攻击面要求能控制服务端 canonical JSON 的
 * 计算结果，而 canonical JSON 由服务端确定性生成（见 canonicalStringify）。
 */
export const DRIFT_HASH_ALGORITHM = "fnv1a64";

/**
 * 漂移检测 hash 的格式 schema：固定 `fnv1a64:` 前缀 + 16 位十六进制。
 * 若后续升级算法，在此扩展并同步更新 KNOWN_DRIFT_HASH_PREFIXES。
 */
export const DriftHashSchema = z
  .string()
  .regex(/^fnv1a64:[0-9a-f]{16}$/, "drift hash must be fnv1a64:<16-hex>");

/**
 * 可信的漂移 hash 前缀（用于跨字段一致性校验与审计）。
 */
export const KNOWN_DRIFT_HASH_PREFIXES = ["fnv1a64:"] as const;

/**
 * 加密级 hash 前缀（任务 8 quote_fingerprint 使用，resolver 当前不产出）。
 */
export const KNOWN_CRYPTO_HASH_PREFIXES = ["sha256:"] as const;

// --- Resolver output sub-schemas（强类型，供 resolver 与 snapshot 复用） ----

/**
 * 解析后单个 capability slot 的实际 provider/model。
 */
export const ResolvedProviderModelSchema = z
  .object({
    mode: z.enum(["auto", "fixed"]),
    provider_model_id: z.string().min(1),
    provider_key: z.string().min(1),
    model_id: z.string().min(1),
  })
  .strict();
export type ResolvedProviderModel = z.infer<typeof ResolvedProviderModelSchema>;

/**
 * 解析后单个分镜的视觉路线。
 */
export const ResolvedSegmentVisualRouteSchema = z
  .object({
    segment_id: z.string().min(1),
    api_video_suitability: ApiVideoSuitability,
    segment_override: SegmentVisualStrategyOverride,
    resolved_route: ResolvedVisualRoute,
    reason_code: z.string().min(1),
  })
  .strict();
export type ResolvedSegmentVisualRoute = z.infer<
  typeof ResolvedSegmentVisualRouteSchema
>;

/**
 * resolved_capabilities 必须为五个固定 slot 各提供一个已解析 provider/model。
 */
export const ResolvedCapabilityMapSchema = z
  .object({
    "llm.smart": ResolvedProviderModelSchema,
    "llm.flash": ResolvedProviderModelSchema,
    "image.generate": ResolvedProviderModelSchema,
    "video.image_to_video": ResolvedProviderModelSchema,
    "tts.synthesize": ResolvedProviderModelSchema,
  })
  .strict();
export type ResolvedCapabilityMap = z.infer<typeof ResolvedCapabilityMapSchema>;

/**
 * resolver 输出合同（详细设计 5.2 节）。
 *
 * 重要边界（P1-1/P1-2 整改）：
 * - `configuration_hash` 与 `catalog_hash` 都由 resolver 用 FNV-1a64 计算，**只用于
 *   漂移检测**（提交时重新解析并比对，确认 quote 基于的配置/目录未被改过）。它们
 *   **不是授权边界指纹**：攻击者要伪造等于构造服务端 canonical JSON，而 canonical
 *   JSON 由服务端确定性生成。
 * - resolver **不产出 `pricing_hash`**：定价 hash 必须由任务 7 的可信 PricingService
 *   基于标准化价格版本与价格内容生成，并随 quote 一起持久化（见 RunConfigurationSnapshotV1。
 *   pricing_hash 可空字段）。之前把 catalog hash 命名为 pricing_hash 是错误：catalog
 *   输入不含任何价格信息，价格单独变化时该 hash 不会变化，无法支撑"价格变化使旧 quote
 *   失效"。
 * - 加密级 quote 绑定（防篡改授权）由任务 8 在提交事务中生成的独立
 *   `quote_fingerprint` 承担，不复用这里的漂移检测 hash。
 */
export const ResolvedGenerationConfigurationV1Schema = z
  .object({
    schema_version: z.literal("resolved_generation_configuration_v1"),
    source_revisions: z
      .object({
        source_user_preference_revision: z.number().int().nonnegative().nullable(),
        project_configuration_revision: z.number().int().nonnegative(),
      })
      .strict(),
    effective: GenerationConfigurationV1,
    resolved_capabilities: ResolvedCapabilityMapSchema,
    segment_visual_routes: z.array(ResolvedSegmentVisualRouteSchema),
    constraints_applied: z.array(AppliedConstraint),
    resolution_trace: z.array(ResolutionTraceEntry),
    /**
     * S2-2B 解析后的创作偏好（冻结进快照）。
     * 缺省值 = A 期语义（voice auto / art none / subtitle none），
     * 保证历史快照 JSON 无需迁移即可读取。
     */
    resolved_creative: ResolvedCreativeV1Schema.default(DEFAULT_RESOLVED_CREATIVE),
    configuration_hash: DriftHashSchema,
    /**
     * provider/model 目录内容的漂移检测 hash（不含价格）。价格变化检测由
     * PricingService 的 pricing_hash（任务 7）承担。
     */
    catalog_hash: DriftHashSchema,
  })
  .strict();
export type ResolvedGenerationConfigurationV1 = z.infer<
  typeof ResolvedGenerationConfigurationV1Schema
>;

// --- Run Configuration Snapshot（不可变运行快照合同，详细设计 4.6 节） -----

/**
 * 不可变运行快照。重新运行必须创建新快照；repository 不提供 update。
 *
 * 该 schema 是任务 2 持久化合同的强类型基础，包含详细设计 4.6 节规定的全部字段：
 * 运行定位、来源 revision、resolved 配置、trace、关联 quote、费用与预算授权、价格版本、
 * 创建时间。
 *
 * 一致性约束（P1-3 整改）：顶层 `configuration_hash`/`catalog_hash`/`source_revisions`
 * 必须与 `resolved` 内部对应字段完全一致；hash 字段强制 `fnv1a64:` 格式；`created_at`
 * 强制 ISO 8601；`pricing_hash`/`quote_fingerprint` 可空（分别由任务 7 PricingService
 * 与任务 8 提交事务填充，resolver 不产出）。
 */
export const RunConfigurationSnapshotV1 = z
  .object({
    schema_version: z.literal("run_configuration_snapshot_v1"),
    // 运行定位（owner scope 与 run 定位由持久化层填充，resolver 不直接产出这些字段）
    project_id: z.string().min(1),
    user_id: z.string().min(1).nullable(),
    stage: z.string().min(1),
    operation: z.string().min(1),
    run_id: z.string().min(1).nullable(),
    // 来源 revision
    source_revisions: z
      .object({
        source_user_preference_revision: z.number().int().nonnegative().nullable(),
        project_configuration_revision: z.number().int().nonnegative(),
      })
      .strict(),
    // resolved 配置（强类型，禁止 unknown）
    resolved: ResolvedGenerationConfigurationV1Schema,
    // 漂移检测 hash：顶层副本必须与 resolved 内部一致（见 superRefine）
    configuration_hash: DriftHashSchema,
    catalog_hash: DriftHashSchema,
    // 关联 quote（免费运行为 null）
    quote_id: z.string().min(1).nullable(),
    // 加密级 quote 指纹（任务 8 提交事务生成，resolver 不产出；免费运行可空）
    quote_fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    // 费用与预算授权（微元十进制字符串）
    estimated_cost_micros: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
    authorization_cost_micros: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
    budget_limit_micros: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(),
    budget_override_authorized: z.boolean(),
    // 价格版本集合
    pricing_version_set: z.array(z.string().min(1)),
    // 定价 hash：由任务 7 PricingService 基于标准化价格内容生成；免费/未报价运行可空
    pricing_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable(),
    // 创建时间（ISO 8601）
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    // 顶层 hash 必须与 resolved 内部一致，防止持久化层写入时漂移。
    if (snapshot.configuration_hash !== snapshot.resolved.configuration_hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["configuration_hash"],
        message:
          "top-level configuration_hash must match resolved.configuration_hash",
      });
    }
    if (snapshot.catalog_hash !== snapshot.resolved.catalog_hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalog_hash"],
        message: "top-level catalog_hash must match resolved.catalog_hash",
      });
    }
    if (
      snapshot.source_revisions.project_configuration_revision !==
      snapshot.resolved.source_revisions.project_configuration_revision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_revisions", "project_configuration_revision"],
        message:
          "top-level source_revisions.project_configuration_revision must match resolved value",
      });
    }
    if (
      snapshot.source_revisions.source_user_preference_revision !==
      snapshot.resolved.source_revisions.source_user_preference_revision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_revisions", "source_user_preference_revision"],
        message:
          "top-level source_revisions.source_user_preference_revision must match resolved value",
      });
    }

    // 付费/免费运行的 quote 绑定一致性（P1-3 整改）。
    // 付费运行（quote_id 非空）：必须同时具备加密级 quote_fingerprint、定价 hash、
    //   非空价格版本集合、以及报价金额（estimated/authorization cost）。
    // 免费运行（quote_id 为 null）：不得携带任何 quote 绑定证据，否则语义矛盾。
    const isQuotedRun = snapshot.quote_id !== null;
    if (isQuotedRun) {
      if (snapshot.quote_fingerprint === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quote_fingerprint"],
          message:
            "quoted run (quote_id non-null) must carry a quote_fingerprint",
        });
      }
      if (snapshot.pricing_hash === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricing_hash"],
          message: "quoted run (quote_id non-null) must carry a pricing_hash",
        });
      }
      if (snapshot.pricing_version_set.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricing_version_set"],
          message:
            "quoted run (quote_id non-null) must carry at least one pricing version",
        });
      }
      if (snapshot.estimated_cost_micros === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["estimated_cost_micros"],
          message:
            "quoted run (quote_id non-null) must carry estimated_cost_micros",
        });
      }
      if (snapshot.authorization_cost_micros === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorization_cost_micros"],
          message:
            "quoted run (quote_id non-null) must carry authorization_cost_micros",
        });
      }
    } else {
      // 免费运行：不得残留 quote 绑定证据，也不得表达正费用或预算超额授权。
      // 设计只允许纯本地免 quote 操作使用此分支，因此费用只能为 null 或 "0"，
      // 且 budget_override_authorized 必须为 false（无 quote 即无超额授权来源）。
      // budget_limit_micros 可保留项目预算值（仅展示用，不构成授权）。
      if (snapshot.quote_fingerprint !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["quote_fingerprint"],
          message:
            "free run (quote_id null) must not carry a quote_fingerprint",
        });
      }
      if (snapshot.pricing_hash !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricing_hash"],
          message: "free run (quote_id null) must not carry a pricing_hash",
        });
      }
      if (snapshot.pricing_version_set.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pricing_version_set"],
          message:
            "free run (quote_id null) must not carry pricing versions",
        });
      }
      if (
        snapshot.estimated_cost_micros !== null &&
        snapshot.estimated_cost_micros !== "0"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["estimated_cost_micros"],
          message:
            'free run (quote_id null) estimated_cost_micros must be null or "0"',
        });
      }
      if (
        snapshot.authorization_cost_micros !== null &&
        snapshot.authorization_cost_micros !== "0"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorization_cost_micros"],
          message:
            'free run (quote_id null) authorization_cost_micros must be null or "0"',
        });
      }
      if (snapshot.budget_override_authorized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["budget_override_authorized"],
          message:
            "free run (quote_id null) must not authorize budget override",
        });
      }
    }
  });
export type RunConfigurationSnapshotV1 = z.infer<
  typeof RunConfigurationSnapshotV1
>;
