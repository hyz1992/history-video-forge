// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 8：CapabilitySlotSettings 组件 + 设置页/项目设置高级区接入。
 *
 * - 五槽渲染（候选来自 store capabilities，按槽分组）。
 * - 选"自动" → {mode:"auto"}；选候选 → {mode:"fixed", provider_model_id}。
 * - 单候选槽位显示"当前仅配置 X"；无候选显示"当前部署无可用模型"。
 * - SettingsPage 保存调用携带完整五槽 capabilities。
 * - 项目设置失效预览扩展（llm_generation 等阶段标签）。
 */

import CapabilitySlotSettings from "../../frontend/src/components/settings/CapabilitySlotSettings.vue";
import SettingsPage from "../../frontend/src/views/SettingsPage.vue";
import ProjectGenerationSettings from "../../frontend/src/components/settings/ProjectGenerationSettings.vue";
import {
  createGenerationConfigStore,
  generationConfigStoreKey,
  type CapabilitySlotSelectionMap,
  type GenerationConfigStore,
  type PublicCapabilityEntryDto,
} from "../../frontend/src/stores/generation-config";
import {
  createCreativePresetsStore,
  creativePresetsStoreKey,
  type CreativePresetsStore,
} from "../../frontend/src/stores/creative-presets";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { authStoreKey, type AuthStore } from "../../frontend/src/stores/auth";

function createCreativeMockStore(): CreativePresetsStore {
  return createCreativePresetsStore({
    listCreativePresets: async () => ({ art_style: [], subtitle: [] }),
    listVoiceProfiles: async () => ({ profiles: [] }),
    requestVoicePreview: async () => ({ preview_audio_uri: "", source: "generated", provider_voice_id: null }),
  });
}

const DEFAULT_CONFIGURATION = {
  schema_version: "generation_configuration_v1",
  video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
  budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
  creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null },
  capabilities: {
    "llm.smart": { mode: "auto" },
    "llm.flash": { mode: "auto" },
    "image.generate": { mode: "auto" },
    "video.image_to_video": { mode: "auto" },
    "tts.synthesize": { mode: "auto" },
  },
};

function catalogEntry(overrides: Partial<PublicCapabilityEntryDto>): PublicCapabilityEntryDto {
  return {
    id: "llm.smart.deepseek.deepseek-v4-pro",
    capability: "llm.smart",
    provider_key: "deepseek",
    model_id: "deepseek-v4-pro",
    model_version: null,
    display_name: "DeepSeek V4 Pro",
    quality_tier: "high",
    speed_tier: "slow",
    parameter_capabilities: {},
    pricing_version: "llm-deepseek-2026-08-17",
    pricing: {},
    status: "active",
    is_default: false,
    availability: "enabled",
    ...overrides,
  };
}

/** 双候选（smart 槽）+ 单候选（tts 槽）+ 无候选（video 槽）的目录。 */
const MULTI_CAPABILITIES: PublicCapabilityEntryDto[] = [
  catalogEntry({}),
  catalogEntry({
    id: "llm.smart.zhipu.glm-4",
    capability: "llm.smart",
    provider_key: "zhipu",
    model_id: "glm-4",
    display_name: "智谱 GLM-4",
    quality_tier: "standard",
    speed_tier: "fast",
  }),
  catalogEntry({
    id: "tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash",
    capability: "tts.synthesize",
    provider_key: "dashscope",
    model_id: "qwen3-tts-instruct-flash",
    display_name: "通义千问 TTS",
    quality_tier: "standard",
    speed_tier: "fast",
    is_default: true,
  }),
];

