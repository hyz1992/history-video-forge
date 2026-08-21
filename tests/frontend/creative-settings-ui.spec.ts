// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

import CreativeVoiceSettings from "../../frontend/src/components/settings/CreativeVoiceSettings.vue";
import CreativeArtStyleSettings from "../../frontend/src/components/settings/CreativeArtStyleSettings.vue";
import CreativeSubtitleSettings from "../../frontend/src/components/settings/CreativeSubtitleSettings.vue";
import ProjectGenerationSettings from "../../frontend/src/components/settings/ProjectGenerationSettings.vue";
import {
  createGenerationConfigStore,
  generationConfigStoreKey,
  type GenerationConfigStore,
} from "../../frontend/src/stores/generation-config";
import {
  createCreativePresetsStore,
  creativePresetsStoreKey,
} from "../../frontend/src/stores/creative-presets";
import { reactive } from "vue";

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

describe("ProjectGenerationSettings 试听报价弹窗（复审：先试听后报价 + 稳定幂等键）", () => {
  it("stub 路径：免 quote 试听直接成功播放，不创建报价", async () => {
    const { flushPromises, mount } = await import("@vue/test-utils");
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url: urlText, body });
      if (urlText.endsWith("/preview")) {
        return new Response(
          JSON.stringify({ preview_audio_uri: "data:audio/wav;base64,ZmFrZQ==", source: "generated", provider_voice_id: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const play = vi.fn(async () => undefined);
    vi.stubGlobal("Audio", vi.fn(() => ({ play })));

    const wrapper = await mountProjectSettingsForPreview();
    await wrapper.find('[data-testid="voice-preview-voice_preset_eerie_suspense"]').trigger("click");
    await flushPromises();

    // 免 quote 直连成功：播放音频、无报价创建、无错误
    expect(play).toHaveBeenCalled();
    expect(calls.filter((c) => c.url.includes("/generation-cost-quotes"))).toHaveLength(0);
    expect(wrapper.find('[data-testid="voice-preview-error"]').exists()).toBe(false);
  });

  it("付费路径：409 后报价弹窗；确认提交同一 quote_id；失败重试复用同一幂等键", async () => {
    const { flushPromises, mount } = await import("@vue/test-utils");
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let previewSubmitCount = 0;
    let failNextSubmit = false;

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (urlText.endsWith("/generation-cost-quotes")) {
        calls.push({ url: urlText, body });
        return new Response(
          JSON.stringify({
            quote_id: "quote-preview-1",
            estimated_cost_cny: "0.080000",
            authorization_cost_cny: "0.100000",
            requires_budget_override: true,
            contains_unbounded_item: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (urlText.endsWith("/preview")) {
        calls.push({ url: urlText, body });
        if (!body.cost_quote_id) {
          // 免 quote 直连被付费闸门拒绝
          return new Response(
            JSON.stringify({
              error: "paid_generation_quote_required",
              message: "当前部署可调用付费媒体 provider：请先创建报价并在试听请求中携带 cost_quote_id 与 idempotency_key",
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        previewSubmitCount += 1;
        if (failNextSubmit) {
          failNextSubmit = false;
          throw new Error("network timeout");
        }
        return new Response(
          JSON.stringify({ preview_audio_uri: "data:audio/wav;base64,dGVzdA==", source: "generated", provider_voice_id: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("Audio", vi.fn(() => ({ play: async () => undefined })));

    const wrapper = await mountProjectSettingsForPreview();
    await flushPromises();

    // 免 quote 直连被 409 拒绝 → 报价弹窗展示（teleport 到 body）
    await wrapper.find('[data-testid="voice-preview-voice_preset_eerie_suspense"]').trigger("click");
    await flushPromises();
    const bodyText = () => document.body.textContent ?? "";
    expect(bodyText()).toContain("试听报价确认");
    expect(bodyText()).toContain("0.080000");
    const quoteCreated = calls.filter((c) => c.url.includes("/generation-cost-quotes"));
    expect(quoteCreated).toHaveLength(1);

    // 第一次确认：网络不确定失败 → 弹窗保留（同 quote + 幂等键可重试）
    failNextSubmit = true;
    await clickConfirmPreview();
    await flushPromises();
    expect(previewSubmitCount).toBe(1);
    expect(bodyText()).toContain("试听报价确认"); // 状态保留，未清空

    // 第二次确认：复用同一 quote_id + 同一幂等键 → 成功
    await clickConfirmPreview();
    await flushPromises();
    expect(previewSubmitCount).toBe(2);
    const submitCalls = calls.filter((c) => c.url.endsWith("/preview") && c.body.cost_quote_id);
    expect(submitCalls).toHaveLength(2);
    for (const submitCall of submitCalls) {
      expect(submitCall.body.cost_quote_id).toBe("quote-preview-1");
      expect(submitCall.body.authorize_budget_override).toBe(true);
      expect(submitCall.body.run_overrides).toEqual({
        creative: { voice_profile_id: "voice_preset_eerie_suspense" },
      });
    }
    // 两次提交使用同一幂等键（网络重试安全：服务端判重回放原结果）
    expect(submitCalls[0]!.body.idempotency_key).toBe(submitCalls[1]!.body.idempotency_key);
    expect(String(submitCalls[0]!.body.idempotency_key)).toMatch(/^voice-preview-/);
    // 全程只创建过一张报价
    expect(calls.filter((c) => c.url.includes("/generation-cost-quotes"))).toHaveLength(1);
    // 成功后弹窗关闭
    expect(bodyText()).not.toContain("试听报价确认");
  });
});

/** 挂载带 mock store 的项目设置组件（试听测试共用）。 */
async function mountProjectSettingsForPreview() {
  const { mount } = await import("@vue/test-utils");
  const configStore: GenerationConfigStore = createGenerationConfigStore({
    getUserPreference: async () => ({
      source: "stored",
      revision: 1,
      configuration: {
        schema_version: "generation_configuration_v1",
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null, subtitle_style_overrides: {} },
        capabilities: {},
      },
      updated_at: "2026-08-21T00:00:00.000Z",
    }),
    patchUserPreference: async () => {
      throw new Error("not used");
    },
    getProjectConfig: async () => ({
      source: "stored",
      revision: 1,
      configuration: {
        schema_version: "generation_configuration_v1",
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
        creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null, subtitle_style_overrides: {} },
        capabilities: {},
      },
      updated_at: "2026-08-21T00:00:00.000Z",
      source_user_preference_revision: 1,
      diff_from_user_default: null,
      invalidation_preview: { affected_stages: ["none"], note: "" },
    }),
    patchProjectConfig: async () => {
      throw new Error("not used");
    },
    listCapabilities: async () => ({ capabilities: [] }),
  });

  const creativeStore = createCreativePresetsStore({
    listCreativePresets: async () => ({ art_style: [], subtitle: [] }),
    listVoiceProfiles: async () => ({
      profiles: [
        {
          voice_profile_id: "voice_preset_eerie_suspense",
          kind: "preset",
          name: "幽冷悬疑型",
          description: "阴冷旁白",
          voice_traits: [],
          avoid_traits: [],
          gender_tone: null,
          age_band: null,
          pitch: null,
          pace: null,
          energy: null,
          authority: null,
          suspense: null,
          warmth: null,
          preview_text: "试听文本",
          preview_audio_uri: null,
          visibility: "public",
          provider_status: "missing",
        },
      ],
    }),
    // 试听直连走真实 fetch mock（不经 store 内置 api 的 baseUrl 拼接）
    requestVoicePreview: async (projectId, voiceProfileId, options) => {
      const { apiFetch } = await import("../../frontend/src/utils/api");
      return await apiFetch(
        "/api/projects/" + projectId + "/voice-profiles/" + voiceProfileId + "/preview",
        { method: "POST", body: options ?? {} },
      );
    },
  });

  const wrapper = mount(ProjectGenerationSettings, {
    props: { projectId: "proj-1", open: true },
    global: {
      plugins: [ElementPlus],
      provide: {
        [generationConfigStoreKey as symbol]: configStore,
        [creativePresetsStoreKey as symbol]: creativeStore,
      },
    },
  });
  await (await import("@vue/test-utils")).flushPromises();
  return wrapper;
}

/** 点击 teleport 到 body 的确认按钮。 */
async function clickConfirmPreview(): Promise<void> {
  const confirmButton = document.querySelector(
    '[data-testid="confirm-voice-preview"]',
  ) as HTMLElement | null;
  expect(confirmButton).not.toBeNull();
  confirmButton?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
