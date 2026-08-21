import { describe, expect, it } from "vitest";

import {
  ART_STYLE_PRESET_REGISTRY_V1,
  CREATIVE_PRESET_REGISTRY_SNAPSHOT_V1,
  CreativePresetRegistrySnapshot,
  SUBTITLE_OVERRIDABLE_FIELDS,
  SUBTITLE_STYLE_PRESET_REGISTRY_V1,
  SubtitleOverrideField,
  SubtitleStylePreset,
  ArtStylePreset,
} from "../../../shared/src/index.js";

/**
 * S2-2B 任务 1：版本化画风/字幕 preset 合同与注册表一致性。
 * 设计依据：docs/plans/2026-08-21-s2-2b-creative-preferences-design.md §4。
 */

describe("ArtStylePreset 合同", () => {
  it("接受合法画风 preset（含默认 style_keywords/era_style_hint）", () => {
    const parsed = ArtStylePreset.parse({
      preset_id: "art_style_classical_ink",
      preset_version: "v1",
      display_name: "古典水墨",
      description: "水墨工笔、留白构图。",
      resolved_params: {
        visual_tone_hint: "水墨工笔，留白构图",
        global_prompt_prefix: "水墨风格，工笔勾线",
        global_negative_prompts: ["油画质感", "3D渲染"],
      },
    });
    expect(parsed.resolved_params.style_keywords).toEqual([]);
    expect(parsed.resolved_params.era_style_hint).toBeNull();
  });

  it.each(["1", "version-1", "", "V1", "v0", "v1.2"])(
    "拒绝非法 preset_version %s",
    (preset_version) => {
      expect(() =>
        ArtStylePreset.parse({
          preset_id: "art_style_x",
          preset_version,
          display_name: "x",
          description: "x",
          resolved_params: {
            visual_tone_hint: "a",
            global_prompt_prefix: "b",
            global_negative_prompts: [],
          },
        }),
      ).toThrow();
    },
  );

  it("拒绝空 preset_id / display_name / description", () => {
    expect(() =>
      ArtStylePreset.parse({
        preset_id: "",
        preset_version: "v1",
        display_name: "x",
        description: "x",
        resolved_params: {
          visual_tone_hint: "a",
          global_prompt_prefix: "b",
          global_negative_prompts: [],
        },
      }),
    ).toThrow();
  });

  it("拒绝未知字段（strict）", () => {
    expect(() =>
      ArtStylePreset.parse({
        preset_id: "art_style_x",
        preset_version: "v1",
        display_name: "x",
        description: "x",
        resolved_params: {
          visual_tone_hint: "a",
          global_prompt_prefix: "b",
          global_negative_prompts: [],
        },
        prompt_text: "不得把正式 prompt 写进注册表",
      }),
    ).toThrow();
  });

  it("拒绝超长 visual_tone_hint 与超量负面清单", () => {
    expect(() =>
      ArtStylePreset.parse({
        preset_id: "art_style_x",
        preset_version: "v1",
        display_name: "x",
        description: "x",
        resolved_params: {
          visual_tone_hint: "长".repeat(201),
          global_prompt_prefix: "b",
          global_negative_prompts: [],
        },
      }),
    ).toThrow();

    expect(() =>
      ArtStylePreset.parse({
        preset_id: "art_style_x",
        preset_version: "v1",
        display_name: "x",
        description: "x",
        resolved_params: {
          visual_tone_hint: "a",
          global_prompt_prefix: "b",
          global_negative_prompts: Array.from({ length: 21 }, (_, i) => `负面${i}`),
        },
      }),
    ).toThrow();
  });
});