function createMockStore(overrides: Partial<GenerationConfigStore> = {}): GenerationConfigStore {
  const state = reactive({
    userPreference: {
      data: {
        source: "stored",
        revision: 4,
        configuration: DEFAULT_CONFIGURATION,
        updated_at: "2026-08-20T10:00:00.000Z",
      },
      loading: false,
      saving: false,
      conflict: false,
      conflictEpoch: 0,
      error: null,
    },
    capabilities: MULTI_CAPABILITIES,
    projectCapabilities: { "proj-1": MULTI_CAPABILITIES },
    capabilitiesLoading: false,
    projectConfigs: {
      "proj-1": {
        data: {
          source: "stored",
          revision: 3,
          configuration: DEFAULT_CONFIGURATION,
          updated_at: "2026-08-20T10:00:00.000Z",
          source_user_preference_revision: 2,
          diff_from_user_default: null,
          invalidation_preview: { affected_stages: ["none"], note: "当前配置与用户默认一致" },
        },
        loading: false,
        saving: false,
        conflict: false,
        conflictEpoch: 0,
        error: null,
      },
    },
  });
  return {
    state,
    loadUserPreference: vi.fn(async () => undefined),
    saveUserPreference: vi.fn(async () => ({ ok: true as const })),
    loadCapabilities: vi.fn(async () => undefined),
    loadProjectConfig: vi.fn(async () => undefined),
    saveProjectConfig: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  } as unknown as GenerationConfigStore;
}

function mountSettings(store: GenerationConfigStore) {
  const router = createAppRouter();
  return mount(SettingsPage, {
    global: {
      plugins: [ElementPlus, router],
      provide: {
        [generationConfigStoreKey as symbol]: store,
        [creativePresetsStoreKey as symbol]: createCreativeMockStore(),
        [authStoreKey as symbol]: { state: { user: { role: "USER" } } } as unknown as AuthStore,
      },
    },
  });
}

