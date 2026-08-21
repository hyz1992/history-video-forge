import { z } from "zod";

import { SubtitleStyle } from "../assets/asset-manifest.schema.js";

/**
 * S2-2B 创作偏好预设合同（详细设计 §4）。
 *
 * 边界：
 * - preset 是**服务端受控的版本化输入数据**：`preset_id` 在配置中稳定引用，
 *   `preset_version` 随注册表更新递增，运行解析时冻结 `preset_id + preset_version
 *   + resolved_params` 进快照。
 * - `resolved_params` 只承载结构化输入数据（中文风格描述、必达前缀、负面清单、
 *   模型关键词），**不得包含整段正式 prompt 指令文本**——指令文本只存在于
 *   `prompts/`（"不把正式 prompt 写进设置代码"）。
 */

// --- 画风 preset ------------------------------------------------------------

export const ArtStyleResolvedParams = z
  .object({
    /** 中文基调描述，由 LLM 吸收进 art_bible.visual_tone/era_style。 */
    visual_tone_hint: z.string().min(1).max(200),
    /** 必达中文前缀，LLM 输出缺省时本地兜底。 */
    global_prompt_prefix: z.string().min(1).max(300),
    /** 必达负面清单（并集合并，LLM 不得删除 preset 项）。 */
    global_negative_prompts: z.array(z.string().min(1).max(100)).max(20),
    /** 生图模型关键词补充（可空；放在中文描述之后）。 */
    style_keywords: z.array(z.string().min(1).max(60)).max(10).default([]),
    /** 朝代风格倾向（可空）。 */
    era_style_hint: z.string().min(1).max(200).nullable().default(null),
  })
  .strict();
export type ArtStyleResolvedParams = z.infer<typeof ArtStyleResolvedParams>;

export const ArtStylePreset = z
  .object({
    preset_id: z.string().min(1),
    preset_version: z
      .string()
      .regex(/^v[1-9]\d*$/, "preset_version must be v<N> with N >= 1 (e.g. v1)"),
    display_name: z.string().min(1),
    description: z.string().min(1),
    resolved_params: ArtStyleResolvedParams,
  })
  .strict();
export type ArtStylePreset = z.infer<typeof ArtStylePreset>;

// --- 字幕安全覆盖白名单（详细设计 §8.2） -------------------------------------

/**
 * 允许用户覆盖的字幕样式字段白名单。
 * 禁止覆盖：`style_id`（系统派生）、`font_family`（字体族是平台安全/授权边界）、
 * `safe_area_top_px`/`safe_area_bottom_px`（平台安全区）。
 */
export const SUBTITLE_OVERRIDABLE_FIELDS = [
  "font_size_px",
  "font_weight",
  "line_height",
  "max_lines",
  "text_color",
  "stroke_color",
  "stroke_width_px",
  "shadow",
  "background_color",
  "background_opacity",
  "position",
  "horizontal_margin_px",
  "bottom_margin_px",
  "top_margin_px",
  "max_width_pct",
  "text_align",
] as const;
export const SubtitleOverrideField = z.enum(SUBTITLE_OVERRIDABLE_FIELDS);
export type SubtitleOverrideField = z.infer<typeof SubtitleOverrideField>;

/**
 * 预定义阴影枚举（不接受任意 CSS 阴影字符串；枚举值映射见
 * SUBTITLE_SHADOW_VALUES）。
 */
export const SubtitleShadowPreset = z.enum(["none", "soft", "strong"]);
export type SubtitleShadowPreset = z.infer<typeof SubtitleShadowPreset>;

export const SUBTITLE_SHADOW_VALUES: Record<SubtitleShadowPreset, string> = {
  none: "none",
  soft: "0 2px 8px rgba(0,0,0,0.6)",
  strong: "0 4px 12px rgba(0,0,0,0.8)",
};

/**
 * 有限安全参数覆盖集合：白名单字段 + 与 SubtitleStyle 同源的数值边界。
 * `subtitle_style_overrides` 存储于配置 creative 段（可选，缺省 {}）。
 */
export const SubtitleStyleOverrideSet = z
  .object({
    font_size_px: z.number().int().min(18).max(96).optional(),
    font_weight: z.number().int().min(100).max(900).optional(),
    line_height: z.number().min(1).max(2).optional(),
    max_lines: z.number().int().min(1).max(4).optional(),
    text_color: z.string().min(1).max(32).optional(),
    stroke_color: z.string().min(1).max(32).optional(),
    stroke_width_px: z.number().min(0).max(12).optional(),
    shadow: SubtitleShadowPreset.optional(),
    background_color: z.string().min(1).max(32).optional(),
    background_opacity: z.number().min(0).max(1).optional(),
    position: z.enum(["bottom", "middle", "top"]).optional(),
    horizontal_margin_px: z.number().int().min(0).max(240).optional(),
    bottom_margin_px: z.number().int().min(0).max(360).optional(),
    top_margin_px: z.number().int().min(0).max(360).optional(),
    max_width_pct: z.number().min(0.4).max(1).optional(),
    text_align: z.enum(["left", "center", "right"]).optional(),
  })
  .strict();
export type SubtitleStyleOverrideSet = z.infer<typeof SubtitleStyleOverrideSet>;

// --- 字幕 preset ------------------------------------------------------------

export const SubtitlePresetResolvedParams = z
  .object({
    /** 完整 SubtitleStyle 值（style_id 为 preset 派生稳定值）。 */
    style: SubtitleStyle,
    /** 该 preset 允许被用户覆盖的字段集合（⊆ 白名单）。 */
    overridable_fields: z.array(SubtitleOverrideField),
  })
  .strict();
export type SubtitlePresetResolvedParams = z.infer<
  typeof SubtitlePresetResolvedParams
>;

export const SubtitleStylePreset = z
  .object({
    preset_id: z.string().min(1),
    preset_version: z
      .string()
      .regex(/^v[1-9]\d*$/, "preset_version must be v<N> with N >= 1 (e.g. v1)"),
    display_name: z.string().min(1),
    description: z.string().min(1),
    resolved_params: SubtitlePresetResolvedParams,
  })
  .strict();
export type SubtitleStylePreset = z.infer<typeof SubtitleStylePreset>;

// --- 注册表快照 -------------------------------------------------------------

export const CreativePresetRegistrySnapshot = z
  .object({
    art_style: z.array(ArtStylePreset),
    subtitle: z.array(SubtitleStylePreset),
  })
  .strict();
export type CreativePresetRegistrySnapshot = z.infer<
  typeof CreativePresetRegistrySnapshot
>;
