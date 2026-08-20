// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** S2-2A 任务 10：设置页/项目设置 UI 失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 10 步骤 1 验收：
 * - /settings 四档视频策略 + 720p/1080p；默认“优先 Remotion”。
 * - 预算“不设上限”或 CNY 金额，保存转换为微元十进制字符串。
 * - 明确说明用户默认只影响新项目。
 * - 项目设置独立修改 + 保存前失效预览。
 * - 模型只显示“自动”或真实 enabled 项；不展示假 provider。
 * - 页面不显示/提交 API key、credential id、内部环境变量名。
 */

import SettingsPage from "../../frontend/src/views/SettingsPage.vue";
import ProjectGenerationSettings from "../../frontend/src/components/settings/ProjectGenerationSettings.vue";
import {
  createFetchGenerationConfigApi,
  createGenerationConfigStore,
  generationConfigStoreKey,
  type GenerationConfigStore,
} from "../../frontend/src/stores/generation-config";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { authStoreKey, type AuthStore } from "../../frontend/src/stores/auth";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
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
      error: null,
    },
    capabilities: [
      {
        id: "dashscope-image-cn",
        capability: "image.generate",
        provider_key: "dashscope",
        model_id: "wan2.6-t2i",
        model_version: null,
        display_name: "通义万相 文生图",
        quality_tier: "standard",
        speed_tier: "fast",
        parameter_capabilities: {},
        pricing_version: "dashscope-cn-2026-08-12",
        pricing: {},
        status: "active",
        is_default: true,
        availability: "enabled",
      },
    ],
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
      provide: { [generationConfigStoreKey as symbol]: store },
    },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsPage（用户默认设置）", () => {
  it("渲染四档视频策略体验文案，默认选中优先 Remotion", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("全部使用 API 视频");
    expect(text).toContain("优先 API 视频");
    expect(text).toContain("优先 Remotion");
    expect(text).toContain("全部使用 Remotion");

    const selected = wrapper.find('[data-testid="strategy-prefer_remotion"]').element as HTMLInputElement;
    expect(selected.checked).toBe(true);
  });

  it("API 画质可选 720P/1080P；预算支持不设上限与 CNY 金额", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    expect(wrapper.text()).toContain("标准 720P");
    expect(wrapper.text()).toContain("高质量 1080P");

    const unlimited = wrapper.find('[data-testid="budget-unlimited"]');
    expect(unlimited.exists()).toBe(true);
    // 初始为“不设上限”：金额输入框只在切换到“设置金额”后出现
    expect(wrapper.find('[data-testid="budget-amount"]').exists()).toBe(false);
    await wrapper.find('[data-testid="budget-amount-enabled"]').setValue();
    expect(wrapper.find('[data-testid="budget-amount"]').exists()).toBe(true);
  });

  it("明确说明用户默认只影响新项目", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    expect(wrapper.text()).toContain("只影响新项目");
  });

  it("保存时把 CNY 金额转换为微元十进制字符串提交", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    await wrapper.find('[data-testid="strategy-all_api_video"]').setValue();
    await wrapper.find('[data-testid="budget-amount-enabled"]').setValue();
    const amountInput = wrapper.find('[data-testid="budget-amount"]');
    await amountInput.setValue("12.34");
    await wrapper.find('[data-testid="save-preference"]').trigger("click");
    await flushPromises();

    expect(store.saveUserPreference).toHaveBeenCalledWith({
      video: { strategy: "all_api_video", api_quality: "standard_720p" },
      budgetMicros: "12340000",
    });
  });

  it("能力摘要只显示自动/真实 enabled 项，不含凭据或环境变量", async () => {
    const store = createMockStore();
    const wrapper = mountSettings(store);
    await flushPromises();

    const summary = wrapper.find('[data-testid="capability-summary"]');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain("自动");
    expect(summary.text()).toContain("通义万相 文生图");

    const html = wrapper.html();
    expect(html).not.toContain("api_key");
    expect(html).not.toContain("credential");
    expect(html).not.toContain("ALIYUN_");
    expect(html.toLowerCase()).not.toContain("env");
  });

  it("409 冲突时展示冲突提示（不覆盖较新配置由 store 保证）", async () => {
    const store = createMockStore();
    (store.state.userPreference as { conflict: boolean }).conflict = true;
    const wrapper = mountSettings(store);
    await flushPromises();

    expect(wrapper.find('[data-testid="preference-conflict"]').exists()).toBe(true);
  });

  it("轮1 I-1：真实 409 路径（store 重载后）表单草稿跟随服务器最新值", async () => {
    // mock fetch 序列（onMounted 会依次调用 loadUserPreference、loadCapabilities）：
    // 1) GET preferences 200(revision=4) → 2) GET capabilities 200([])
    // 3) PATCH 409 → 4) store 自动 GET preferences 200(revision=5, all_remotion)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          source: "stored",
          revision: 4,
          configuration: DEFAULT_CONFIGURATION,
          updated_at: "2026-08-20T10:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { capabilities: [] }))
      .mockResolvedValueOnce(
        jsonResponse(409, { error: "generation_preference_revision_conflict", current_revision: 5 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          source: "stored",
          revision: 5,
          configuration: {
            ...DEFAULT_CONFIGURATION,
            video: { strategy: "all_remotion", api_quality: "standard_720p" },
          },
          updated_at: "2026-08-20T11:00:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = createGenerationConfigStore(createFetchGenerationConfigApi());
    const wrapper = mountSettings(store);
    await flushPromises(); // onMounted 完成初次加载（revision=4）

    // 用户编辑（本地草稿偏离服务器值）
    await wrapper.find('[data-testid="strategy-all_api_video"]').setValue();
    expect(
      (wrapper.find('[data-testid="strategy-all_api_video"]').element as HTMLInputElement).checked,
    ).toBe(true);

    // 保存 → 409 → store 重载服务器新值并置冲突 → 表单草稿必须跟随
    const result = await store.saveUserPreference({
      video: { strategy: "all_api_video", api_quality: "standard_720p" },
      budgetMicros: null,
    });
    expect(result.ok).toBe(false);
    await flushPromises();

    expect(
      (wrapper.find('[data-testid="strategy-all_remotion"]').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (wrapper.find('[data-testid="strategy-all_api_video"]').element as HTMLInputElement).checked,
    ).toBe(false);
    expect(wrapper.find('[data-testid="preference-conflict"]').exists()).toBe(true);
  });

  it("轮1 I-2：偏好加载失败时展示错误态，不渲染可编辑表单", async () => {
    const store = createMockStore();
    const pref = store.state.userPreference as { error: string | null; data: null };
    pref.data = null;
    pref.error = "network_error";
    const wrapper = mountSettings(store);
    await flushPromises();

    expect(wrapper.find('[data-testid="preference-load-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="save-preference"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="strategy-prefer_remotion"]').exists()).toBe(false);
  });

  it("轮1 Minor-2：错误态重试按钮重新加载后恢复表单", async () => {
    // 序列：1) GET preferences 失败 → 2) GET capabilities 200([])（onMounted 顺序调用）
    // → 3) 重试 GET preferences 200(revision=1)
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network_error"))
      .mockResolvedValueOnce(jsonResponse(200, { capabilities: [] }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          source: "stored",
          revision: 1,
          configuration: DEFAULT_CONFIGURATION,
          updated_at: "2026-08-20T10:00:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const store = createGenerationConfigStore(createFetchGenerationConfigApi());
    const wrapper = mountSettings(store);
    await flushPromises(); // onMounted 加载失败 → 错误态

    expect(wrapper.find('[data-testid="preference-load-error"]').exists()).toBe(true);
    await wrapper.find('[data-testid="preference-load-error"] button').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="preference-load-error"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="save-preference"]').exists()).toBe(true);
    expect(
      (wrapper.find('[data-testid="strategy-prefer_remotion"]').element as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe("ProjectGenerationSettings（项目设置）", () => {
  it("展示项目当前值、来源说明与用户默认差异", async () => {
    const store = createMockStore();
    const config = store.state.projectConfigs["proj-1"]!.data!;
    config.diff_from_user_default = {
      video: { from: { strategy: "prefer_remotion" }, to: { strategy: "all_remotion" } },
    };
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain("继承自创建时用户默认");
    expect(text).toContain("与当前用户默认不同");
  });

  it("保存前展示失效预览（策略变化 → 路线解析与资产规划）", async () => {
    const store = createMockStore();
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    await wrapper.find('[data-testid="project-strategy-all_api_video"]').setValue();
    const preview = wrapper.find('[data-testid="project-invalidation-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toContain("资产规划");
  });

  it("保存调用 saveProjectConfig 并携带 expected_revision 语义（store 内部处理）", async () => {
    const store = createMockStore();
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    await wrapper.find('[data-testid="project-strategy-prefer_api_video"]').setValue();
    await wrapper.find('[data-testid="save-project-config"]').trigger("click");
    await flushPromises();

    expect(store.saveProjectConfig).toHaveBeenCalledWith("proj-1", {
      video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
      budgetMicros: null,
    });
  });

  it("不含凭据/环境变量内容", async () => {
    const store = createMockStore();
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    const html = wrapper.html();
    expect(html).not.toContain("api_key");
    expect(html).not.toContain("credential");
    expect(html).not.toContain("ALIYUN_");
  });

  it("轮2 Minor-4：409 冲突时保留对话框（不关闭），冲突告警可见", async () => {
    const store = createMockStore();
    store.saveProjectConfig = vi.fn(async () => {
      // 模拟真实 store：409 时置 conflict 标记（告警由 configState.conflict 驱动）
      const slice = store.state.projectConfigs["proj-1"] as { conflict: boolean };
      slice.conflict = true;
      return { ok: false, conflict: true };
    });
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    await wrapper.find('[data-testid="project-strategy-prefer_api_video"]').setValue();
    await wrapper.find('[data-testid="save-project-config"]').trigger("click");
    await flushPromises();

    // 冲突：对话框未关闭（保存按钮仍存在），冲突告警渲染
    expect(wrapper.find('[data-testid="save-project-config"]').exists()).toBe(true);
    expect(wrapper.find(".el-alert").exists()).toBe(true);
  });

  it("保存成功后关闭对话框（emit close）", async () => {
    const store = createMockStore();
    store.saveProjectConfig = vi.fn(async () => ({ ok: true }));
    const wrapper = mountProjectSettings(store);
    await flushPromises();

    await wrapper.find('[data-testid="project-strategy-prefer_api_video"]').setValue();
    await wrapper.find('[data-testid="save-project-config"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close")).toBeTruthy();
  });
});
