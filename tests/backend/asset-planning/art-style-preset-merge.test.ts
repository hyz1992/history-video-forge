import { describe, expect, it } from "vitest";

import type { ProjectArtBible } from "../../../shared/src/index.js";
import { mergeArtStylePresetIntoArtBible } from "../../../backend/src/modules/asset-planning/art-style-preset-merge.js";

/**
 * S2-2B 任务 4：画风 preset 确定性兜底合并（详细设计 §7.2）。
 * 本地只做配置应用（负面并集、前缀兜底），不做语义判断（visual_tone/era_style 不覆盖）。
 */

const baseArtBible: ProjectArtBible = {
  era_style: "汉代宫廷",
  visual_tone: "纪实沉稳",
  characters: [],
  locations: [],
  props: [],
  global_prompt_prefix: "历史纪实质感",
  global_negative_prompts: ["卡通", "动漫风"],
  consistency_notes: [],
};

const presetParams = {
  visual_tone_hint: "水墨工笔，留白构图",
  global_prompt_prefix: "水墨风格，工笔勾线",
  global_negative_prompts: ["油画质感", "3D渲染"],
  style_keywords: [],
  era_style_hint: null,
};

describe("mergeArtStylePresetIntoArtBible", () => {
  it("无 preset（null）→ 输入原样返回", () => {
    const result = mergeArtStylePresetIntoArtBible({ artBible: baseArtBible, preset: null });
    expect(result).toEqual(baseArtBible);
  });

  it("负面清单取并集：preset 项必达，LLM 额外项保留", () => {
    const result = mergeArtStylePresetIntoArtBible({
      artBible: baseArtBible,
      preset: { preset_id: "p1", preset_version: "v1", resolved_params: presetParams },
    });
    expect(result.global_negative_prompts).toEqual(
      expect.arrayContaining(["油画质感", "3D渲染", "卡通", "动漫风"]),
    );
    expect(result.global_negative_prompts).toHaveLength(4);
  });

  it("LLM 负面清单缺 preset 项时本地补齐（不依赖 LLM 遵守）", () => {
    const llmMissing = {
      ...baseArtBible,
      global_negative_prompts: ["卡通"],
    };
    const result = mergeArtStylePresetIntoArtBible({
      artBible: llmMissing,
      preset: { preset_id: "p1", preset_version: "v1", resolved_params: presetParams },
    });
    for (const item of presetParams.global_negative_prompts) {
      expect(result.global_negative_prompts).toContain(item);
    }
  });

  it("前缀：LLM 输出包含 preset 前缀文本 → 保留 LLM 版本", () => {
    const llmKeptPrefix = {
      ...baseArtBible,
      global_prompt_prefix: "水墨风格，工笔勾线，淡彩晕染",
    };
    const result = mergeArtStylePresetIntoArtBible({
      artBible: llmKeptPrefix,
      preset: { preset_id: "p1", preset_version: "v1", resolved_params: presetParams },
    });
    expect(result.global_prompt_prefix).toBe("水墨风格，工笔勾线，淡彩晕染");
  });

  it("前缀：LLM 缺失 → 本地用 preset 值兜底", () => {
    const result = mergeArtStylePresetIntoArtBible({
      artBible: baseArtBible,
      preset: { preset_id: "p1", preset_version: "v1", resolved_params: presetParams },
    });
    expect(result.global_prompt_prefix).toBe("水墨风格，工笔勾线");
  });

  it("visual_tone/era_style 本地不覆盖（LLM 值原样保留）", () => {
    const result = mergeArtStylePresetIntoArtBible({
      artBible: baseArtBible,
      preset: { preset_id: "p1", preset_version: "v1", resolved_params: presetParams },
    });
    expect(result.visual_tone).toBe("纪实沉稳");
    expect(result.era_style).toBe("汉代宫廷");
    // preset 的视觉基调只作为 prompt 输入由 LLM 吸收，本地不写入 art_bible
    expect(result.visual_tone).not.toContain("水墨");
  });

  it("纯函数：相同输入相同输出，且不修改输入对象", () => {
    const input = { artBible: baseArtBible, preset: { preset_id: "p1", preset_version: "v1", resolved_params: presetParams } };
    const first = mergeArtStylePresetIntoArtBible(input);
    const second = mergeArtStylePresetIntoArtBible(input);
    expect(first).toEqual(second);
    expect(baseArtBible.global_negative_prompts).toEqual(["卡通", "动漫风"]);
  });
});
