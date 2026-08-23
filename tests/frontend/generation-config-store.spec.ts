import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** S2-2A 任务 10：generation-config store 失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 10 步骤 1 验收：
 * - 预算 CNY 金额 ↔ 微元十进制字符串转换（不用 Number 处理超安全整数）。
 * - PATCH 携带 expected_revision（乐观并发）。
 * - 409 冲突时重新加载并提示冲突，不覆盖较新配置。
 * - 项目配置返回来源/差异；目录只返回 enabled 项。
 */

import {
  cnyInputToMicrosString,
  computeConfigInvalidationPreview,
  createFetchGenerationConfigApi,
  createGenerationConfigStore,
  microsStringToCnyInput,
  type GenerationConfigApi,
} from "../../frontend/src/stores/generation-config";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

const DEFAULT_PREFERENCE = {
  source: "backfilled_default",
  revision: 1,
  configuration: {
    schema_version: "generation_configuration_v1",
    video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
    creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null },
    capabilities: {
      "llm.smart": { mode: "auto" },
      "llm.flash": { mode: "auto" },
      "image.generate": { mode: "auto" },
      "video.image_to_video": { mode: "auto" },
      "tts.synthesize": { mode: "auto" },
    },
  },
  updated_at: "2026-08-20T10:00:00.000Z",
};

describe("generation config store (user preference)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadUserPreference 默认显示优先 Remotion（服务器默认配置）", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, DEFAULT_PREFERENCE));
    const store = createGenerationConfigStore(createFetchGenerationConfigApi());

    await store.loadUserPreference();

    expect(store.state.userPreference.data?.configuration.video.strategy).toBe("prefer_remotion");
    expect(store.state.userPreference.loading).toBe(false);
  });

  it("saveUserPreference 携带 expected_revision 且提交体不含预算字段", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULT_PREFERENCE));
    const api = createFetchGenerationConfigApi();
    const store = createGenerationConfigStore(api);
    await store.loadUserPreference();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...DEFAULT_PREFERENCE, revision: 2, source: "stored" }),
    );
    const result = await store.saveUserPreference({
      video: { strategy: "all_api_video", api_quality: "high_1080p" },
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.expected_revision).toBe(1);
    expect(body.video).toEqual({ strategy: "all_api_video", api_quality: "high_1080p" });
    // 提交体不含 budget/creative/capabilities/凭据字段
    expect(Object.keys(body).sort()).toEqual(["expected_revision", "video"]);
  });

  it("409 冲突时置冲突标记并重新加载，不覆盖较新配置", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULT_PREFERENCE));
    const api = createFetchGenerationConfigApi();
    const store = createGenerationConfigStore(api);
    await store.loadUserPreference();

    // 保存遇到 409 revision conflict；随后重载返回 revision=5 的新配置
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "generation_preference_revision_conflict", current_revision: 5 }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...DEFAULT_PREFERENCE,
        revision: 5,
        source: "stored",
        configuration: {
          ...DEFAULT_PREFERENCE.configuration,
          video: { strategy: "all_remotion", api_quality: "standard_720p" },
        },
      }),
    );

    const result = await store.saveUserPreference({
      video: { strategy: "all_api_video", api_quality: "standard_720p" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict).toBe(true);
    expect(store.state.userPreference.conflict).toBe(true);
    // 本地保留服务器较新 revision=5（all_remotion），未被旧草稿覆盖
    expect(store.state.userPreference.data?.revision).toBe(5);
    expect(store.state.userPreference.data?.configuration.video.strategy).toBe("all_remotion");
  });

  it("B2：连续两次 409 时 conflictEpoch 每次自增，data 同步到最新重载值", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULT_PREFERENCE));
    const api = createFetchGenerationConfigApi();
    const store = createGenerationConfigStore(api);
    await store.loadUserPreference();

    // 第一次 409 → 重载 revision=5
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "generation_preference_revision_conflict", current_revision: 5 }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...DEFAULT_PREFERENCE, revision: 5, source: "stored" }),
    );
    const first = await store.saveUserPreference({
      video: { strategy: "all_api_video", api_quality: "standard_720p" },
    });
    expect(first.ok).toBe(false);
    const epochAfterFirst = store.state.userPreference.conflictEpoch;
    expect(epochAfterFirst).toBeGreaterThan(0);
    expect(store.state.userPreference.conflict).toBe(true);

    // 第二次 409（conflict 仍为 true——布尔 watcher 不会触发）→ 重载 revision=7
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: "generation_preference_revision_conflict", current_revision: 7 }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ...DEFAULT_PREFERENCE,
        revision: 7,
        source: "stored",
        configuration: {
          ...DEFAULT_PREFERENCE.configuration,
          video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
        },
      }),
    );
    const second = await store.saveUserPreference({
      video: { strategy: "all_api_video", api_quality: "standard_720p" },
    });
    expect(second.ok).toBe(false);
    // epoch 递增：watcher 每次冲突都会触发同步
    expect(store.state.userPreference.conflictEpoch).toBe(epochAfterFirst + 1);
    expect(store.state.userPreference.data?.revision).toBe(7);
    expect(store.state.userPreference.data?.configuration.video.strategy).toBe("prefer_api_video");
  });
});

