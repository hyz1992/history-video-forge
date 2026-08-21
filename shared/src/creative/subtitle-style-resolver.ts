import type { SubtitleStyle } from "../assets/asset-manifest.schema.js";
import {
  SUBTITLE_SHADOW_VALUES,
  type SubtitleShadowPreset,
  type SubtitleStyleOverrideSet,
} from "./creative-preset.schema.js";

/**
 * S2-2B 字幕样式解析纯函数：preset 完整样式 + 有限安全覆盖 → 最终完整样式。
 *
 * 合同（详细设计 §8）：
 * - 覆盖只允许白名单字段（输入类型已限定）；`style_id`/`font_family`/
 *   `safe_area_*` 永远保持 preset 值。
 * - `shadow` 覆盖使用预定义枚举，映射为具体阴影字符串。
 * - 纯函数：相同输入产出相同输出；不修改输入对象。
 */
export function applySubtitleStyleOverrides(
  presetStyle: SubtitleStyle,
  overrides: SubtitleStyleOverrideSet,
): SubtitleStyle {
  const merged: SubtitleStyle = { ...presetStyle };
  for (const [key, value] of Object.entries(overrides) as Array<
    [keyof SubtitleStyleOverrideSet, SubtitleStyleOverrideSet[keyof SubtitleStyleOverrideSet]]
  >) {
    if (value === undefined) continue;
    if (key === "shadow") {
      merged.shadow = SUBTITLE_SHADOW_VALUES[value as SubtitleShadowPreset];
      continue;
    }
    // 白名单外字段由 SubtitleStyleOverrideSet 的 strict schema 在解析层拒绝，
    // 这里只做类型安全的赋值（key 已被联合类型限定在可覆盖字段内）。
    (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}
