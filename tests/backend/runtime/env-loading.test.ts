import { afterEach, describe, expect, it, vi } from "vitest";

const RUNTIME_ENV_KEYS = [
  "NODE_ENV",
  "SERVER_HOST",
  "ALLOW_UNAUTHENTICATED_REMOTE",
  "DATABASE_URL",
  "PROMPT_ASSETS_DIR",
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_STRUCTURED_BASE_URL",
  "LLM_STRUCTURED_API_KEY",
  "LLM_STRUCTURED_MODEL",
  "LLM_STRUCTURED_STRATEGY",
  "LLM_STRUCTURED_THINKING",
  "LLM_STRUCTURED_TEMPERATURE",
  "LLM_STRUCTURED_TOP_P",
  "LLM_STRUCTURED_MAX_TOKENS",
  "LLM_TIMEOUT_MS",
  "LLM_REQUEST_BUDGET_MAX_REQUESTS",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_STRUCTURED_BASE_URL",
  "OPENAI_STRUCTURED_API_KEY",
  // S2-1 Task 5：新增 tier 路由相关变量
  "LLM_SMART_MODEL",
  "LLM_FLASH_MODEL",
  "LLM_PROVIDERS_CONFIG_PATH",
] as const;

const originalEnv = new Map<string, string | undefined>(
  RUNTIME_ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  vi.resetModules();
  vi.unmock("node:fs");
  for (const key of RUNTIME_ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("runtime env loading", () => {
  it("reads explicit LLM_* variables for runtime configuration", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://llm.example.test/v1";
    process.env.LLM_API_KEY = "llm-key";
    process.env.LLM_MODEL = "glm-4.5";
    process.env.LLM_STRUCTURED_BASE_URL = "https://structured.example.test/v1";
    process.env.LLM_STRUCTURED_API_KEY = "structured-key";
    process.env.LLM_STRUCTURED_MODEL = "glm-4.5-structured";
    process.env.LLM_STRUCTURED_STRATEGY = "tool_call";
    process.env.LLM_STRUCTURED_THINKING = "disabled";
    process.env.LLM_STRUCTURED_TEMPERATURE = "0.5";
    process.env.LLM_STRUCTURED_TOP_P = "0.9";
    process.env.LLM_STRUCTURED_MAX_TOKENS = "2048";
    process.env.LLM_TIMEOUT_MS = "32000";
    process.env.LLM_REQUEST_BUDGET_MAX_REQUESTS = "2";

    const { env } = await import("../../../backend/src/config/env.js");

    expect(env.llm).toMatchObject({
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "llm-key",
      model: "glm-4.5",
      structuredBaseUrl: "https://structured.example.test/v1",
      structuredApiKey: "structured-key",
      structuredModel: "glm-4.5-structured",
      structuredStrategy: "tool_call",
      structuredThinking: "disabled",
      structuredTemperature: 0.5,
      structuredTopP: 0.9,
      structuredMaxTokens: 2048,
      timeoutMs: 32000,
      requestBudgetMaxRequests: 2,
    });
  });

  it("falls back to OPENAI_* variables when LLM_* variables are absent", async () => {
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_STRUCTURED_MODEL;
    process.env.OPENAI_BASE_URL = "https://openai-compatible.example.test/v1";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENAI_MODEL = "glm-4.5";

    const { env } = await import("../../../backend/src/config/env.js");

    expect(env.llm.baseUrl).toBe("https://openai-compatible.example.test/v1");
    expect(env.llm.apiKey).toBe("openai-key");
    expect(env.llm.model).toBe("glm-4.5");
    expect(env.llm.structuredModel).toBe("glm-4.5");
    expect(env.llm.structuredStrategy).toBe("json_object");
    expect(env.llm.structuredThinking).toBeUndefined();
    expect(env.llm.structuredTemperature).toBeUndefined();
    expect(env.llm.structuredTopP).toBeUndefined();
    expect(env.llm.structuredMaxTokens).toBeUndefined();
  });

  it("uses GLM-5.1 strict structured defaults when only the structured model is configured", async () => {
    process.env.LLM_MODEL = "glm-5.1";
    process.env.LLM_STRUCTURED_MODEL = "glm-5.1";
    delete process.env.LLM_STRUCTURED_STRATEGY;
    delete process.env.LLM_STRUCTURED_THINKING;
    delete process.env.LLM_STRUCTURED_TEMPERATURE;
    delete process.env.LLM_STRUCTURED_TOP_P;
    delete process.env.LLM_STRUCTURED_MAX_TOKENS;

    const { env } = await import("../../../backend/src/config/env.js");

    expect(env.llm.structuredStrategy).toBe("tool_call");
    expect(env.llm.structuredThinking).toBe("disabled");
    expect(env.llm.structuredTemperature).toBe(0.5);
    expect(env.llm.structuredTopP).toBe(0.9);
    expect(env.llm.structuredMaxTokens).toBe(2048);
  });

  it("lets explicit strict structured env values override GLM-5.1 defaults", async () => {
    process.env.LLM_STRUCTURED_MODEL = "glm-5.1";
    process.env.LLM_STRUCTURED_STRATEGY = "json_object";
    process.env.LLM_STRUCTURED_THINKING = "enabled";
    process.env.LLM_STRUCTURED_TEMPERATURE = "0.2";
    process.env.LLM_STRUCTURED_TOP_P = "0.7";
    process.env.LLM_STRUCTURED_MAX_TOKENS = "1024";

    const { env } = await import("../../../backend/src/config/env.js");

    expect(env.llm.structuredStrategy).toBe("json_object");
    expect(env.llm.structuredThinking).toBe("enabled");
    expect(env.llm.structuredTemperature).toBe(0.2);
    expect(env.llm.structuredTopP).toBe(0.7);
    expect(env.llm.structuredMaxTokens).toBe(1024);
  });

  it("exposes a clear guard for missing real-provider runtime configuration", async () => {
    process.env.LLM_PROVIDER = "openai";
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.LLM_SMART_MODEL;

    const { getValidatedRuntimeEnv } = await import(
      "../../../backend/src/config/env.js"
    );

    expect(() => getValidatedRuntimeEnv()).toThrow(
      /LLM_BASE_URL|OPENAI_BASE_URL|LLM_API_KEY|OPENAI_API_KEY|LLM_MODEL|OPENAI_MODEL/u,
    );
  });

  it("passes validation when only S2-1 LLM_SMART_MODEL is configured (audit P1-2)", async () => {
    // 复现审查 P1-2：纯 S2-1 配置（无 LLM_BASE_URL/API_KEY/MODEL）下，
    // getValidatedRuntimeEnv 不应拦截主链路。factory 解析由后续步骤负责。
    process.env.LLM_PROVIDER = "openai";
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    process.env.LLM_SMART_MODEL = "deepseek:deepseek-v4-pro";

    const { getValidatedRuntimeEnv } = await import(
      "../../../backend/src/config/env.js"
    );

    expect(() => getValidatedRuntimeEnv()).not.toThrow();
  });

  it("still requires legacy LLM_* when neither S2-1 nor legacy is configured", async () => {
    process.env.LLM_PROVIDER = "openai";
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_SMART_MODEL;

    const { getValidatedRuntimeEnv } = await import(
      "../../../backend/src/config/env.js"
    );

    expect(() => getValidatedRuntimeEnv()).toThrow(
      /LLM_SMART_MODEL|providers\.json/u,
    );
  });

  it("does not read local .env files while running under test", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_MODEL;

    vi.doMock("node:fs", () => ({
      existsSync: () => true,
      readFileSync: () =>
        "LLM_PROVIDER=openai\nLLM_BASE_URL=https://real.example.test/v1\nLLM_API_KEY=real-key\nLLM_MODEL=real-model",
    }));

    const { env } = await import("../../../backend/src/config/env.js");

    expect(env.llm.provider).toBe("stub");
    expect(env.llm.baseUrl).toBeUndefined();
    expect(env.llm.apiKey).toBeUndefined();
    expect(env.llm.model).toBe("stub-model");
  });

  it("defaults remote binding opt-in to false", async () => {
    delete process.env.ALLOW_UNAUTHENTICATED_REMOTE;
    const { env } = await import("../../../backend/src/config/env.js");
    expect(env.allowUnauthenticatedRemote).toBe(false);
  });

  it("exposes a redacted llm config snapshot without leaking api keys or full base url", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    process.env.LLM_API_KEY = "secret-key-12345";
    process.env.LLM_MODEL = "glm-5.1";
    process.env.LLM_STRUCTURED_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    process.env.LLM_STRUCTURED_API_KEY = "structured-secret";
    process.env.LLM_STRUCTURED_MODEL = "glm-4";
    process.env.LLM_STRUCTURED_STRATEGY = "tool_call";

    const { getRedactedLlmConfigSnapshot } = await import(
      "../../../backend/src/config/env.js"
    );

    // structured profile -> structured model + structured strategy
    const structuredSnapshot = getRedactedLlmConfigSnapshot("structured");
    expect(Object.keys(structuredSnapshot).sort()).toEqual(
      ["model", "operationPolicy", "profile", "strategy"].sort(),
    );
    expect(structuredSnapshot.profile).toBe("structured");
    expect(structuredSnapshot.model).toBe("glm-4");
    expect(structuredSnapshot.strategy).toBe("tool_call");
    expect(structuredSnapshot.operationPolicy).toBeDefined();

    // main profile -> main model + json_object strategy
    const mainSnapshot = getRedactedLlmConfigSnapshot("main");
    expect(mainSnapshot.profile).toBe("main");
    expect(mainSnapshot.model).toBe("glm-5.1");
    expect(mainSnapshot.strategy).toBe("json_object");

    // 不泄漏密钥或完整 base URL
    const serialized = JSON.stringify(structuredSnapshot) + JSON.stringify(mainSnapshot);
    expect(serialized).not.toContain("secret-key-12345");
    expect(serialized).not.toContain("structured-secret");
    expect(serialized).not.toContain("open.bigmodel.cn");
  });

  // S2-1 Task 5：新增 tier 路由变量读取。
  // 注意：本层只做原值读取，不在这里做"LLM_SMART_MODEL 缺失→回退 LLM_MODEL"
  // 或"LLM_FLASH_MODEL 缺失→回退 smart tier"的回退组装——
  // 跨字段回退需要 smart 已解析，属 gateway 层职责（Task 4）。
  describe("S2-1 tier routing variables", () => {
    it("reads LLM_SMART_MODEL / LLM_FLASH_MODEL / LLM_PROVIDERS_CONFIG_PATH when set", async () => {
      process.env.LLM_SMART_MODEL = "deepseek:deepseek-v4-pro";
      process.env.LLM_FLASH_MODEL = "zhipu:glm-4";
      process.env.LLM_PROVIDERS_CONFIG_PATH = "/etc/app/providers.json";

      const { env } = await import("../../../backend/src/config/env.js");

      expect(env.llm.smartModel).toBe("deepseek:deepseek-v4-pro");
      expect(env.llm.flashModel).toBe("zhipu:glm-4");
      expect(env.llm.providersConfigPath).toBe("/etc/app/providers.json");
    });

    it("returns undefined for tier routing variables when not set (fallback is gateway-layer concern)", async () => {
      delete process.env.LLM_SMART_MODEL;
      delete process.env.LLM_FLASH_MODEL;
      delete process.env.LLM_PROVIDERS_CONFIG_PATH;

      const { env } = await import("../../../backend/src/config/env.js");

      // env 层只读原值，缺失即 undefined；回退到 LLM_MODEL / smart tier 由 gateway 层组装。
      expect(env.llm.smartModel).toBeUndefined();
      expect(env.llm.flashModel).toBeUndefined();
      expect(env.llm.providersConfigPath).toBeUndefined();
    });

    it("defaults providersConfigPath to backend/providers.json when LLM_PROVIDERS_CONFIG_PATH not set", async () => {
      // 当 Task 6 引入 providers.json 示例后，缺省路径应指向 backend/providers.json。
      // 但 S2-1 Task 5 阶段：env 层不主动注入默认路径（避免与 stub 模式冲突），
      // 而是返回 undefined，由 gateway 层决定是否使用默认路径。
      // 此测试断言"env 层不主动注入默认路径"，避免 env 层与 gateway 层职责混淆。
      delete process.env.LLM_PROVIDERS_CONFIG_PATH;

      const { env } = await import("../../../backend/src/config/env.js");

      expect(env.llm.providersConfigPath).toBeUndefined();
    });

    it("keeps legacy LLM_MODEL / LLM_STRUCTURED_MODEL readable for compatibility period", async () => {
      // S2-1 验收标准 §10.5：删除 LLM_SMART_MODEL 时 smart tier 回退到 LLM_MODEL 必须仍能工作。
      // env 层只负责保留旧字段读取，回退组装在 gateway。
      process.env.LLM_MODEL = "glm-5.2";
      process.env.LLM_STRUCTURED_MODEL = "glm-4";
      delete process.env.LLM_SMART_MODEL;
      delete process.env.LLM_FLASH_MODEL;

      const { env } = await import("../../../backend/src/config/env.js");

      expect(env.llm.model).toBe("glm-5.2");
      expect(env.llm.structuredModel).toBe("glm-4");
      expect(env.llm.smartModel).toBeUndefined();
      expect(env.llm.flashModel).toBeUndefined();
    });

    it("reads empty string as undefined for tier routing variables (treats empty as unset)", async () => {
      // .env 文件可能写入 LLM_SMART_MODEL=（空值），env 层应视为未设置，
      // 避免 tier-resolver 收到空字符串后在解析时报"env 值为空"错。
      process.env.LLM_SMART_MODEL = "";
      process.env.LLM_FLASH_MODEL = "";

      const { env } = await import("../../../backend/src/config/env.js");

      expect(env.llm.smartModel).toBeUndefined();
      expect(env.llm.flashModel).toBeUndefined();
    });

    it("does not leak tier routing provider names into redacted snapshot (S2-1 §8 R3)", async () => {
      // 防御性测试：redacted snapshot 当前不含 tier 字段；若未来扩展误把 provider 名带进去，
      // 也必须确保不含 api key。
      process.env.LLM_SMART_MODEL = "deepseek:deepseek-v4-pro";
      process.env.LLM_FLASH_MODEL = "zhipu:glm-4";
      process.env.LLM_PROVIDER_DEEPSEEK_API_KEY = "ds-secret-key";
      process.env.LLM_PROVIDER_ZHIPU_API_KEY = "zhipu-secret-key";
      process.env.LLM_MODEL = "glm-5.1";
      process.env.LLM_STRUCTURED_MODEL = "glm-4";

      const { getRedactedLlmConfigSnapshot } = await import(
        "../../../backend/src/config/env.js"
      );

      const snapshot = getRedactedLlmConfigSnapshot("structured");
      const serialized = JSON.stringify(snapshot);
      expect(serialized).not.toContain("ds-secret-key");
      expect(serialized).not.toContain("zhipu-secret-key");
    });
  });
});