describe("generation config store (project config + capabilities)", () => {
  function createMockApi(): GenerationConfigApi & {
    getProjectConfig: ReturnType<typeof vi.fn>;
    patchProjectConfig: ReturnType<typeof vi.fn>;
    listCapabilities: ReturnType<typeof vi.fn>;
  } {
    return {
      getUserPreference: vi.fn(),
      patchUserPreference: vi.fn(),
      getProjectConfig: vi.fn(),
      patchProjectConfig: vi.fn(),
      listCapabilities: vi.fn(),
    };
  }

  it("loadProjectConfig 返回来源与用户默认差异", async () => {
    const api = createMockApi();
    api.getProjectConfig.mockResolvedValue({
      source: "stored",
      revision: 3,
      configuration: DEFAULT_PREFERENCE.configuration,
      updated_at: "2026-08-20T10:00:00.000Z",
      source_user_preference_revision: 2,
      diff_from_user_default: { video: { from: { strategy: "prefer_remotion" }, to: { strategy: "all_remotion" } } },
      invalidation_preview: { affected_stages: ["none"], note: "一致" },
    });
    const store = createGenerationConfigStore(api);

    await store.loadProjectConfig("proj-1");

    expect(store.state.projectConfigs["proj-1"]?.data?.revision).toBe(3);
    expect(store.state.projectConfigs["proj-1"]?.data?.source_user_preference_revision).toBe(2);
    expect(store.state.projectConfigs["proj-1"]?.data?.diff_from_user_default).not.toBeNull();
  });

  it("saveProjectConfig 携带 expected_revision；409 置冲突并重载", async () => {
    const api = createMockApi();
    api.getProjectConfig.mockResolvedValue({
      source: "stored",
      revision: 3,
      configuration: DEFAULT_PREFERENCE.configuration,
      updated_at: "2026-08-20T10:00:00.000Z",
      source_user_preference_revision: 2,
      diff_from_user_default: null,
      invalidation_preview: { affected_stages: ["none"], note: "一致" },
    });
    api.patchProjectConfig.mockRejectedValue(
      Object.assign(new Error("project_generation_configuration_revision_conflict"), { status: 409 }),
    );
    const store = createGenerationConfigStore(api);
    await store.loadProjectConfig("proj-1");

    const result = await store.saveProjectConfig("proj-1", {
      video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
    });

    expect(api.patchProjectConfig).toHaveBeenCalledWith("proj-1", {
      expected_revision: 3,
      video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
      });
    expect(result.ok).toBe(false);
    expect(store.state.projectConfigs["proj-1"]?.conflict).toBe(true);
    // 冲突后重新拉取服务器配置
    expect(api.getProjectConfig).toHaveBeenCalledTimes(2);
  });

  it("loadCapabilities 只保留 enabled 项", async () => {
    const api = createMockApi();
    api.listCapabilities.mockResolvedValue({
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
        {
          id: "disabled-item",
          capability: "video.image_to_video",
          provider_key: "dashscope",
          model_id: "old-model",
          model_version: null,
          display_name: "已禁用模型",
          quality_tier: null,
          speed_tier: null,
          parameter_capabilities: {},
          pricing_version: "dashscope-cn-2026-08-12",
          pricing: {},
          status: "disabled",
          is_default: false,
          availability: "disabled",
        },
      ],
    });
    const store = createGenerationConfigStore(api);

    await store.loadCapabilities();

    expect(store.state.capabilities.length).toBe(1);
    expect(store.state.capabilities[0]?.availability).toBe("enabled");
  });
});

