import { afterEach, describe, expect, it, vi } from "vitest";

const RUNTIME_ENV_KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "PROMPT_ASSETS_DIR",
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_STRUCTURED_MODEL",
  "LLM_TIMEOUT_MS",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
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
    process.env.LLM_STRUCTURED_MODEL = "glm-4.5-structured";
    process.env.LLM_TIMEOUT_MS = "32000";

    const { env } = await import("../../../backend/src/config/env.js");

    expect(env.llm).toMatchObject({
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "llm-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5-structured",
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
});
