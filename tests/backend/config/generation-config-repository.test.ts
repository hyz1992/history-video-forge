import { describe, expect, it } from "vitest";

import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import {
  getUserGenerationPreference,
  upsertUserGenerationPreference,
  getProjectGenerationConfiguration,
  upsertProjectGenerationConfiguration,
  listPublicGenerationCapabilities,
} from "../../../backend/src/modules/generation-config/generation-config.repository.js";

/**
 * S2-2A 任务 3 整改：repository 测试。
 * P1-1：upsert 改 async + CAS。
 * P1-3：S2-2A scope 校验（拒绝 creative/fixed）。
 */
describe("generation-config repository", () => {
  describe("user generation preference", () => {
    it("returns null when no preference exists", () => {
      const db = createDbClient();
      expect(getUserGenerationPreference(db, "u1")).toBeNull();
    });

    it("creates and reads a preference with revision 1", async () => {
      const db = createDbClient();
      const result = await upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "all_api_video", api_quality: "high_1080p" } },
      }, "u1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(1);
      expect(result.value.updatedAt).toBeInstanceOf(Date);

      const pref = getUserGenerationPreference(db, "u1");
      expect(pref?.revision).toBe(1);
      expect(pref?.configuration.video.strategy).toBe("all_api_video");
    });

    it("updates preference with correct expected_revision", async () => {
      const db = createDbClient();
      await upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      }, "u1");
      const result = await upsertUserGenerationPreference(db, "u1", {
        expected_revision: 1,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "prefer_api_video", api_quality: "standard_720p" } },
      }, "u1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
      expect(result.value.configuration.video.strategy).toBe("prefer_api_video");
    });

    it("rejects update with stale expected_revision (conflict)", async () => {
      const db = createDbClient();
      await upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      }, "u1");
      const result = await upsertUserGenerationPreference(db, "u1", {
        expected_revision: 99,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      }, "u1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("generation_preference_revision_conflict");
      const pref = getUserGenerationPreference(db, "u1");
      expect(pref?.revision).toBe(1);
    });

    it("rejects creative fields in S2-2A scope (P1-3)", async () => {
      const db = createDbClient();
      const result = await upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: {
          ...DEFAULT_GENERATION_CONFIGURATION,
          creative: { voice_profile_id: "voice-1", art_style_preset_id: null, subtitle_style_preset_id: null },
        },
      }, "u1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("configuration_invalid_s2_2a_scope");
    });

    it("rejects fixed capability in S2-2A scope (P1-3)", async () => {
      const db = createDbClient();
      const result = await upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: {
          ...DEFAULT_GENERATION_CONFIGURATION,
          capabilities: {
            ...DEFAULT_GENERATION_CONFIGURATION.capabilities,
            "llm.smart": { mode: "fixed", provider_model_id: "attacker" },
          },
        },
      }, "u1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("configuration_invalid_s2_2a_scope");
    });
  });

  describe("project generation configuration", () => {
    it("returns backfilled_default for project without configuration", () => {
      const db = createDbClient();
      const result = getProjectGenerationConfiguration(db, "p1");
      expect(result.source).toBe("backfilled_default");
      expect(result.configuration).toEqual(DEFAULT_GENERATION_CONFIGURATION);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(result.diff_from_user_default).toBeNull();
    });

    it("updates project configuration with correct expected_revision", async () => {
      const db = createDbClient();
      getProjectGenerationConfiguration(db, "p1");
      const result = await upsertProjectGenerationConfiguration(db, "p1", {
        expected_revision: 1,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "all_remotion", api_quality: "standard_720p" } },
      }, "u1");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
      expect(result.value.invalidation_preview).toBeDefined();
    });

    it("rejects project config update with stale revision", async () => {
      const db = createDbClient();
      getProjectGenerationConfiguration(db, "p1");
      const result = await upsertProjectGenerationConfiguration(db, "p1", {
        expected_revision: 99,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      }, "u1");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("project_generation_configuration_revision_conflict");
    });
  });

  describe("public generation capabilities catalog", () => {
    it("returns only active entries with provider/model/parameter/availability (P2-2)", () => {
      const db = createDbClient();
      db.providerModelCatalog.set("llm.smart.test", {
        id: "llm.smart.test",
        capability: "llm.smart",
        providerKey: "deepseek",
        modelId: "deepseek-v4-pro",
        modelVersion: "v1",
        displayName: "DeepSeek V4 Pro",
        qualityTier: "high",
        speedTier: "slow",
        parameterCapabilitiesJson: { thinking: true },
        pricingVersion: "v1",
        pricingJson: { bounded: false },
        status: "active",
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const entries = listPublicGenerationCapabilities(db);
      expect(entries).toHaveLength(1);
      const e = entries[0]!;
      // P2-2：补齐公开目录字段
      expect(e.provider_key).toBe("deepseek");
      expect(e.model_id).toBe("deepseek-v4-pro");
      expect(e.model_version).toBe("v1");
      expect(e.parameter_capabilities).toEqual({ thinking: true });
      expect(e.availability).toBe("enabled");
      expect(e.is_default).toBe(true);
      // 不泄露凭据
      expect(e).not.toHaveProperty("api_key");
      expect(e).not.toHaveProperty("apiKeyEnv");
    });
  });
});
