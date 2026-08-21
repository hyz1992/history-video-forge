import { DEFAULT_SUBTITLE_STYLE } from "../assets/asset-manifest.schema.js";
import {
  SUBTITLE_OVERRIDABLE_FIELDS,
  type SubtitleStylePreset,
} from "./creative-preset.schema.js";

/**
 * S2-2B 字幕 preset 注册表 v1（详细设计 §4.3）。
 *
 * 边界：
 * - `resolved_params.style` 是完整 SubtitleStyle 值，`style_id` 与 `preset_id`
 *   一致（注册表一致性测试强制）。
 * - `shadow` 只使用预定义阴影字符串（SUBTITLE_SHADOW_VALUES 取值域）。
 * - `overridable_fields` ⊆ 平台白名单（SUBTITLE_OVERRIDABLE_FIELDS）。
 */

/** 竖屏默认：与系统默认样式一致（DEFAULT_SUBTITLE_STYLE）。 */
export const SUBTITLE_STYLE_PRESET_REGISTRY_V1: SubtitleStylePreset[] = [
  {
    preset_id: "subtitle_style_default_vertical",
    preset_version: "v1",
    display_name: "竖屏默认",
    description: "居中大字、细描边、无底，竖屏短视频默认样式。",
    resolved_params: {
      style: DEFAULT_SUBTITLE_STYLE,
      overridable_fields: [...SUBTITLE_OVERRIDABLE_FIELDS],
    },
  },
  {
    preset_id: "subtitle_style_bold_stroke",
    preset_version: "v1",
    display_name: "粗描边醒目",
    description: "粗描边加强阴影、更高字重，适合关键句与高信息密度段落。",
    resolved_params: {
      style: {
        ...DEFAULT_SUBTITLE_STYLE,
        style_id: "subtitle_style_bold_stroke",
        font_weight: 800,
        stroke_width_px: 5,
        shadow: "0 4px 12px rgba(0,0,0,0.8)",
      },
      overridable_fields: [...SUBTITLE_OVERRIDABLE_FIELDS],
    },
  },
  {
    preset_id: "subtitle_style_minimal",
    preset_version: "v1",
    display_name: "极简无底",
    description: "无背景、细描边、弱阴影的极简样式，画面上干扰最少。",
    resolved_params: {
      style: {
        ...DEFAULT_SUBTITLE_STYLE,
        style_id: "subtitle_style_minimal",
        stroke_width_px: 1.5,
        shadow: "none",
        background_opacity: 0,
      },
      overridable_fields: [...SUBTITLE_OVERRIDABLE_FIELDS],
    },
  },
];
