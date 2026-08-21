import { describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 4 验收项（复审整改 P2-3）：stub 部署忽略快照、走 stub 路径。
 *
 * 设计 §6.1：`env.llm.provider === "stub"` → 忽略快照模型走 stub 路径
 * （stub 目录只有 stub 条目，无真实调用；工厂不接管 stub 构造，调用方在
 * stub 分支直接构造 stub provider，不经过工厂）。
 *
 * 因此工厂在 stub 环境下的正确行为是：**快照参数被忽略**——带快照调用与
 * 无参数调用行为完全一致（都走 env 路径；stub/未配置环境下 env 路径
 * fail-closed 抛错，绝不使用快照模型构造真实 provider）。
 */

const { factoryOptionsMock } = vi.hoisted(() => ({ factoryOptionsMock: vi.fn() }));

// stub 部署：provider="stub"，未配置任何真实模型
vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    demoMode: false,
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

// 不 mock 工厂：本测试验证真实工厂在 stub 环境下的行为
import {
  createTierAwareProviderFromEnv,
} from "../../../backend/src/runtime/llm/tier-aware-provider-factory.js";

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
  it("stub 环境 + 快照 → 忽略快照：与无参数调用行为完全一致", () => {
    const withSnapshot = () =>
      createTierAwareProviderFromEnv({ snapshotCapabilities: SNAPSHOT_CAPABILITIES });
    const withoutSnapshot = () => createTierAwareProviderFromEnv();

    // stub/未配置环境下 env 路径 fail-closed 抛错（LLM_SMART_MODEL 未配置），
    // 证明快照被忽略（若快照未被忽略，会走 registry 解析并抛快照相关错误）。
    const withSnapshotError = () => {
      try {
        withSnapshot();
        return null;
      } catch (error) {
        return error;
      }
    };
    const withoutSnapshotError = () => {
      try {
        withoutSnapshot();
        return null;
      } catch (error) {
        return error;
      }
    };

    const a = withSnapshotError();
    const b = withoutSnapshotError();
    // 两者都抛错（fail-closed）且错误同源（env 路径错误，非快照校验错误）
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(String((a as Error).message)).toBe(String((b as Error).message));
    expect(String((a as Error).message)).toContain("LLM_SMART_MODEL");
    expect(String((a as Error).message)).not.toContain("快照");
  });
});
