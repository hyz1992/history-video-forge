import { describe, expect, it } from "vitest";

import {
  type GenerationConfigurationV1,
  type VoiceProfile,
  DEFAULT_GENERATION_CONFIGURATION,
} from "../../../shared/src/index.js";
import {
  type ProviderModelCatalogEntry,
  type ResolveGenerationConfigurationInput,
  type ResolvedGenerationConfigurationV1,
  resolveGenerationConfiguration,
} from "../../../shared/src/generation/generation-configuration-resolver.js";

/**
 * S2-2B 任务 2：解析器 resolved_creative（详细设计 §5）。
 *
 * 覆盖：
 * - 音色 auto/fixed 模式、不可用/已删除/提供商不兼容失败码。
 * - 画风/字幕 preset 解析与冻结；preset 缺失失败码。
 * - 字幕安全覆盖应用与 preset 级白名单拒绝。
 * - creative run override 逐字段合并（覆盖/缺省/null 重置）。
 * - resolved_creative 参与 configuration_hash；档案状态变化不影响 hash。
 */

const baseConfig: GenerationConfigurationV1 = {
  ...DEFAULT_GENERATION_CONFIGURATION,
};

const fullActiveCatalog: ProviderModelCatalogEntry[] = [
  {
    provider_model_id: "dashscope.qwen-max",
    capability: "llm.smart",
    provider_key: "dashscope",
    model_id: "qwen-max",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.qwen-flash",
    capability: "llm.flash",
    provider_key: "dashscope",
    model_id: "qwen-flash",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.wanx",
    capability: "image.generate",
    provider_key: "dashscope",
    model_id: "wanx-v1",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.video",
    capability: "video.image_to_video",
    provider_key: "dashscope",
    model_id: "video-v1",
    status: "active",
    is_default: true,
  },
  {
    provider_model_id: "dashscope.tts",
    capability: "tts.synthesize",
    provider_key: "dashscope",
    model_id: "qwen3-tts",
    status: "active",
    is_default: true,
  },
];