function mountProjectSettings(store: GenerationConfigStore) {
  return mount(ProjectGenerationSettings, {
    props: { projectId: "proj-1", open: true },
    global: {
      plugins: [ElementPlus],
      provide: {
        [generationConfigStoreKey as symbol]: store,
        [creativePresetsStoreKey as symbol]: createCreativeMockStore(),
      },
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CapabilitySlotSettings 组件（S2-2C 任务 8）", () => {
  it("五槽渲染：自动 + 候选列表（候选来自目录 enabled 项，按槽分组）", () => {
    const wrapper = mount(CapabilitySlotSettings, {
      props: {
        entries: MULTI_CAPABILITIES,
        modelValue: DEFAULT_CONFIGURATION.capabilities as CapabilitySlotSelectionMap,
      },
      global: { plugins: [ElementPlus] },
    });
    const text = wrapper.text();
    for (const slot of ["llm.smart", "llm.flash", "image.generate", "video.image_to_video", "tts.synthesize"]) {
      expect(wrapper.find(`[data-testid="cap-slot-${slot}"]`).exists(), slot).toBe(true);
    }
    expect(text).toContain("自动（平台推荐）");
    // smart 槽两个候选
    expect(wrapper.find('[data-testid="cap-candidate-llm.smart-llm.smart.deepseek.deepseek-v4-pro"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]').exists()).toBe(true);
    expect(text).toContain("DeepSeek V4 Pro");
    expect(text).toContain("智谱 GLM-4");
  });

  it("初始 auto 选中；点候选 → fixed（provider_model_id = 目录条目 id）", async () => {
    const wrapper = mount(CapabilitySlotSettings, {
      props: {
        entries: MULTI_CAPABILITIES,
        modelValue: DEFAULT_CONFIGURATION.capabilities as CapabilitySlotSelectionMap,
      },
      global: { plugins: [ElementPlus] },
    });
    const auto = wrapper.find('[data-testid="cap-auto-llm.smart"]').element as HTMLInputElement;
    expect(auto.checked).toBe(true);

    await wrapper
      .find('[data-testid="cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]')
      .setValue();
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    const last = emitted![emitted!.length - 1]![0] as CapabilitySlotSelectionMap;
    expect(last["llm.smart"]).toEqual({ mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-4" });
  });

  it("选回自动 → {mode:auto}", async () => {
    const wrapper = mount(CapabilitySlotSettings, {
      props: {
        entries: MULTI_CAPABILITIES,
        modelValue: {
          ...DEFAULT_CONFIGURATION.capabilities,
          "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-4" },
        } as CapabilitySlotSelectionMap,
      },
      global: { plugins: [ElementPlus] },
    });
    await wrapper.find('[data-testid="cap-auto-llm.smart"]').setValue();
    const emitted = wrapper.emitted("update:modelValue");
    const last = emitted![emitted!.length - 1]![0] as CapabilitySlotSelectionMap;
    expect(last["llm.smart"]).toEqual({ mode: "auto" });
  });

  it("单候选槽位显示'当前仅配置 X'（仍允许固定以锁定语义）", () => {
    const wrapper = mount(CapabilitySlotSettings, {
      props: {
        entries: MULTI_CAPABILITIES,
        modelValue: DEFAULT_CONFIGURATION.capabilities as CapabilitySlotSelectionMap,
      },
      global: { plugins: [ElementPlus] },
    });
    expect(wrapper.find('[data-testid="cap-single-note-tts.synthesize"]').text()).toContain("当前仅配置");
    expect(wrapper.find('[data-testid="cap-single-note-tts.synthesize"]').text()).toContain("通义千问 TTS");
    // 该槽候选仍可固定
    expect(
      wrapper.find('[data-testid="cap-candidate-tts.synthesize-tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash"]').exists(),
    ).toBe(true);
  });

  it("无候选槽位显示'当前部署无可用模型'", () => {
    const wrapper = mount(CapabilitySlotSettings, {
      props: {
        entries: MULTI_CAPABILITIES,
        modelValue: DEFAULT_CONFIGURATION.capabilities as CapabilitySlotSelectionMap,
      },
      global: { plugins: [ElementPlus] },
    });
    expect(wrapper.find('[data-testid="cap-empty-video.image_to_video"]').text()).toContain("当前部署无可用模型");
  });
});

describe("SettingsPage 高级设置区（S2-2C 任务 8）", () => {
  it("渲染五槽高级设置区；保存调用携带完整五槽 capabilities", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    expect(wrapper.text()).toContain("高级设置");
    expect(wrapper.find('[data-testid="cap-slot-llm.smart"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="cap-slot-tts.synthesize"]').exists()).toBe(true);

    // 把 smart 固定到候选后保存：完整五槽随 PATCH 提交
    await wrapper
      .find('[data-testid="cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]')
      .setValue();
    await wrapper.find('[data-testid="save-preference"]').trigger("click");
    await flushPromises();

    expect(store.saveUserPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: {
          "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-4" },
          "llm.flash": { mode: "auto" },
          "image.generate": { mode: "auto" },
          "video.image_to_video": { mode: "auto" },
          "tts.synthesize": { mode: "auto" },
        },
      }),
    );
  });

  it("刷新恢复：草稿从服务器配置回填 capabilities", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    // 服务器配置带 fixed tts → 渲染时 tts 候选 radio 选中
    const ttsCandidate = wrapper.find(
      '[data-testid="cap-candidate-tts.synthesize-tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash"]',
    ).element as HTMLInputElement;
    // 服务器 capabilities 全 auto → 未选中（auto 选中）
    expect(ttsCandidate.checked).toBe(false);
    const auto = wrapper.find('[data-testid="cap-auto-tts.synthesize"]').element as HTMLInputElement;
    expect(auto.checked).toBe(true);
  });
});

describe("ProjectGenerationSettings 高级设置区（S2-2C 任务 8）", () => {
  it("渲染高级设置区；保存项目配置携带 capabilities；失效预览含 llm_generation 阶段标签", async () => {
    const store = createMockStore();
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    expect(wrapper.find('[data-testid="project-cap-slot-llm.smart"]').exists()).toBe(true);
    // 高级区候选与目录同源：打开对话框即加载 capabilities（真实页面缺陷修复）
    expect(store.loadCapabilities).toHaveBeenCalled();

    // 固定 smart → 失效预览出现 LLM 生成阶段
    await wrapper.find('[data-testid="project-cap-candidate-llm.smart-llm.smart.zhipu.glm-4"]').setValue();
    await flushPromises();
    const preview = wrapper.find('[data-testid="project-invalidation-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("LLM 生成");

    await wrapper.find('[data-testid="save-project-config"]').trigger("click");
    await flushPromises();
    expect(store.saveProjectConfig).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        capabilities: {
          "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-4" },
          "llm.flash": { mode: "auto" },
          "image.generate": { mode: "auto" },
          "video.image_to_video": { mode: "auto" },
          "tts.synthesize": { mode: "auto" },
        },
      }),
    );
  });
});