describe("S2-2C capabilities PATCH 与失效预览（任务 8）", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createMockApi(): GenerationConfigApi & {
    getProjectConfig: ReturnType<typeof vi.fn>;
    patchProjectConfig: ReturnType<typeof vi.fn>;
    listCapabilities: ReturnType<typeof vi.fn>;
  } {
    return {
      getUserPreference: vi.fn(),
      patchUserPreference: vi.fn(),
      getProjectConfig: vi.fn(),
      patchProjectConfig: vi.fn(),
      listCapabilities: vi.fn(),
    };
  }

  it("saveUserPreference 携带 capabilities 段（用户偏好入口）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULT_PREFERENCE));
    const api = createFetchGenerationConfigApi();
    const store = createGenerationConfigStore(api);
    await store.loadUserPreference();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...DEFAULT_PREFERENCE, revision: 2, source: "stored" }),
    );
    const result = await store.saveUserPreference({
      video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
      capabilities: {
        "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.deepseek.deepseek-v4-pro" },
        "llm.flash": { mode: "auto" },
        "image.generate": { mode: "auto" },
        "video.image_to_video": { mode: "auto" },
        "tts.synthesize": { mode: "auto" },
      },
    });
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.capabilities).toEqual({
      "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.deepseek.deepseek-v4-pro" },
      "llm.flash": { mode: "auto" },
      "image.generate": { mode: "auto" },
      "video.image_to_video": { mode: "auto" },
      "tts.synthesize": { mode: "auto" },
    });
  });

  it("saveProjectConfig 携带 capabilities 段（项目配置入口）", async () => {
    const api = createMockApi();
    api.getProjectConfig.mockResolvedValue({
      source: "stored",
      revision: 3,
      configuration: DEFAULT_PREFERENCE.configuration,
      updated_at: "2026-08-20T10:00:00.000Z",
      source_user_preference_revision: 2,
      diff_from_user_default: null,
      invalidation_preview: { affected_stages: ["none"], note: "一致" },
    });
    api.patchProjectConfig.mockResolvedValue({
      source: "stored",
      revision: 4,
      configuration: DEFAULT_PREFERENCE.configuration,
      updated_at: "2026-08-20T10:00:00.000Z",
      source_user_preference_revision: 2,
      diff_from_user_default: null,
      invalidation_preview: { affected_stages: ["none"], note: "一致" },
    });
    const store = createGenerationConfigStore(api);
    await store.loadProjectConfig("proj-1");

    const result = await store.saveProjectConfig("proj-1", {
      video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
      capabilities: { "tts.synthesize": { mode: "fixed", provider_model_id: "tts.synthesize.dashscope.cn-beijing.custom" } },
    });

    expect(result.ok).toBe(true);
    expect(api.patchProjectConfig).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        capabilities: { "tts.synthesize": { mode: "fixed", provider_model_id: "tts.synthesize.dashscope.cn-beijing.custom" } },
      }),
    );
  });

  it("computeConfigInvalidationPreview：capabilities 变更映射（llm→llm_generation；image→asset_planning+assets；video/tts→assets）", () => {
    const current = {
      video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
      creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null, subtitle_style_overrides: {} },
      capabilities: {
        "llm.smart": { mode: "auto" },
        "llm.flash": { mode: "auto" },
        "image.generate": { mode: "auto" },
        "video.image_to_video": { mode: "auto" },
        "tts.synthesize": { mode: "auto" },
      },
    };
    const baseDraft = { video: current.video, creative: current.creative };
    const fixed = (slot: string) => ({
      ...baseDraft,
      capabilities: { ...current.capabilities, [slot]: { mode: "fixed" as const, provider_model_id: "catalog-id" } },
    });

    expect(computeConfigInvalidationPreview(current, fixed("llm.smart")).affected_stages).toEqual(["llm_generation"]);
    expect(computeConfigInvalidationPreview(current, fixed("llm.flash")).affected_stages).toEqual(["llm_generation"]);
    expect(
      computeConfigInvalidationPreview(current, fixed("image.generate")).affected_stages.sort(),
    ).toEqual(["asset_planning", "assets"]);
    expect(computeConfigInvalidationPreview(current, fixed("video.image_to_video")).affected_stages).toEqual(["assets"]);
    expect(computeConfigInvalidationPreview(current, fixed("tts.synthesize")).affected_stages).toEqual(["assets"]);
    // 无 capabilities 变化 → 不出现（视频/创作均未变 → none）
    expect(computeConfigInvalidationPreview(current, baseDraft).affected_stages).toEqual(["none"]);
    // capabilities 缺省（旧调用方）→ 不产生 capabilities 阶段（video 变化仍正常反映）
    const videoOnly = computeConfigInvalidationPreview(current, {
      video: { strategy: "all_remotion", api_quality: "standard_720p" },
      creative: current.creative,
    });
    expect(videoOnly.affected_stages).toEqual(["storyboard_route_resolution", "asset_planning"]);
  });
});
