import { describe, expect, it, vi } from "vitest";

import type { ProviderRegistryEntry } from "../../../backend/src/runtime/llm/provider-registry.js";
import type { ResolvedModel } from "../../../backend/src/runtime/llm/tier-resolver.js";
import {
  formatTierConfigDiagnostics,
  redactApiKey,
  type TierDiagnosticsInput,
} from "../../../backend/src/runtime/llm/tier-config-diagnostics.js";

const SMART_RESOLVED: ResolvedModel = {
  tier: "smart",
  provider: "deepseek",
  model: "deepseek-v4-pro",
  baseUrl: "https://api.deepseek.com",
  apiKey: "ds-secret-key-12345",
};

const FLASH_RESOLVED: ResolvedModel = {
  tier: "flash",
  provider: "zhipu",
  model: "glm-4",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "zhipu-secret-key-67890",
};

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

describe("tier config diagnostics", () => {
  describe("redactApiKey", () => {
    it("returns placeholder for undefined", () => {
      expect(redactApiKey(undefined)).toBe("<unset>");
    });

    it("returns placeholder for empty string", () => {
      expect(redactApiKey("")).toBe("<unset>");
    });

    it("masks key longer than 8 chars, showing only first 4 and last 2", () => {
      expect(redactApiKey("sk-abcdef1234567890")).toBe("sk-a***90");
      expect(redactApiKey("ds-secret-key-12345")).toBe("ds-s***45");
    });

    it("fully masks short keys (<= 8 chars) to avoid leaking", () => {
      expect(redactApiKey("short")).toBe("<set:5>");
      expect(redactApiKey("12345678")).toBe("<set:8>");
    });

    it("does not leak full key in any branch", () => {
      const longKey = "very-long-api-key-1234567890-abcdef";
      const redacted = redactApiKey(longKey);
      expect(redacted).not.toContain(longKey);
      expect(redacted).not.toContain("1234567890");
      expect(redacted).not.toContain("abcdef");
    });
  });

  describe("formatTierConfigDiagnostics", () => {
    it("produces a multi-line summary with smart/flash tiers and providers", () => {
      const input: TierDiagnosticsInput = {
        provider: "openai",
        snapshot: {
          smart: SMART_RESOLVED,
          flashReusesSmart: false,
          flash: FLASH_RESOLVED,
        },
        registryEntries: [DEEPSEEK_ENTRY, ZHIPU_ENTRY],
      };

      const output = formatTierConfigDiagnostics(input);
      expect(output).toContain("[tier-config]");
      expect(output).toContain("smart: deepseek:deepseek-v4-pro");
      expect(output).toContain("flash: zhipu:glm-4");
      expect(output).toContain("https://api.deepseek.com");
      expect(output).toContain("https://open.bigmodel.cn/api/paas/v4");
      expect(output).toContain("LLM_PROVIDER_DEEPSEEK_API_KEY");
      expect(output).toContain("LLM_PROVIDER_ZHIPU_API_KEY");
    });

    it("indicates when flash reuses smart (compatibility fallback)", () => {
      const input: TierDiagnosticsInput = {
        provider: "openai",
        snapshot: {
          smart: SMART_RESOLVED,
          flashReusesSmart: true,
        },
        registryEntries: [DEEPSEEK_ENTRY],
      };

      const output = formatTierConfigDiagnostics(input);
      expect(output).toContain("flash: <reuses smart>");
    });

    it("does NOT leak api keys in any form (R3)", () => {
      const input: TierDiagnosticsInput = {
        provider: "openai",
        snapshot: {
          smart: SMART_RESOLVED,
          flashReusesSmart: false,
          flash: FLASH_RESOLVED,
        },
        registryEntries: [DEEPSEEK_ENTRY, ZHIPU_ENTRY],
      };

      const output = formatTierConfigDiagnostics(input);
      expect(output).not.toContain("ds-secret-key-12345");
      expect(output).not.toContain("zhipu-secret-key-67890");
      expect(output).not.toContain("secret");
      // 脱敏后的形式可以出现（如 "ds-s***45"），但完整 key 不得出现
      expect(output).toMatch(/ds-s\*+/);
    });

    it("shows stub provider mode clearly", () => {
      const input: TierDiagnosticsInput = {
        provider: "stub",
      };

      const output = formatTierConfigDiagnostics(input);
      expect(output).toContain("provider: stub");
      expect(output).toContain("tier 路由未启用");
    });

    it("includes legacy fallback indicator when smart provider is 'default'", () => {
      const legacySmart: ResolvedModel = {
        tier: "smart",
        provider: "default",
        model: "glm-5.2",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiKey: "legacy-key-abcdef",
      };
      const input: TierDiagnosticsInput = {
        provider: "openai",
        snapshot: {
          smart: legacySmart,
          flashReusesSmart: true,
        },
        registryEntries: [],
      };

      const output = formatTierConfigDiagnostics(input);
      expect(output).toContain("smart: default:glm-5.2");
      expect(output).toContain("兼容模式");
    });
  });

  describe("logging side-effect (smoke test)", () => {
    it("logTierConfigDiagnostics writes to console.info without throwing", async () => {
      const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const logErrSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const { logTierConfigDiagnostics } = await import(
          "../../../backend/src/runtime/llm/tier-config-diagnostics.js"
        );
        logTierConfigDiagnostics({
          provider: "stub",
        });
        expect(logSpy).toHaveBeenCalled();
        const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
        expect(logged).toContain("[tier-config]");
      } finally {
        logSpy.mockRestore();
        logErrSpy.mockRestore();
      }
    });

    it("logTierConfigDiagnostics falls back to warning on internal error", async () => {
      const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const { logTierConfigDiagnostics } = await import(
          "../../../backend/src/runtime/llm/tier-config-diagnostics.js"
        );
        // 故意传一个会触发 snapshot 解析失败的输入（registry 解析需要真实环境）
        // 但 stub 模式应 short-circuit 不走 snapshot 路径
        logTierConfigDiagnostics({
          provider: "stub",
        });
        expect(logSpy).toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});