function buildVoiceProfile(
  overrides: Partial<VoiceProfile> = {},
): VoiceProfile {
  return {
    voice_profile_id: "voice_preset_cold_authority",
    kind: "preset",
    name: "冷峻权谋型",
    description: "测试音色",
    design_prompt: "设计提示",
    preview_text: "试听文本",
    provider_name: "dashscope",
    provider_voice_id: null,
    provider_status: "missing",
    target_model: "qwen3-tts-vd-2026-01-26",
    recommended_content_families: ["historical-story"],
    voice_traits: ["cold", "authoritative"],
    avoid_traits: ["shouting"],
    gender_tone: "male_leaning",
    age_band: "35-45",
    pitch: "mid_low",
    pace: "medium_slow",
    energy: 0.45,
    authority: 0.9,
    suspense: 0.7,
    warmth: 0.2,
    preview_audio_uri: null,
    usage_count: 0,
    last_used_at: null,
    quality_score: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

/** 测试专用注册表快照（overridable_fields 故意收窄以验证 preset 级白名单）。 */
const testRegistry = {
  art_style: [
    {
      preset_id: "art_style_classical_ink",
      preset_version: "v1",
      display_name: "古典水墨",
      description: "测试画风",
      resolved_params: {
        visual_tone_hint: "水墨工笔",
        global_prompt_prefix: "水墨风格",
        global_negative_prompts: ["油画质感"],
        style_keywords: [],
        era_style_hint: null,
      },
    },
  ],
  subtitle: [
    {
      preset_id: "subtitle_style_default_vertical",
      preset_version: "v1",
      display_name: "竖屏默认",
      description: "测试字幕",
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
        overridable_fields: ["font_size_px", "text_color"],
      },
    },
  ],
};

function buildInput(
  overrides: Partial<ResolveGenerationConfigurationInput>,
): ResolveGenerationConfigurationInput {
  return {
    projectConfiguration: baseConfig,
    projectConfigurationRevision: 1,
    sourceUserPreferenceRevision: null,
    systemConstraints: {
      apiVideoProviderEnabled: true,
    },
    providerModelCatalog: fullActiveCatalog,
    operation: "assets.generate",
    voiceProfiles: [],
    creativePresets: testRegistry,
    ...overrides,
  };
}

function resolve(input: ResolveGenerationConfigurationInput) {
  const result = resolveGenerationConfiguration(input);
  if (!result.ok) {
    throw new Error(`unexpected resolver failure: ${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function creativeConfig(config: GenerationConfigurationV1) {
  return config.creative;
}

describe("resolved_creative: 音色", () => {
  it("voice_profile_id=null → mode=auto（即使音色库为空也不失败）", () => {
    const resolved = resolve(buildInput({}));
    expect(resolved.resolved_creative.voice).toEqual({
      mode: "auto",
      voice_profile_id: null,
      kind: null,
      provider_name: null,
      target_model: null,
    });
  });

  it("显式音色命中 → mode=fixed 并冻结稳定身份字段", () => {
    const voice = buildVoiceProfile({ provider_status: "ready" });
    const resolved = resolve(
      buildInput({
        voiceProfiles: [voice],
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), voice_profile_id: voice.voice_profile_id },
        },
      }),
    );
    expect(resolved.resolved_creative.voice).toEqual({
      mode: "fixed",
      voice_profile_id: "voice_preset_cold_authority",
      kind: "preset",
      provider_name: "dashscope",
      target_model: "qwen3-tts-vd-2026-01-26",
    });
  });

  it("显式音色不存在 → generation_creative_voice_profile_unavailable", () => {
    const result = resolveGenerationConfiguration(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), voice_profile_id: "voice_not_exist" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generation_creative_voice_profile_unavailable");
    }
  });

  it("显式音色已删除 → generation_creative_voice_profile_unavailable", () => {
    const voice = buildVoiceProfile({ provider_status: "deleted" });
    const result = resolveGenerationConfiguration(
      buildInput({
        voiceProfiles: [voice],
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), voice_profile_id: voice.voice_profile_id },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generation_creative_voice_profile_unavailable");
    }
  });

  it("音色 provider 与 tts.synthesize 解析 provider 不兼容 → generation_creative_voice_provider_incompatible", () => {
    const voice = buildVoiceProfile({ provider_name: "other_tts_provider" });
    const result = resolveGenerationConfiguration(
      buildInput({
        voiceProfiles: [voice],
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), voice_profile_id: voice.voice_profile_id },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generation_creative_voice_provider_incompatible");
      expect(result.error.capability).toBe("tts.synthesize");
    }
  });
});

describe("resolved_creative: 画风", () => {
  it("art_style_preset_id=null → mode=none", () => {
    const resolved = resolve(buildInput({}));
    expect(resolved.resolved_creative.art_style).toEqual({
      mode: "none",
      preset_id: null,
      preset_version: null,
      resolved_params: null,
    });
  });

  it("preset 命中 → mode=fixed 并冻结 id/version/params", () => {
    const resolved = resolve(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), art_style_preset_id: "art_style_classical_ink" },
        },
      }),
    );
    expect(resolved.resolved_creative.art_style.mode).toBe("fixed");
    expect(resolved.resolved_creative.art_style.preset_id).toBe("art_style_classical_ink");
    expect(resolved.resolved_creative.art_style.preset_version).toBe("v1");
    expect(resolved.resolved_creative.art_style.resolved_params).toEqual(
      testRegistry.art_style[0]!.resolved_params,
    );
  });

  it("preset 不存在 → generation_creative_preset_unavailable", () => {
    const result = resolveGenerationConfiguration(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), art_style_preset_id: "art_style_nope" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generation_creative_preset_unavailable");
    }
  });
});

describe("resolved_creative: 字幕", () => {
  it("subtitle_style_preset_id=null → mode=none", () => {
    const resolved = resolve(buildInput({}));
    expect(resolved.resolved_creative.subtitle.mode).toBe("none");
    expect(resolved.resolved_creative.subtitle.resolved_style).toBeNull();
  });

  it("preset 命中 + 安全覆盖 → 最终完整样式与 applied_overrides", () => {
    const resolved = resolve(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: {
            ...creativeConfig(baseConfig),
            subtitle_style_preset_id: "subtitle_style_default_vertical",
            subtitle_style_overrides: { font_size_px: 60, text_color: "#ffdd00" },
          },
        },
      }),
    );
    const subtitle = resolved.resolved_creative.subtitle;
    expect(subtitle.mode).toBe("fixed");
    expect(subtitle.preset_id).toBe("subtitle_style_default_vertical");
    expect(subtitle.preset_version).toBe("v1");
    expect(subtitle.applied_overrides).toEqual({ font_size_px: 60, text_color: "#ffdd00" });
    expect(subtitle.resolved_style?.font_size_px).toBe(60);
    expect(subtitle.resolved_style?.text_color).toBe("#ffdd00");
    // 不可覆盖字段保持 preset 值
    expect(subtitle.resolved_style?.style_id).toBe("subtitle_style_default_vertical");
    expect(subtitle.resolved_style?.font_family).toContain("Microsoft YaHei");
    expect(subtitle.resolved_style?.safe_area_top_px).toBe(96);
  });

  it("覆盖 preset 白名单外字段 → generation_creative_subtitle_override_invalid 并指明字段", () => {
    // testRegistry 的 subtitle preset 只允许 font_size_px/text_color
    const result = resolveGenerationConfiguration(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: {
            ...creativeConfig(baseConfig),
            subtitle_style_preset_id: "subtitle_style_default_vertical",
            subtitle_style_overrides: { max_lines: 3 },
          },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generation_creative_subtitle_override_invalid");
      expect(result.error.message).toContain("max_lines");
    }
  });

  it("preset 不存在 → generation_creative_preset_unavailable", () => {
    const result = resolveGenerationConfiguration(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), subtitle_style_preset_id: "subtitle_nope" },
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("generation_creative_preset_unavailable");
    }
  });
});

describe("creative run override 合并", () => {
  it("override 提供 voice → 覆盖项目值；缺省字段保持项目值", () => {
    const voice = buildVoiceProfile({ provider_status: "ready" });
    const resolved = resolve(
      buildInput({
        voiceProfiles: [voice],
        projectConfiguration: {
          ...baseConfig,
          creative: {
            ...creativeConfig(baseConfig),
            voice_profile_id: "voice_from_project",
            art_style_preset_id: "art_style_classical_ink",
          },
        },
        runOverrides: {
          creative: { voice_profile_id: voice.voice_profile_id },
        },
      }),
    );
    expect(resolved.effective.creative.voice_profile_id).toBe("voice_preset_cold_authority");
    expect(resolved.effective.creative.art_style_preset_id).toBe("art_style_classical_ink");
    // 覆盖后的音色参与 resolved_creative 解析（fixed 冻结）
    expect(resolved.resolved_creative.voice.mode).toBe("fixed");
    expect(resolved.resolved_creative.voice.voice_profile_id).toBe("voice_preset_cold_authority");
  });

  it("override 显式 null → 槽位重置为 auto/none", () => {
    const resolved = resolve(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: {
            ...creativeConfig(baseConfig),
            art_style_preset_id: "art_style_classical_ink",
          },
        },
        runOverrides: {
          creative: { art_style_preset_id: null },
        },
      }),
    );
    expect(resolved.effective.creative.art_style_preset_id).toBeNull();
    expect(resolved.resolved_creative.art_style.mode).toBe("none");
  });

  it("override 未提供 creative → 完全保持项目值", () => {
    const resolved = resolve(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: {
            ...creativeConfig(baseConfig),
            subtitle_style_preset_id: "subtitle_style_default_vertical",
          },
        },
        runOverrides: { video: { strategy: "all_remotion" } },
      }),
    );
    expect(resolved.effective.creative.subtitle_style_preset_id).toBe(
      "subtitle_style_default_vertical",
    );
  });
});

describe("resolved_creative 与 configuration_hash", () => {
  it("相同输入产生相同 hash（resolved_creative 参与 canonical payload）", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        creative: {
          ...creativeConfig(baseConfig),
          art_style_preset_id: "art_style_classical_ink",
          subtitle_style_preset_id: "subtitle_style_default_vertical",
          subtitle_style_overrides: { font_size_px: 52 },
        },
      },
    });
    const first = resolve(input);
    const second = resolve(input);
    expect(first.configuration_hash).toBe(second.configuration_hash);
  });

  it("仅音色档案状态/用量变化不影响 hash（只冻结稳定身份字段）", () => {
    const input = buildInput({
      projectConfiguration: {
        ...baseConfig,
        creative: { ...creativeConfig(baseConfig), voice_profile_id: "voice_preset_cold_authority" },
      },
    });
    const readyResolved = resolve(
      buildInput({
        ...input,
        voiceProfiles: [buildVoiceProfile({ provider_status: "ready", usage_count: 5 })],
      }),
    );
    const missingResolved = resolve(
      buildInput({
        ...input,
        voiceProfiles: [buildVoiceProfile({ provider_status: "missing", usage_count: 0 })],
      }),
    );
    expect(readyResolved.configuration_hash).toBe(missingResolved.configuration_hash);
  });

  it("creative 配置不同 → hash 不同", () => {
    const withArt = resolve(
      buildInput({
        projectConfiguration: {
          ...baseConfig,
          creative: { ...creativeConfig(baseConfig), art_style_preset_id: "art_style_classical_ink" },
        },
      }),
    );
    const withoutArt = resolve(buildInput({}));
    expect(withArt.configuration_hash).not.toBe(withoutArt.configuration_hash);
  });
});

describe("历史快照兼容（resolved_creative 缺省）", () => {
  it("A 期快照 JSON（无 resolved_creative）仍可解析为 auto/none 语义", async () => {
    // 直接验证 ResolvedGenerationConfigurationV1Schema 对缺省字段的兼容：
    // 这里以 resolver 输出为基线，模拟删除 resolved_creative 后再次解析。
    const { ResolvedGenerationConfigurationV1Schema } = await import(
      "../../../shared/src/index.js"
    );
    const resolved = resolve(buildInput({}));
    const { resolved_creative: _dropped, ...legacyResolved } = resolved as unknown as Record<
      string,
      unknown
    >;
    const reparsed = ResolvedGenerationConfigurationV1Schema.parse(legacyResolved);
    expect(reparsed.resolved_creative.voice.mode).toBe("auto");
    expect(reparsed.resolved_creative.art_style.mode).toBe("none");
    expect(reparsed.resolved_creative.subtitle.mode).toBe("none");
  });
});
