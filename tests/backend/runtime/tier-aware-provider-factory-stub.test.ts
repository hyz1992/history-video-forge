import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 4 验收项（复审整改 P2-3）：stub 部署忽略快照、走 stub 路径。
 *
 * 设计 §6.1：`env.llm.provider === "stub"` → 忽略快照模型走 stub 路径。
 * 工厂本身不接管 stub 构造（契约："调用方需自行判断 stub 并走 stub 分支"），
 * 因此验收对象是**真实调用方 gateway**：
 * - stub + 快照 → gateway 走 stub 分支（createStubScriptWriterProvider），
 *   `createTierAwareProviderFromEnv` **零调用**，不解析/不调用快照模型；
 * - stub + 无快照 → 同样 stub 分支（工厂零调用）。
 */

const { factoryOptionsMock } = vi.hoisted(() => ({ factoryOptionsMock: vi.fn() }));

// stub 部署：provider="stub"，未配置任何真实模型
vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",

    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    llm: {
      provider: "stub",
      baseUrl: undefined,
      apiKey: undefined,
      model: "stub-model",
      structuredModel: undefined,
      timeoutMs: 45000,
    },
  };
  return {
    env,
    getValidatedRuntimeEnv: () => env,
  };
});

// 工厂 mock：记录调用（断言 stub 路径"工厂零调用"）
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

import { createScriptWriterGateway } from "../../../backend/src/modules/script/script-generation.service.js";

const SNAPSHOT_CAPABILITIES = {
  "llm.smart": {
    mode: "fixed" as const,
    provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    provider_key: "deepseek",
    model_id: "deepseek-v4-pro",
  },
  "llm.flash": {
    mode: "auto" as const,
    provider_model_id: "llm.flash.zhipu.glm-4",
    provider_key: "zhipu",
    model_id: "glm-4",
  },
  "image.generate": { mode: "auto" as const, provider_model_id: "img", provider_key: "dashscope", model_id: "wanx" },
  "video.image_to_video": { mode: "auto" as const, provider_model_id: "vid", provider_key: "dashscope", model_id: "wan" },
  "tts.synthesize": { mode: "auto" as const, provider_model_id: "tts", provider_key: "dashscope", model_id: "qwen" },
};

describe("tier-aware-provider-factory stub 部署（S2-2C 任务 4 验收）", () => {
  beforeEach(() => {
    factoryOptionsMock.mockReset();
  });

  it("stub + 快照经真实 gateway 驱动 → 走 stub 分支：工厂零调用、不解析快照模型", async () => {
    // 真实调用方 gateway（script writer）：stub 部署下走
    // createStubScriptWriterProvider，不触达 createTierAwareProviderFromEnv。
    // gateway 构造即 stub 分支的证明：非 stub 分支会调用工厂并因未配置
    // LLM 抛错；stub 分支构造成功且工厂零调用、快照模型不被解析。
    const gateway = createScriptWriterGateway(SNAPSHOT_CAPABILITIES);
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).not.toHaveBeenCalled();
  });

  it("stub + 无快照经真实 gateway 驱动 → 同样走 stub 分支（工厂零调用）", async () => {
    const gateway = createScriptWriterGateway();
    expect(gateway).toBeDefined();
    expect(factoryOptionsMock).not.toHaveBeenCalled();
  });
});
