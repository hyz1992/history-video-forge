import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FACTORY_ENV_KEYS = [
  "LLM_SMART_MODEL",
  "LLM_FLASH_MODEL",
  "LLM_PROVIDERS_CONFIG_PATH",
  "LLM_PROVIDER_DEEPSEEK_API_KEY",
  "LLM_PROVIDER_ZHIPU_API_KEY",
  "LLM_PROVIDER_EXPLICIT_API_KEY",
  "LLM_PROVIDER_P_API_KEY",
  "LLM_MODEL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_PROVIDER",
  "NODE_ENV",
  "VITEST",
] as const;

const originalFactoryEnv = new Map<string, string | undefined>(
  FACTORY_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function resetFactoryEnv(): void {
  for (const key of FACTORY_ENV_KEYS) {
    const value = originalFactoryEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function writeProvidersFile(
  filePath: string,
  providers: ReadonlyArray<{
    name: string;
    baseUrl: string;
    apiKeyEnv: string;
  }>,
): void {
  writeFileSync(filePath, JSON.stringify({ providers }, null, 2), "utf8");
}

async function loadFactory() {
  // env.ts 在 import 时构建，测试改 process.env 后需要 resetModules 触发重建。
  vi.resetModules();
  return (await import(
    "../../../backend/src/runtime/llm/tier-aware-provider-factory.js"
  )) as typeof import("../../../backend/src/runtime/llm/tier-aware-provider-factory.js");
}

describe("tier-aware provider factory (env -> provider)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tier-factory-test-"));
    resetFactoryEnv();
    // 触发 env.ts 跳过 dotenv 加载的标记（与既有测试一致）
    process.env.NODE_ENV = "test";
    process.env.VITEST = "true";
    // factory 不接管 stub；测试中统一用 openai 标识
    process.env.LLM_PROVIDER = "openai";
  });

  afterEach(() => {
    resetFactoryEnv();
    vi.resetModules();
    vi.doUnmock("node:fs");
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("full tier routing configuration", () => {
    it("resolves snapshot with distinct smart/flash providers", async () => {
      const configPath = join(tempDir, "providers.json");
      writeProvidersFile(configPath, [
        {
          name: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY",
        },
        {
          name: "zhipu",
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          apiKeyEnv: "LLM_PROVIDER_ZHIPU_API_KEY",
        },
      ]);
      process.env.LLM_PROVIDERS_CONFIG_PATH = configPath;
      process.env.LLM_SMART_MODEL = "deepseek:deepseek-v4-pro";
      process.env.LLM_FLASH_MODEL = "zhipu:glm-4";
      process.env.LLM_PROVIDER_DEEPSEEK_API_KEY = "ds-key";
      process.env.LLM_PROVIDER_ZHIPU_API_KEY = "zhipu-key";

      const { resolveTierProviderSnapshot } = await loadFactory();
      const snapshot = resolveTierProviderSnapshot();

      expect(snapshot.flashReusesSmart).toBe(false);
      expect(snapshot.smart).toEqual({
        tier: "smart",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKey: "ds-key",
      });
      expect(snapshot.flash).toEqual({
        tier: "flash",
        provider: "zhipu",
        model: "glm-4",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "zhipu-key",
      });
    });
  });

  describe("compatibility fallback (design §4.4)", () => {
    it("falls back to LLM_MODEL when LLM_SMART_MODEL absent (single-provider mode)", async () => {
      process.env.LLM_PROVIDERS_CONFIG_PATH = join(tempDir, "nonexistent.json");
      delete process.env.LLM_SMART_MODEL;
      delete process.env.LLM_FLASH_MODEL;
      process.env.LLM_MODEL = "glm-5.2";
      process.env.LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
      process.env.LLM_API_KEY = "legacy-key";

      const { resolveTierProviderSnapshot } = await loadFactory();
      const snapshot = resolveTierProviderSnapshot();

      // smart 应回退到 default:LLM_MODEL，使用旧 LLM_BASE_URL/LLM_API_KEY
      expect(snapshot.smart).toEqual({
        tier: "smart",
        provider: "default",
        model: "glm-5.2",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "legacy-key",
      });
      // flash 未配置，复用 smart
      expect(snapshot.flashReusesSmart).toBe(true);
      expect(snapshot.flash).toBeUndefined();
    });

    it("flash tier reuses smart inner provider when LLM_FLASH_MODEL absent", async () => {
      const configPath = join(tempDir, "providers.json");
      writeProvidersFile(configPath, [
        {
          name: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY",
        },
      ]);
      process.env.LLM_PROVIDERS_CONFIG_PATH = configPath;
      process.env.LLM_SMART_MODEL = "deepseek:deepseek-v4-pro";
      delete process.env.LLM_FLASH_MODEL;
      process.env.LLM_PROVIDER_DEEPSEEK_API_KEY = "ds-key";

      const { resolveTierProviderSnapshot } = await loadFactory();
      const snapshot = resolveTierProviderSnapshot();
      expect(snapshot.flashReusesSmart).toBe(true);
      expect(snapshot.flash).toBeUndefined();
      expect(snapshot.smart.provider).toBe("deepseek");
    });

    it("throws when both LLM_SMART_MODEL and LLM_MODEL absent", async () => {
      process.env.LLM_PROVIDERS_CONFIG_PATH = join(tempDir, "nonexistent.json");
      delete process.env.LLM_SMART_MODEL;
      delete process.env.LLM_FLASH_MODEL;
      delete process.env.LLM_MODEL;
      process.env.LLM_BASE_URL = "https://example.com";
      process.env.LLM_API_KEY = "k";

      const { resolveTierProviderSnapshot } = await loadFactory();
      expect(() => resolveTierProviderSnapshot()).toThrowError(
        /LLM_SMART_MODEL|LLM_MODEL|smart tier/i,
      );
    });

    it("honors explicit LLM_PROVIDERS_CONFIG_PATH over default path", async () => {
      // 验证显式路径生效：写入 explicit.json 并设为 LLM_PROVIDERS_CONFIG_PATH
      const explicitPath = join(tempDir, "explicit.json");
      writeFileSync(
        explicitPath,
        JSON.stringify({
          providers: [
            {
              name: "explicit",
              baseUrl: "https://explicit.example.com",
              apiKeyEnv: "LLM_PROVIDER_EXPLICIT_API_KEY",
            },
          ],
        }),
        "utf8",
      );
      process.env.LLM_PROVIDERS_CONFIG_PATH = explicitPath;
      process.env.LLM_SMART_MODEL = "explicit:m";
      process.env.LLM_PROVIDER_EXPLICIT_API_KEY = "explicit-key";

      const { resolveTierProviderSnapshot } = await loadFactory();
      const snapshot = resolveTierProviderSnapshot();
      expect(snapshot.smart.provider).toBe("explicit");
      expect(snapshot.smart.baseUrl).toBe("https://explicit.example.com");
    });
  });

  describe("provider construction (createTierAwareProviderFromEnv)", () => {
    it("constructs tier-aware provider from full configuration without throwing", async () => {
      const configPath = join(tempDir, "providers.json");
      writeProvidersFile(configPath, [
        {
          name: "deepseek",
          baseUrl: "https://api.deepseek.com",
          apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY",
        },
      ]);
      process.env.LLM_PROVIDERS_CONFIG_PATH = configPath;
      process.env.LLM_SMART_MODEL = "deepseek:m";
      process.env.LLM_PROVIDER_DEEPSEEK_API_KEY = "ds-key";

      const { createTierAwareProviderFromEnv } = await loadFactory();
      const provider = createTierAwareProviderFromEnv();
      expect(provider).toBeDefined();
      expect(provider.capabilities).toBeDefined();
      expect(typeof provider.invokeStructuredPrompt).toBe("function");
    });

    it("constructs provider in legacy single-provider mode without throwing", async () => {
      process.env.LLM_PROVIDERS_CONFIG_PATH = join(tempDir, "nonexistent.json");
      delete process.env.LLM_SMART_MODEL;
      delete process.env.LLM_FLASH_MODEL;
      process.env.LLM_MODEL = "glm-5.2";
      process.env.LLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
      process.env.LLM_API_KEY = "legacy-key";

      const { createTierAwareProviderFromEnv } = await loadFactory();
      const provider = createTierAwareProviderFromEnv();
      expect(provider).toBeDefined();
    });
  });
});
