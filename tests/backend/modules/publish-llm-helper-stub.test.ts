import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STUB_GATEWAY_ENV_KEYS = [
  "LLM_PROVIDER",
  "LLM_SMART_MODEL",
  "LLM_FLASH_MODEL",
  "LLM_MODEL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "NODE_ENV",
  "VITEST",
] as const;

const originalStubEnv = new Map<string, string | undefined>(
  STUB_GATEWAY_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function resetStubEnv(): void {
  for (const key of STUB_GATEWAY_ENV_KEYS) {
    const value = originalStubEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadPublishHelper() {
  vi.resetModules();
  return (await import(
    "../../../backend/src/modules/publish/llm-helper.js"
  )) as typeof import("../../../backend/src/modules/publish/llm-helper.js");
}

describe("publish llm-helper stub branch (audit P1-3)", () => {
  beforeEach(() => {
    resetStubEnv();
    process.env.NODE_ENV = "test";
    process.env.VITEST = "true";
  });

  afterEach(() => {
    resetStubEnv();
    vi.resetModules();
  });

  it("does not call createTierAwareProviderFromEnv when LLM_PROVIDER=stub", async () => {
    // 复现审查 P1-3：stub 模式下 getPublishLlmGateway 不应触发 factory。
    // 监视 factory 是否被加载——若被加载说明 stub 分支失效。
    process.env.LLM_PROVIDER = "stub";
    delete process.env.LLM_SMART_MODEL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_API_KEY;

    // mock factory 抛错——如果 stub 分支正确，这个 mock 永不会被调用
    const factorySpy = vi.fn(() => {
      throw new Error("factory_should_not_be_called_in_stub_mode");
    });
    vi.doMock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
      createTierAwareProviderFromEnv: factorySpy,
    }));

    const { getPublishLlmGateway } = await loadPublishHelper();
    const gateway = getPublishLlmGateway();

    expect(factorySpy).not.toHaveBeenCalled();
    // stub gateway 调用应抛 publish_stub_not_supported（不抛 factory 错误）
    await expect(gateway.invokeStructuredPrompt({} as never)).rejects.toThrow(
      /publish_stub_not_supported/,
    );
  });

  it("returns a gateway whose invoke methods throw publish_stub_not_supported in stub mode", async () => {
    process.env.LLM_PROVIDER = "stub";

    const { getPublishLlmGateway } = await loadPublishHelper();
    const gateway = getPublishLlmGateway();

    await expect(gateway.invokeStructuredPrompt({} as never)).rejects.toThrow(
      /publish_stub_not_supported/,
    );
    await expect(gateway.invokeStrictStructured({} as never)).rejects.toThrow(
      /publish_stub_not_supported/,
    );
  });

  it("caches the stub gateway (second call returns same instance)", async () => {
    process.env.LLM_PROVIDER = "stub";

    const { getPublishLlmGateway } = await loadPublishHelper();
    const g1 = getPublishLlmGateway();
    const g2 = getPublishLlmGateway();
    expect(g1).toBe(g2);
  });
});
