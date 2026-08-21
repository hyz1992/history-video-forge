// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

import CreativeVoiceSettings from "../../frontend/src/components/settings/CreativeVoiceSettings.vue";
import CreativeArtStyleSettings from "../../frontend/src/components/settings/CreativeArtStyleSettings.vue";
import CreativeSubtitleSettings from "../../frontend/src/components/settings/CreativeSubtitleSettings.vue";

/**
 * S2-2B 任务 9：创作设置组件交互测试。
 * - 音色：自动匹配/选中保存、cached 试听直接播放、无项目上下文引导。
 * - 画风：preset 选择/不启用。
 * - 字幕：preset 选择 + 安全覆盖表单 + 预览框；style_id/字体族不可编辑。
 */

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
    preview_audio_uri: "data:audio/wav;base64,Y2FjaGVk",
    visibility: "public" as const,
    provider_status: "ready",
  },
  {
    voice_profile_id: "voice_preset_eerie_suspense",
    kind: "preset" as const,
    name: "幽冷悬疑型",
    description: "阴冷旁白",
    voice_traits: ["eerie"],
    avoid_traits: [],
    gender_tone: "neutral",
    age_band: "25-40",
    pitch: "mid_low",
    pace: "slow",
    energy: 0.3,
    authority: 0.45,
    suspense: 0.9,
    warmth: 0.15,
    preview_text: "试听文本",
    preview_audio_uri: null,
    visibility: "public" as const,
    provider_status: "missing",
  },
];

const artPresets = [
  {
    preset_id: "art_style_classical_ink",
    preset_version: "v1",
    display_name: "古典水墨",
    description: "水墨工笔",
    overridable_fields: null,
    summary: "水墨工笔；必达负面清单 5 项",
  },
];

const subtitlePresets = [
  {
    preset_id: "subtitle_style_bold_stroke",
    preset_version: "v1",
    display_name: "粗描边醒目",
    description: "粗描边",
    overridable_fields: ["font_size_px", "position", "shadow", "text_color"],
    summary: "subtitle_style_bold_stroke",
  },
];

describe("CreativeVoiceSettings", () => {
  it("默认选中自动匹配；点击档案选中并 emit；cached 试听直接播放", async () => {
    const play = vi.fn(async () => undefined);
    vi.stubGlobal("Audio", vi.fn(() => ({ play })));
    const wrapper = mount(CreativeVoiceSettings, {
      props: { modelValue: null, profiles },
      global: { plugins: [ElementPlus] },
    });

    expect(wrapper.find('[data-testid="voice-auto"]').classes()).toContain("active");
    await wrapper.find('[data-testid="voice-voice_preset_cold_authority"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["voice_preset_cold_authority"]);

    // cached 试听：直接播放，无项目上下文也不报错
    await wrapper.find('[data-testid="voice-preview-voice_preset_cold_authority"]').trigger("click");
    expect(play).toHaveBeenCalled();
  });

  it("无项目上下文 + 非 cached → 显示引导文案（不发起试听）", async () => {
    const onPreview = vi.fn(async () => null);
    const wrapper = mount(CreativeVoiceSettings, {
      props: { modelValue: null, profiles, projectId: null, onPreview },
      global: { plugins: [ElementPlus] },
    });
    await wrapper.find('[data-testid="voice-preview-voice_preset_eerie_suspense"]').trigger("click");
    await flushPromises();
    expect(onPreview).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="voice-preview-error"]').text()).toContain("项目设置");
  });
});

describe("CreativeArtStyleSettings", () => {
  it("不启用 = null；选中 preset emit", async () => {
    const wrapper = mount(CreativeArtStyleSettings, {
      props: { modelValue: null, presets: artPresets },
      global: { plugins: [ElementPlus] },
    });
    expect(wrapper.find('[data-testid="art-none"]').classes()).toContain("active");
    await wrapper.find('[data-testid="art-art_style_classical_ink"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["art_style_classical_ink"]);
  });
});

describe("CreativeSubtitleSettings", () => {
  it("preset 选择 + 安全覆盖表单 emit + 预览框随覆盖更新", async () => {
    const wrapper = mount(CreativeSubtitleSettings, {
      props: { modelValue: null, overrides: {}, presets: subtitlePresets },
      global: { plugins: [ElementPlus] },
    });

    await wrapper.find('[data-testid="subtitle-subtitle_style_bold_stroke"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["subtitle_style_bold_stroke"]);

    // 选择后覆盖表单可见
    await wrapper.setProps({ modelValue: "subtitle_style_bold_stroke" });
    expect(wrapper.find('[data-testid="subtitle-overrides"]').exists()).toBe(true);

    // 字号覆盖 → emit overrides + 预览字号更新
    const fontInput = wrapper.find('[data-testid="override-font_size_px"]');
    await fontInput.setValue("60");
    await fontInput.trigger("change");
    const emittedOverrides = wrapper.emitted("update:overrides")?.[0]?.[0] as Record<string, unknown>;
    expect(emittedOverrides.font_size_px).toBe(60);

    await wrapper.setProps({ overrides: emittedOverrides });
    const previewText = wrapper.find('[data-testid="subtitle-preview-text"]');
    expect(previewText.attributes("style")).toContain("font-size: 60px");

    // style_id / 字体族不可编辑（表单中不存在对应字段）
    expect(wrapper.find('[data-testid="override-style_id"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="override-font_family"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="override-safe_area_top_px"]').exists()).toBe(false);
  });
});
