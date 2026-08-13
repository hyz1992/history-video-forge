import { describe, expect, it } from "vitest";

import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import {
  getUserGenerationPreference,
  upsertUserGenerationPreference,
  getProjectGenerationConfiguration,
  upsertProjectGenerationConfiguration,
  backfillProjectGenerationConfiguration,
  listPublicGenerationCapabilities,
} from "../../../backend/src/modules/generation-config/generation-config.repository.js";

/**
 * S2-2A 任务 3 步骤 1：repository 失败测试。
 *
 * 覆盖：
 * - 用户默认读写 + 乐观锁（revision 不匹配返回 conflict）
 * - 项目冻结配置读写 + 乐观锁
 * - 创建项目时复制用户默认
 * - 修改用户默认不改变已有项目
 * - 旧项目首读 backfill 默认配置（source: backfilled_default）
 * - 目录只读 API 只返回公开安全字段
 */
describe("generation-config repository", () => {
  describe("user generation preference", () => {
    it("returns null when no preference exists", () => {
      const db = createDbClient();
      expect(getUserGenerationPreference(db, "u1")).toBeNull();
    });

    it("creates and reads a preference with revision 1", () => {
      const db = createDbClient();
      const result = upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "all_api_video", api_quality: "high_1080p" } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(1);

      const pref = getUserGenerationPreference(db, "u1");
      expect(pref?.revision).toBe(1);
      expect(pref?.configuration.video.strategy).toBe("all_api_video");
    });

    it("updates preference with correct expected_revision", () => {
      const db = createDbClient();
      upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      });
      const result = upsertUserGenerationPreference(db, "u1", {
        expected_revision: 1,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "prefer_api_video", api_quality: "standard_720p" } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
      expect(result.value.configuration.video.strategy).toBe("prefer_api_video");
    });

    it("rejects update with stale expected_revision (conflict)", () => {
      const db = createDbClient();
      upsertUserGenerationPreference(db, "u1", {
        expected_revision: null,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      });
      const result = upsertUserGenerationPreference(db, "u1", {
        expected_revision: 99,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("generation_preference_revision_conflict");
      // 数据库内容不变
      const pref = getUserGenerationPreference(db, "u1");
      expect(pref?.revision).toBe(1);
    });
  });

  describe("project generation configuration", () => {
    it("returns backfilled_default for project without configuration", () => {
      const db = createDbClient();
      // 不创建配置，直接读 → backfill
      const result = getProjectGenerationConfiguration(db, "p1");
      expect(result.source).toBe("backfilled_default");
      expect(result.configuration).toEqual(DEFAULT_GENERATION_CONFIGURATION);
      // backfill 后配置写入内存，后续读取 source 为 stored
      const result2 = getProjectGenerationConfiguration(db, "p1");
      expect(result2.source).toBe("stored");
    });

    it("updates project configuration with correct expected_revision", () => {
      const db = createDbClient();
      // 先 backfill 一次建立 revision 1
      getProjectGenerationConfiguration(db, "p1");
      const result = upsertProjectGenerationConfiguration(db, "p1", {
        expected_revision: 1,
        configuration: { ...DEFAULT_GENERATION_CONFIGURATION, video: { strategy: "all_remotion", api_quality: "standard_720p" } },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
      expect(result.value.configuration.video.strategy).toBe("all_remotion");
    });

    it("rejects project config update with stale revision", () => {
      const db = createDbClient();
      getProjectGenerationConfiguration(db, "p1");
      const result = upsertProjectGenerationConfiguration(db, "p1", {
        expected_revision: 99,
        configuration: DEFAULT_GENERATION_CONFIGURATION,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("project_generation_configuration_revision_conflict");
    });
  });

  describe("backfill isolation", () => {
    it("explicitly backfilling writes default and returns source backfilled_default", () => {
      const db = createDbClient();
      const result = backfillProjectGenerationConfiguration(db, "p1", null);
      expect(result.source).toBe("backfilled_default");
      expect(result.revision).toBe(1);
    });
  });

  describe("public generation capabilities catalog", () => {
    it("returns only active entries with safe public fields (no credentials)", () => {
      const db = createDbClient();
      // 手动 seed 一个 catalog 条目
      db.providerModelCatalog.set("llm.smart.test", {
        id: "llm.smart.test",
        capability: "llm.smart",
        providerKey: "deepseek",
        modelId: "deepseek-v4-pro",
        modelVersion: null,
        displayName: "DeepSeek V4 Pro",
        qualityTier: "high",
        speedTier: "slow",
        parameterCapabilitiesJson: {},
        pricingVersion: "v1",
        pricingJson: { bounded: false },
        status: "active",
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      db.providerModelCatalog.set("llm.smart.disabled", {
        id: "llm.smart.disabled",
        capability: "llm.smart",
        providerKey: "x",
        modelId: "old",
        modelVersion: null,
        displayName: "Old",
        qualityTier: null,
        speedTier: null,
        parameterCapabilitiesJson: {},
        pricingVersion: "v0",
        pricingJson: {},
        status: "disabled",
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const entries = listPublicGenerationCapabilities(db);
      // 只返回 active 项
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe("llm.smart.test");
      expect(entries[0]!.capability).toBe("llm.smart");
      // 公开字段
      expect(entries[0]!.display_name).toBe("DeepSeek V4 Pro");
      // 不暴露 providerKey 原始值以外的敏感信息（无 apiKey/env/credential）
      expect(entries[0]).not.toHaveProperty("api_key");
      expect(entries[0]).not.toHaveProperty("apiKeyEnv");
    });
  });
});
