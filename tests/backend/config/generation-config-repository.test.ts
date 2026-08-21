import { describe, expect, it } from "vitest";

import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import type {
  ProjectGenerationConfigurationRecord,
  UserGenerationPreferenceRecord,
} from "../../../backend/src/db/client.js";
import {
  getUserGenerationPreference,
  upsertUserGenerationPreference,
  getOrBackfillUserGenerationPreference,
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

    it("S2-2B：creative 字段开放（音色/画风/字幕可保存）", async () => {
      const db = createDbClient();
      const result = await upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: {
          ...DEFAULT_GENERATION_CONFIGURATION,
          creative: {
            voice_profile_id: "voice-1",
            art_style_preset_id: "art_style_classical_ink",
            subtitle_style_preset_id: "subtitle_style_bold_stroke",
            subtitle_style_overrides: { font_size_px: 52 },
          },
        },
      }, "u1");
      expect(result.ok).toBe(true);
    });

    it("rejects fixed capability in S2-2B scope（capabilities 仍必须全 auto）", async () => {
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
      expect(result.error.code).toBe("configuration_invalid_s2_2b_scope");
    });
  });

  describe("project generation configuration", () => {
    it("returns backfilled_default for project without configuration", async () => {
      const db = createDbClient();
      const result = await getProjectGenerationConfiguration(db, "p1");
      expect(result.source).toBe("backfilled_default");
      expect(result.configuration).toEqual(DEFAULT_GENERATION_CONFIGURATION);
      expect(result.updatedAt).toBeInstanceOf(Date);
      // P2-1：无偏好记录时隐式默认就是 DEFAULT，backfill 的配置与默认一致 → 空 diff（非 null）
      expect(result.diff_from_user_default).toEqual({});
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

    // P2-1 回归：用户无持久化偏好时，隐式默认是 DEFAULT；项目改成 all_api_video 后
    // GET 的 diff 与 invalidation_preview 必须正确（不能返回 null/none）。
    it("computes diff against implicit DEFAULT when user has no persisted preference", async () => {
      const db = createDbClient();
      // 用户 u1 无偏好记录；项目 p1 改为 all_api_video
      await getProjectGenerationConfiguration(db, "p1", "u1");
      const patch = await upsertProjectGenerationConfiguration(db, "p1", {
        expected_revision: 1,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "all_api_video", api_quality: "standard_720p" } },
      }, "u1");
      expect(patch.ok).toBe(true);
      if (!patch.ok) return;
      // PATCH 成功响应的 diff 非空（与隐式默认 prefer_remotion 不同）
      expect(patch.value.diff_from_user_default).not.toEqual({});
      expect(patch.value.diff_from_user_default).toHaveProperty("video");

      // 随后 GET 的 diff 与 preview 一致
      const read = await getProjectGenerationConfiguration(db, "p1", "u1");
      expect(read.diff_from_user_default).toHaveProperty("video");
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

  describe("concurrent backfill losers (P1)", () => {
    it("user preference concurrent loser returns stored from existingRecord instead of failing", async () => {
      const db = createDbClient();
      // 模拟另一请求已并发创建的数据库记录（winner 的结果）
      const winnerRecord: UserGenerationPreferenceRecord = {
        id: "winner-id",
        userId: "u1",
        schemaVersion: "generation_configuration_v1",
        revision: 1,
        configurationJson: { ...DEFAULT_GENERATION_CONFIGURATION },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // mock writer：create 触发唯一冲突（P2002），返回数据库现有记录
      db.firstAggregateWriter = {
        casUpsertUserGenerationPreference: async () => ({
          success: false as const,
          conflict: true as const,
          existingRecord: winnerRecord,
        }),
      };

      const result = await getOrBackfillUserGenerationPreference(db, "u1", "u1");
      // loser 不报错，返回 stored + winner 的记录
      expect(result.source).toBe("stored");
      expect(result.revision).toBe(1);
      // 内存已同步（后续读取一致）
      const synced = getUserGenerationPreference(db, "u1");
      expect(synced?.revision).toBe(1);
      expect(synced?.configuration).toEqual(winnerRecord.configurationJson);
    });

    it("project backfill loser syncs memory so subsequent PATCH works", async () => {
      const db = createDbClient();
      const dbRecord: ProjectGenerationConfigurationRecord = {
        id: "db-id",
        projectId: "p1",
        schemaVersion: "generation_configuration_v1",
        revision: 1,
        sourceUserPreferenceRevision: null,
        configurationJson: { ...DEFAULT_GENERATION_CONFIGURATION },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      // mock writer：create 冲突返回数据库记录；后续 update 成功
      db.firstAggregateWriter = {
        casUpsertProjectGenerationConfiguration: async (record, expectedRevision) => {
          if (expectedRevision === 0) {
            return { success: false as const, conflict: true as const, existingRecord: dbRecord };
          }
          return { success: true as const };
        },
      };

      // loser 读取（backfill 冲突 → stored）
      const result = await getProjectGenerationConfiguration(db, "p1");
      expect(result.source).toBe("stored");
      expect(result.revision).toBe(1);
      // 内存已同步：后续 PATCH 不再 project_config_not_found_after_backfill
      const patch = await upsertProjectGenerationConfiguration(db, "p1", {
        expected_revision: 1,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "all_remotion", api_quality: "standard_720p" } },
      }, "u1");
      expect(patch.ok).toBe(true);
    });

    it("project backfill rethrows non-unique transaction errors instead of faking success", async () => {
      const db = createDbClient();
      // mock writer：审计 FK 失败等非唯一约束错误必须抛出
      db.firstAggregateWriter = {
        casUpsertProjectGenerationConfiguration: async () => {
          throw new Error("audit_log_fk_failed");
        },
      };
      await expect(getProjectGenerationConfiguration(db, "p1")).rejects.toThrow("audit_log_fk_failed");
      // 内存不能有虚假记录
      expect(db.projectGenerationConfigurations.size).toBe(0);
    });
  });
});
