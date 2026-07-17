import { describe, expect, it } from "vitest";

import {
  resolveTierModel,
  TierResolverError,
  type ResolvedModel,
  type TierResolverInput,
} from "../../../backend/src/runtime/llm/tier-resolver.js";
import type { ProviderRegistryEntry } from "../../../backend/src/runtime/llm/provider-registry.js";

function buildRegistry(
  entries: ReadonlyArray<ProviderRegistryEntry>,
): Map<string, ProviderRegistryEntry> {
  return new Map(entries.map((e) => [e.name, e]));
}

const DEEPSEEK_ENTRY: ProviderRegistryEntry = {
  name: "deepseek",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY",
};

const ZHIPU_ENTRY: ProviderRegistryEntry = {
  name: "zhipu",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyEnv: "LLM_PROVIDER_ZHIPU_API_KEY",
};

const DEFAULT_ENTRY: ProviderRegistryEntry = {
  name: "default",
  baseUrl: "https://fallback.example.com",
  apiKeyEnv: null,
};

describe("tier resolver", () => {
  describe("valid tier model resolution", () => {
    it("resolves smart tier with provider:model format", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      const env: Record<string, string | undefined> = {
        LLM_PROVIDER_DEEPSEEK_API_KEY: "ds-key",
      };
      const result = resolveTierModel({
        tier: "smart",
        tierModelRaw: "deepseek:deepseek-v4-pro",
        registry,
        env,
      });

      expect(result).toEqual({
        tier: "smart",
        provider: "deepseek",
        model: "deepseek-v4-pro",
        baseUrl: "https://api.deepseek.com",
        apiKey: "ds-key",
      } satisfies ResolvedModel);
    });

    it("resolves flash tier independently from smart", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY, ZHIPU_ENTRY]);
      const env: Record<string, string | undefined> = {
        LLM_PROVIDER_DEEPSEEK_API_KEY: "ds-key",
        LLM_PROVIDER_ZHIPU_API_KEY: "zhipu-key",
      };
      const result = resolveTierModel({
        tier: "flash",
        tierModelRaw: "zhipu:glm-4",
        registry,
        env,
      });

      expect(result).toEqual({
        tier: "flash",
        provider: "zhipu",
        model: "glm-4",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "zhipu-key",
      });
    });
  });

  describe("provider:model format validation", () => {
    it("throws on missing colon", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "deepseek-no-colon",
          registry,
          env: {},
        }),
      ).toThrowError(TierResolverError);
    });

    it("throws on empty string", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "",
          registry,
          env: {},
        }),
      ).toThrowError(TierResolverError);
    });

    it("throws on multiple colons", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "deepseek:model:extra",
          registry,
          env: {},
        }),
      ).toThrowError(/格式|format|colon/i);
    });

    it("throws on empty provider name", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: ":model",
          registry,
          env: {},
        }),
      ).toThrowError(TierResolverError);
    });

    it("throws on empty model name", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "deepseek:",
          registry,
          env: {},
        }),
      ).toThrowError(TierResolverError);
    });
  });

  describe("provider not registered", () => {
    it("throws when provider not in registry", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "unknown-provider:some-model",
          registry,
          env: {},
        }),
      ).toThrowError(/provider_not_registered|未注册/);
    });
  });

  describe("api key resolution", () => {
    it("resolves api key from env via apiKeyEnv when key present", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      const result = resolveTierModel({
        tier: "smart",
        tierModelRaw: "deepseek:m",
        registry,
        env: { LLM_PROVIDER_DEEPSEEK_API_KEY: "the-key" },
      });
      expect(result.apiKey).toBe("the-key");
    });

    it("throws when apiKeyEnv references missing env variable", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "deepseek:m",
          registry,
          env: {},
        }),
      ).toThrowError(/api_key_missing|未设置|apiKey/i);
    });

    it("uses fallbackApiKey when provider entry has null apiKeyEnv (default provider mode)", () => {
      const registry = buildRegistry([DEFAULT_ENTRY]);
      const result = resolveTierModel({
        tier: "smart",
        tierModelRaw: "default:m",
        registry,
        env: {},
        fallbackApiKey: "fallback-key",
      });
      expect(result.apiKey).toBe("fallback-key");
    });

    it("throws when default provider mode has no fallbackApiKey", () => {
      const registry = buildRegistry([DEFAULT_ENTRY]);
      expect(() =>
        resolveTierModel({
          tier: "smart",
          tierModelRaw: "default:m",
          registry,
          env: {},
        }),
      ).toThrowError(/api_key_missing|未设置|fallback/i);
    });
  });

  describe("ResolvedModel shape", () => {
    it("includes tier/provider/model/baseUrl/apiKey fields exactly", () => {
      const registry = buildRegistry([DEEPSEEK_ENTRY]);
      const result = resolveTierModel({
        tier: "smart",
        tierModelRaw: "deepseek:m",
        registry,
        env: { LLM_PROVIDER_DEEPSEEK_API_KEY: "k" },
      });
      expect(Object.keys(result).sort()).toEqual([
        "apiKey",
        "baseUrl",
        "model",
        "provider",
        "tier",
      ]);
    });
  });

  describe("TierResolverInput interface", () => {
    it("accepts tier/tierModelRaw/registry/env with optional fallbackApiKey", () => {
      const input: TierResolverInput = {
        tier: "smart",
        tierModelRaw: "deepseek:m",
        registry: buildRegistry([DEEPSEEK_ENTRY]),
        env: { LLM_PROVIDER_DEEPSEEK_API_KEY: "k" },
        fallbackApiKey: "fallback",
      };
      expect(input.tier).toBe("smart");
      expect(input.fallbackApiKey).toBe("fallback");
    });
  });
});
