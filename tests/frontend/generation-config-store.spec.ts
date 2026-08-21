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
    budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
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

describe("budget micros conversion", () => {
  it("CNY 输入转换为微元十进制字符串", () => {
    expect(cnyInputToMicrosString("12.34")).toBe("12340000");
    expect(cnyInputToMicrosString("0.5")).toBe("500000");
    expect(cnyInputToMicrosString("0")).toBe("0");
    expect(cnyInputToMicrosString(" 8 ")).toBe("8000000");
  });

  it("非法输入返回 null（负数/非数字/超过 6 位小数）", () => {
    expect(cnyInputToMicrosString("-1")).toBeNull();
    expect(cnyInputToMicrosString("abc")).toBeNull();
    expect(cnyInputToMicrosString("1.2345678")).toBeNull();
    expect(cnyInputToMicrosString("")).toBeNull();
  });

  it("微元字符串转换为 CNY 展示（截去尾零）", () => {
    expect(microsStringToCnyInput("12340000")).toBe("12.34");
    expect(microsStringToCnyInput("500000")).toBe("0.5");
    expect(microsStringToCnyInput("0")).toBe("0");
    expect(microsStringToCnyInput(null)).toBe("");
  });

  it("超大金额不走 Number（微元超出 Number.MAX_SAFE_INTEGER 仍可往返）", () => {
    const huge = "9007199254740993"; // > MAX_SAFE_INTEGER
    const cny = microsStringToCnyInput(huge);
    expect(typeof cny).toBe("string");
    expect(cnyInputToMicrosString(cny)).toBe(huge);
  });
});

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

  it("saveUserPreference 携带 expected_revision 并以微元十进制字符串序列化预算", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, DEFAULT_PREFERENCE));
    const api = createFetchGenerationConfigApi();
    const store = createGenerationConfigStore(api);
    await store.loadUserPreference();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { ...DEFAULT_PREFERENCE, revision: 2, source: "stored" }),
    );
    const result = await store.saveUserPreference({
      video: { strategy: "all_api_video", api_quality: "high_1080p" },
      budgetMicros: "2550000",
    });

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.expected_revision).toBe(1);
    expect(body.video).toEqual({ strategy: "all_api_video", api_quality: "high_1080p" });
    expect(body.budget).toEqual({ currency: "CNY", max_paid_cost_micros_per_run: "2550000" });
    // 提交体不含 creative/capabilities/凭据字段
    expect(Object.keys(body).sort()).toEqual(["budget", "expected_revision", "video"]);
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
      budgetMicros: null,
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
      budgetMicros: null,
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
      budgetMicros: null,
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
      budgetMicros: null,
    });

    expect(api.patchProjectConfig).toHaveBeenCalledWith("proj-1", {
      expected_revision: 3,
      video: { strategy: "prefer_api_video", api_quality: "standard_720p" },
      budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
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
