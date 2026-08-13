import { z } from "zod";

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

export const CreativePreferences = z
  .object({
    voice_profile_id: z.string().min(1).nullable(),
    art_style_preset_id: z.string().min(1).nullable(),
    subtitle_style_preset_id: z.string().min(1).nullable(),
  })
  .strict();
export type CreativePreferences = z.infer<typeof CreativePreferences>;

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
  },
  capabilities: {
    "llm.smart": { mode: "auto" },
    "llm.flash": { mode: "auto" },
    "image.generate": { mode: "auto" },
    "video.image_to_video": { mode: "auto" },
    "tts.synthesize": { mode: "auto" },
  },
};

// --- Run Configuration Snapshot（不可变运行快照合同） ----------------------

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

/**
 * 不可变运行快照。重新运行必须创建新快照；repository 不提供 update。
 */
export const RunConfigurationSnapshotV1 = z
  .object({
    schema_version: z.literal("run_configuration_snapshot_v1"),
    source_revisions: z
      .object({
        source_user_preference_revision: z.number().int().nonnegative().nullable(),
        project_configuration_revision: z.number().int().nonnegative(),
      })
      .strict(),
    effective: GenerationConfigurationV1,
    resolved_capabilities: z.record(z.enum(CAPABILITY_SLOTS), z.unknown()),
    segment_visual_routes: z.array(z.unknown()),
    constraints_applied: z.array(AppliedConstraint),
    resolution_trace: z.array(ResolutionTraceEntry),
    configuration_hash: z.string().min(1),
    pricing_hash: z.string().min(1),
  })
  .strict();
export type RunConfigurationSnapshotV1 = z.infer<
  typeof RunConfigurationSnapshotV1
>;