describe("SubtitleStylePreset 合同", () => {
  it("接受合法字幕 preset（完整 SubtitleStyle + 白名单可覆盖字段）", () => {
    const parsed = SubtitleStylePreset.parse({
      preset_id: "subtitle_style_default_vertical",
      preset_version: "v1",
      display_name: "竖屏默认",
      description: "居中大字、细描边。",
      resolved_params: {
        style: {
          style_id: "subtitle_style_default_vertical",
          font_family: "Microsoft YaHei, sans-serif",
          font_size_px: 46,
          font_weight: 700,
          line_height: 1.5,
          max_lines: 2,
          text_color: "#ffffff",
          stroke_color: "#000000",
          stroke_width_px: 2.5,
          shadow: "0 2px 8px rgba(0,0,0,0.6)",
          background_color: "#000000",
          background_opacity: 0,
          position: "bottom",
          horizontal_margin_px: 48,
          bottom_margin_px: 120,
          top_margin_px: 120,
          safe_area_top_px: 96,
          safe_area_bottom_px: 96,
          max_width_pct: 0.9,
          text_align: "center",
        },
        overridable_fields: ["font_size_px", "text_color", "position"],
      },
    });
    expect(parsed.resolved_params.overridable_fields).toContain("font_size_px");
  });

  it("拒绝白名单外可覆盖字段（font_family/style_id/safe_area）", () => {
    expect(() =>
      SubtitleStylePreset.parse({
        preset_id: "subtitle_style_x",
        preset_version: "v1",
        display_name: "x",
        description: "x",
        resolved_params: {
          style: {
            style_id: "subtitle_style_x",
            font_family: "Arial",
            font_size_px: 46,
            font_weight: 700,
            line_height: 1.5,
            max_lines: 2,
            text_color: "#ffffff",
            stroke_color: "#000000",
            stroke_width_px: 2.5,
            shadow: "0 2px 8px rgba(0,0,0,0.6)",
            background_color: "#000000",
            background_opacity: 0,
            position: "bottom",
            horizontal_margin_px: 48,
            bottom_margin_px: 120,
            top_margin_px: 120,
            safe_area_top_px: 96,
            safe_area_bottom_px: 96,
            max_width_pct: 0.9,
            text_align: "center",
          },
          overridable_fields: ["font_family"],
        },
      }),
    ).toThrow();
  });

  it("拒绝非法样式值（SubtitleStyle 同源边界）", () => {
    expect(() =>
      SubtitleStylePreset.parse({
        preset_id: "subtitle_style_x",
        preset_version: "v1",
        display_name: "x",
        description: "x",
        resolved_params: {
          style: {
            style_id: "subtitle_style_x",
            font_family: "Arial",
            font_size_px: 10, // 低于 18
            font_weight: 700,
            line_height: 1.5,
            max_lines: 2,
            text_color: "#ffffff",
            stroke_color: "#000000",
            stroke_width_px: 2.5,
            shadow: "0 2px 8px rgba(0,0,0,0.6)",
            background_color: "#000000",
            background_opacity: 0,
            position: "bottom",
            horizontal_margin_px: 48,
            bottom_margin_px: 120,
            top_margin_px: 120,
            safe_area_top_px: 96,
            safe_area_bottom_px: 96,
            max_width_pct: 0.9,
            text_align: "center",
          },
          overridable_fields: [],
        },
      }),
    ).toThrow();
  });
});

describe("SubtitleOverrideField 白名单", () => {
  it("接受详细设计 §8.2 的全部 16 个可覆盖字段", () => {
    expect(SUBTITLE_OVERRIDABLE_FIELDS).toHaveLength(16);
    for (const field of SUBTITLE_OVERRIDABLE_FIELDS) {
      expect(SubtitleOverrideField.safeParse(field).success).toBe(true);
    }
  });

  it.each(["font_family", "style_id", "safe_area_top_px", "safe_area_bottom_px", "unknown"])(
    "拒绝非白名单字段 %s",
    (field) => {
      expect(SubtitleOverrideField.safeParse(field).success).toBe(false);
    },
  );
});

describe("注册表一致性（v1）", () => {
  it("注册表快照通过 CreativePresetRegistrySnapshot 校验", () => {
    const parsed = CreativePresetRegistrySnapshot.parse(
      CREATIVE_PRESET_REGISTRY_SNAPSHOT_V1,
    );
    expect(parsed.art_style.length).toBeGreaterThanOrEqual(3);
    expect(parsed.subtitle.length).toBeGreaterThanOrEqual(3);
  });

  it("画风注册表 preset_id 唯一且版本为 v1", () => {
    const ids = ART_STYLE_PRESET_REGISTRY_V1.map((p) => p.preset_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of ART_STYLE_PRESET_REGISTRY_V1) {
      expect(preset.preset_version).toBe("v1");
    }
  });

  it("字幕注册表 preset_id 唯一、style_id 与 preset_id 一致", () => {
    const ids = SUBTITLE_STYLE_PRESET_REGISTRY_V1.map((p) => p.preset_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of SUBTITLE_STYLE_PRESET_REGISTRY_V1) {
      expect(preset.resolved_params.style.style_id).toBe(preset.preset_id);
      expect(preset.preset_version).toBe("v1");
    }
  });

  it("字幕预设的 shadow 值全部来自预定义阴影枚举", () => {
    const allowedShadows = ["none", "0 2px 8px rgba(0,0,0,0.6)", "0 4px 12px rgba(0,0,0,0.8)"];
    for (const preset of SUBTITLE_STYLE_PRESET_REGISTRY_V1) {
      expect(allowedShadows).toContain(preset.resolved_params.style.shadow);
    }
  });
});
