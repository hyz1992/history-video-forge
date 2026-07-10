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
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_STRUCTURED_BASE_URL",
  "OPENAI_STRUCTURED_API_KEY",
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

    const { getValidatedRuntimeEnv } = await import(
      "../../../backend/src/config/env.js"
    );

    expect(() => getValidatedRuntimeEnv()).toThrow(
      /LLM_BASE_URL|OPENAI_BASE_URL|LLM_API_KEY|OPENAI_API_KEY|LLM_MODEL|OPENAI_MODEL/u,
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
});
