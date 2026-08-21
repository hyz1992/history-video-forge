import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 5b：storyboard / topic 链快照接线测试（详细设计 §6.1 单一真相源）。
 *
 * 模式沿用 task 5a / llm-paid-generation-gate.test.ts：
 * - vi.mock env → provider="openai"（非 stub，gateway 走工厂路径）。
 * - vi.mock 工厂 → 记录 options 参数（断言快照 capabilities 透传）。
 *
 * 覆盖：storyboard planner gateway 与 topic recommendation gateway 把
 * snapshotCapabilities 传给工厂（auto/fixed 一律）；无快照 → undefined（env 路径）。
 * run-service 级 billingContext 派生在任务 9 e2e 全链覆盖。
 */

const { factoryOptionsMock } = vi.hoisted(() => ({ factoryOptionsMock: vi.fn() }));

vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    demoMode: false,
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

import { createStoryboardPlannerGateway } from "../../../backend/src/modules/storyboard/storyboard-generation.service.js";
import { createTopicRecommendationGateway } from "../../../backend/src/modules/topic/topic-recommendation.service.js";
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

describe("storyboard / topic 链快照接线（S2-2C）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("createStoryboardPlannerGateway 把 snapshotCapabilities 透传给工厂", () => {
    const gateway = createStoryboardPlannerGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("createStoryboardPlannerGateway 无快照 → 工厂收到 undefined（env 路径不变）", () => {
    createStoryboardPlannerGateway();
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });

  it("createTopicRecommendationGateway 把 snapshotCapabilities 透传给工厂", () => {
    const gateway = createTopicRecommendationGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).toHaveBeenCalledWith({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
  });

  it("createTopicRecommendationGateway 无快照 → 工厂收到 undefined（env 路径不变）", () => {
    createTopicRecommendationGateway();
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });
});
