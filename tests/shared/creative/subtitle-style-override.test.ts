import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBTITLE_STYLE,
  SubtitleStyle,
  SubtitleStyleOverrideSet,
  applySubtitleStyleOverrides,
} from "../../../shared/src/index.js";

/**
 * S2-2B 任务 1：字幕有限安全参数覆盖（详细设计 §8.2）。
 * 覆盖集合必须是白名单字段 + SubtitleStyle 同源边界；解析函数是纯函数。
 */

describe("SubtitleStyleOverrideSet 白名单与边界", () => {
  it("接受空覆盖集合", () => {
    const parsed = SubtitleStyleOverrideSet.parse({});
    expect(parsed).toEqual({});
  });

  it("接受白名单字段的边界内值", () => {
    const parsed = SubtitleStyleOverrideSet.parse({
      font_size_px: 46,
      font_weight: 700,
      line_height: 1.5,
      max_lines: 2,
      text_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width_px: 2.5,
      shadow: "soft",
      background_color: "#000000",
      background_opacity: 0,
      position: "bottom",
      horizontal_margin_px: 48,
      bottom_margin_px: 120,
      top_margin_px: 120,
      max_width_pct: 0.9,
      text_align: "center",
    });
    expect(parsed.font_size_px).toBe(46);
  });

  it.each([
    ["font_size_px", 17],
    ["font_size_px", 97],
    ["font_weight", 99],
    ["font_weight", 901],
    ["line_height", 2.1],
    ["line_height", 0.9],
    ["max_lines", 0],
    ["max_lines", 5],
    ["stroke_width_px", 12.5],
    ["stroke_width_px", -0.1],
    ["background_opacity", -0.1],
    ["background_opacity", 1.1],
    ["horizontal_margin_px", 241],
    ["horizontal_margin_px", -1],
    ["bottom_margin_px", 361],
    ["top_margin_px", -1],
    ["max_width_pct", 0.39],
    ["max_width_pct", 1.01],
  ])("拒绝越界 %s=%s", (field, value) => {
    expect(SubtitleStyleOverrideSet.safeParse({ [field]: value }).success).toBe(false);
  });

  it.each([
    ["position", "left"],
    ["position", "center_top"],
    ["text_align", "justify"],
    ["shadow", "0 5px 20px rgba(1,2,3,0.9)"], // 任意 CSS 阴影不允许，只能选预定义枚举
  ])("拒绝非法枚举 %s=%s", (field, value) => {
    expect(SubtitleStyleOverrideSet.safeParse({ [field]: value }).success).toBe(false);
  });

  it.each([
    "font_family",
    "style_id",
    "safe_area_top_px",
    "safe_area_bottom_px",
    "opacity",
    "unknown",
  ])("拒绝白名单外字段 %s（strict）", (field) => {
    expect(SubtitleStyleOverrideSet.safeParse({ [field]: 1 }).success).toBe(false);
  });
});

describe("applySubtitleStyleOverrides 纯函数", () => {
  it("空覆盖返回预设样式原值（深拷贝，不修改输入）", () => {
    const presetStyle = SubtitleStyle.parse(DEFAULT_SUBTITLE_STYLE);
    const result = applySubtitleStyleOverrides(presetStyle, {});
    expect(result).toEqual(presetStyle);
    expect(result).not.toBe(presetStyle);
  });

  it("覆盖白名单字段并保持 style_id/font_family 不变", () => {
    const presetStyle = SubtitleStyle.parse(DEFAULT_SUBTITLE_STYLE);
    const result = applySubtitleStyleOverrides(presetStyle, {
      font_size_px: 60,
      text_color: "#ffdd00",
      position: "top",
      max_width_pct: 0.8,
    });
    expect(result.font_size_px).toBe(60);
    expect(result.text_color).toBe("#ffdd00");
    expect(result.position).toBe("top");
    expect(result.max_width_pct).toBe(0.8);
    expect(result.style_id).toBe(presetStyle.style_id);
    expect(result.font_family).toBe(presetStyle.font_family);
    expect(result.safe_area_top_px).toBe(presetStyle.safe_area_top_px);
    expect(result.bottom_margin_px).toBe(presetStyle.bottom_margin_px);
  });

  it("shadow 枚举映射为预定义阴影字符串", () => {
    const presetStyle = SubtitleStyle.parse(DEFAULT_SUBTITLE_STYLE);
    expect(
      applySubtitleStyleOverrides(presetStyle, { shadow: "none" }).shadow,
    ).toBe("none");
    expect(
      applySubtitleStyleOverrides(presetStyle, { shadow: "soft" }).shadow,
    ).toBe("0 2px 8px rgba(0,0,0,0.6)");
    expect(
      applySubtitleStyleOverrides(presetStyle, { shadow: "strong" }).shadow,
    ).toBe("0 4px 12px rgba(0,0,0,0.8)");
  });

  it("相同输入产生相同输出（确定性）", () => {
    const presetStyle = SubtitleStyle.parse(DEFAULT_SUBTITLE_STYLE);
    const overrides = { font_size_px: 52, text_align: "left" as const };
    expect(applySubtitleStyleOverrides(presetStyle, overrides)).toEqual(
      applySubtitleStyleOverrides(presetStyle, overrides),
    );
  });
});
