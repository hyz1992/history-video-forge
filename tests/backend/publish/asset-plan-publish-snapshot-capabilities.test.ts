import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 5c：asset-planning / publish 链快照接线测试（详细设计 §6.1）。
 *
 * 模式沿用 task 5a/5b：
 * - vi.mock env → provider="openai"（非 stub，gateway 走工厂路径）。
 * - vi.mock 工厂 → 记录 options 参数（断言快照 capabilities 透传）。
 *
 * 覆盖：asset planner gateway、asset plan repair gateway、publish gateway
 * 把 snapshotCapabilities 传给工厂；publish gateway 快照路径不命中进程级缓存；
 * 无快照 → undefined（env 路径）。run-service 级 billingContext 派生在 e2e 全链覆盖。
 */

const { factoryOptionsMock } = vi.hoisted(() => ({ factoryOptionsMock: vi.fn() }));

vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",

    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    llm: {
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5",
      timeoutMs: 45000,
    },
  };
  return {
    env,
    getValidatedRuntimeEnv: () => env,
  };
});

vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: (options?: unknown) => {
    factoryOptionsMock(options);
    return {
      invokeStructuredPrompt: async () => ({}),
      invokeStrictStructured: async () => ({}),
    };
  },
  resolveTierProviderSnapshot: vi.fn(),
}));

import { createAssetPlannerGateway } from "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js";
import { createAssetPlanRepairGateway } from "../../../backend/src/modules/asset-planning/asset-planning-structural-repair.service.js";
import { getPublishLlmGateway } from "../../../backend/src/modules/publish/llm-helper.js";
import type { ResolvedCapabilityMap } from "../../../shared/src/index.js";

const SNAPSHOT_CAPABILITIES: ResolvedCapabilityMap = {
  "llm.smart": {
    mode: "fixed",
    provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    provider_key: "deepseek",
    model_id: "deepseek-v4-pro",
  },
  "llm.flash": {
    mode: "auto",
    provider_model_id: "llm.flash.zhipu.glm-4",
    provider_key: "zhipu",
    model_id: "glm-4",
  },
  "image.generate": { mode: "auto", provider_model_id: "img", provider_key: "dashscope", model_id: "wanx" },
  "video.image_to_video": { mode: "auto", provider_model_id: "vid", provider_key: "dashscope", model_id: "wan" },
  "tts.synthesize": { mode: "auto", provider_model_id: "tts", provider_key: "dashscope", model_id: "qwen" },
};

describe("asset-planning / publish 链快照接线（S2-2C）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("createAssetPlannerGateway 把 snapshotCapabilities 透传给工厂", () => {
    const gateway = createAssetPlannerGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("createAssetPlannerGateway 无快照 → 工厂收到 undefined", () => {
    createAssetPlannerGateway();
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });

  it("createAssetPlanRepairGateway 把 snapshotCapabilities 透传给工厂", () => {
    const gateway = createAssetPlanRepairGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("createAssetPlanRepairGateway 无快照 → 工厂收到 undefined", () => {
    createAssetPlanRepairGateway();
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });

  it("getPublishLlmGateway 快照路径按快照构造且不命中进程级缓存", () => {
    const gateway = getPublishLlmGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("getPublishLlmGateway 缺省路径走缓存 env gateway（现状行为）", () => {
    getPublishLlmGateway();
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
    // 第二次缺省调用命中缓存：不再构造（调用次数不变）
    getPublishLlmGateway();
    const undefinedCalls = factoryOptionsMock.mock.calls.filter(
      (call) => call[0] === undefined,
    );
    expect(undefinedCalls.length).toBe(1);
  });
});
