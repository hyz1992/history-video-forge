import { describe, expect, it, vi } from "vitest";

import {
  createCreativePresetsStore,
  resolveSubtitleStylePreview,
  type CreativePresetsApi,
} from "../../frontend/src/stores/creative-presets";

/**
 * S2-2B 任务 9：创作偏好 store 测试。
 * - 目录/音色列表加载与错误处理。
 * - 试听调用携带 quote 提交协议字段。
 * - 字幕样式预览投影（安全覆盖 + 阴影枚举映射）。
 */

const presets = {
  art_style: [
    {
      preset_id: "art_style_classical_ink",
      preset_version: "v1",
      display_name: "古典水墨",
      description: "水墨",
      overridable_fields: null,
      summary: "水墨工笔；必达负面清单 5 项",
    },
  ],
  subtitle: [
    {
      preset_id: "subtitle_style_bold_stroke",
      preset_version: "v1",
      display_name: "粗描边醒目",
      description: "粗描边",
      overridable_fields: ["font_size_px", "position"],
      summary: "subtitle_style_bold_stroke",
    },
  ],
};

const profiles = [
  {
    voice_profile_id: "voice_preset_cold_authority",
    kind: "preset" as const,
    name: "冷峻权谋型",
    description: "冷静旁白",
    voice_traits: ["cold"],
    avoid_traits: [],
    gender_tone: "male_leaning",
    age_band: "35-45",
    pitch: "mid_low",
    pace: "medium_slow",
    energy: 0.45,
    authority: 0.9,
    suspense: 0.7,
    warmth: 0.2,
    preview_text: "试听文本",
    preview_audio_uri: null,
    visibility: "public" as const,
    provider_status: "missing",
  },
];

function makeApi(overrides: Partial<CreativePresetsApi> = {}): CreativePresetsApi {
  return {
    listCreativePresets: async () => presets,
    listVoiceProfiles: async () => ({ profiles }),
    requestVoicePreview: vi.fn(async () => ({
      preview_audio_uri: "data:audio/wav;base64,dGVzdA==",
      source: "generated" as const,
      provider_voice_id: null,
    })),
    ...overrides,
  };
}

describe("creative-presets store", () => {
  it("加载画风/字幕目录与音色列表", async () => {
    const store = createCreativePresetsStore(makeApi());
    await store.loadCreativePresets();
    await store.loadVoiceProfiles();
    expect(store.state.artStylePresets[0]?.preset_id).toBe("art_style_classical_ink");
    expect(store.state.subtitlePresets[0]?.preset_id).toBe("subtitle_style_bold_stroke");
    expect(store.state.voiceProfiles[0]?.voice_profile_id).toBe("voice_preset_cold_authority");
  });

  it("试听调用携带 quote 提交协议字段（quote + 幂等键 + run_overrides 重放）", async () => {
    const requestVoicePreview = vi.fn(async () => ({
      preview_audio_uri: "data:audio/wav;base64,dGVzdA==",
      source: "generated" as const,
      provider_voice_id: null,
    }));
    const api = makeApi({ requestVoicePreview });
    const store = createCreativePresetsStore(api);

    const result = await store.previewVoice("proj-1", "voice_preset_cold_authority", {
      cost_quote_id: "quote-1",
      idempotency_key: "key-1",
      authorize_budget_override: true,
      run_overrides: { creative: { voice_profile_id: "voice_preset_cold_authority" } },
    });

    expect(result?.source).toBe("generated");
    expect(requestVoicePreview).toHaveBeenCalledWith("proj-1", "voice_preset_cold_authority", {
      cost_quote_id: "quote-1",
      idempotency_key: "key-1",
      authorize_budget_override: true,
      run_overrides: { creative: { voice_profile_id: "voice_preset_cold_authority" } },
    });
  });

  it("试听失败时返回 null 并记录错误", async () => {
    const api = makeApi({
      requestVoicePreview: async () => {
        throw new Error("paid_generation_quote_required");
      },
    });
    const store = createCreativePresetsStore(api);
    const result = await store.previewVoice("proj-1", "voice_preset_cold_authority");
    expect(result).toBeNull();
    expect(store.state.error).toContain("paid_generation_quote_required");
  });
});

describe("resolveSubtitleStylePreview", () => {
  it("无 preset 无覆盖 → 默认骨架", () => {
    const preview = resolveSubtitleStylePreview(null, {});
    expect(preview.font_size_px).toBe(46);
    expect(preview.position).toBe("bottom");
  });

  it("安全覆盖投影 + shadow 枚举映射为具体阴影字符串", () => {
    const preview = resolveSubtitleStylePreview(presets.subtitle[0]!, {
      font_size_px: 60,
      text_color: "#ffdd00",
      shadow: "strong",
      position: "top",
      max_width_pct: 0.8,
      text_align: "left",
    });
    expect(preview.font_size_px).toBe(60);
    expect(preview.text_color).toBe("#ffdd00");
    expect(preview.shadow).toBe("0 4px 12px rgba(0,0,0,0.8)");
    expect(preview.position).toBe("top");
    expect(preview.max_width_pct).toBe(0.8);
    expect(preview.text_align).toBe("left");
  });

  it("非法/越界覆盖值被忽略（白名单边界）", () => {
    const preview = resolveSubtitleStylePreview(null, {
      font_size_px: 200,
      position: "left",
      unknown_field: "x",
    });
    expect(preview.font_size_px).toBe(46);
    expect(preview.position).toBe("bottom");
  });
});
