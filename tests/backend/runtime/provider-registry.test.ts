import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_NAME,
  loadProviderRegistry,
  type ProviderRegistryEntry,
  type ProviderRegistryInput,
} from "../../../backend/src/runtime/llm/provider-registry.js";

function writeConfig(dir: string, content: unknown): string {
  const path = join(dir, "providers.json");
  writeFileSync(path, JSON.stringify(content, null, 2), "utf8");
  return path;
}

describe("provider registry loading", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "provider-registry-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("valid providers.json", () => {
    it("parses a valid config with multiple providers", () => {
      const path = writeConfig(tempDir, {
        providers: [
          { name: "deepseek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY" },
          { name: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "LLM_PROVIDER_ZHIPU_API_KEY" },
        ],
      });

      const registry = loadProviderRegistry({ configPath: path });

      expect(registry.size).toBe(2);
      expect(registry.get("deepseek")).toEqual({
        name: "deepseek",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY",
      });
      expect(registry.get("zhipu")).toEqual({
        name: "zhipu",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKeyEnv: "LLM_PROVIDER_ZHIPU_API_KEY",
      });
    });

    it("returns ProviderRegistryEntry shape with exactly name/baseUrl/apiKeyEnv", () => {
      const path = writeConfig(tempDir, {
        providers: [{ name: "p", baseUrl: "u", apiKeyEnv: "K" }],
      });
      const registry = loadProviderRegistry({ configPath: path });
      const entry = registry.get("p") as ProviderRegistryEntry;
      expect(Object.keys(entry).sort()).toEqual(["apiKeyEnv", "baseUrl", "name"]);
    });
  });

  describe("missing providers.json (fallback to single-provider mode)", () => {
    it("returns single-provider mode using envFallback", () => {
      const registry = loadProviderRegistry({
        configPath: join(tempDir, "nonexistent.json"),
        envFallback: { baseUrl: "https://fallback.example.com", apiKey: "fallback-key" },
      });

      expect(registry.size).toBe(1);
      expect(registry.get(DEFAULT_PROVIDER_NAME)).toEqual({
        name: DEFAULT_PROVIDER_NAME,
        baseUrl: "https://fallback.example.com",
        apiKeyEnv: null,
      });
    });

    it("uses default base url when envFallback baseUrl also missing", () => {
      const registry = loadProviderRegistry({
        configPath: join(tempDir, "nonexistent.json"),
        envFallback: { apiKey: "k" },
      });
      expect(registry.get(DEFAULT_PROVIDER_NAME)?.baseUrl).toBe("");
    });

    it("returns empty registry when both config and envFallback missing", () => {
      const registry = loadProviderRegistry({
        configPath: join(tempDir, "nonexistent.json"),
      });
      // No fallback provided -> cannot construct a usable provider; surface as empty
      expect(registry.size).toBe(0);
    });
  });

  describe("invalid providers.json", () => {
    it("throws when providers array is missing", () => {
      const path = writeConfig(tempDir, { foo: "bar" });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(
        /缺少 providers 数组字段/,
      );
    });

    it("throws when providers is empty array", () => {
      const path = writeConfig(tempDir, { providers: [] });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(
        /至少需要包含一个 provider/,
      );
    });

    it("throws when provider entry is missing name", () => {
      const path = writeConfig(tempDir, {
        providers: [{ baseUrl: "u", apiKeyEnv: "K" }],
      });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(/name/i);
    });

    it("throws when provider entry is missing baseUrl", () => {
      const path = writeConfig(tempDir, {
        providers: [{ name: "p", apiKeyEnv: "K" }],
      });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(/baseUrl/i);
    });

    it("throws when apiKeyEnv is empty string", () => {
      const path = writeConfig(tempDir, {
        providers: [{ name: "p", baseUrl: "u", apiKeyEnv: "" }],
      });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(/apiKeyEnv/i);
    });

    it("throws on duplicate provider names", () => {
      const path = writeConfig(tempDir, {
        providers: [
          { name: "dup", baseUrl: "u1", apiKeyEnv: "K1" },
          { name: "dup", baseUrl: "u2", apiKeyEnv: "K2" },
        ],
      });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(/duplicate/i);
    });

    it("throws on malformed JSON", () => {
      const path = join(tempDir, "providers.json");
      writeFileSync(path, "{ not valid json", "utf8");
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(/JSON/i);
    });
  });

  describe("env fallback with extra provider fields ignored", () => {
    it("ignores unknown fields in provider entries", () => {
      const path = writeConfig(tempDir, {
        providers: [
          {
            name: "p",
            baseUrl: "u",
            apiKeyEnv: "K",
            extraField: "ignored",
            another: 123,
          },
        ],
      });
      const registry = loadProviderRegistry({ configPath: path });
      const entry = registry.get("p") as ProviderRegistryEntry;
      expect(entry).toEqual({ name: "p", baseUrl: "u", apiKeyEnv: "K" });
    });
  });

  describe("apiKeyEnv null vs string", () => {
    it("provider entry apiKeyEnv must be a non-empty string", () => {
      const path = writeConfig(tempDir, {
        providers: [{ name: "p", baseUrl: "u", apiKeyEnv: 123 }],
      });
      expect(() => loadProviderRegistry({ configPath: path })).toThrowError(/apiKeyEnv/i);
    });
  });

  describe("registry input interface", () => {
    it("ProviderRegistryInput accepts configPath and optional envFallback", () => {
      const input: ProviderRegistryInput = {
        configPath: "/some/path.json",
        envFallback: { baseUrl: "u", apiKey: "k" },
      };
      expect(input.configPath).toBe("/some/path.json");
      expect(input.envFallback?.baseUrl).toBe("u");
    });
  });
});
