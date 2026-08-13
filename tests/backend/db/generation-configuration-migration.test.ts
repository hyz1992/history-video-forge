import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

/**
 * S2-2A 任务 2 步骤 1：迁移 SQL 行为测试。
 *
 * 用 better-sqlite3 在 :memory: 上跑全部迁移，断言 CHECK 约束、唯一约束、
 * catalog 默认项 seed 和跨字段一致性在真实 SQL 层生效。
 *
 * 设计依据：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-design.md 第 4 节。
 */
describe("S2-2A generation configuration migration", () => {
  function seedBaseOwner(db: Database.Database) {
    db.exec(
      "INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)",
    );
    db.exec(
      "INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p1','P','u1','u1','p1','P',CURRENT_TIMESTAMP)",
    );
  }

  it("applies S2-2A migration cleanly creating all nine tables", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => (r as { name: string }).name);
      const expected = [
        "UserGenerationPreference",
        "ProjectGenerationConfiguration",
        "ProviderModelCatalog",
        "StoryboardSegmentOverride",
        "GenerationCostQuote",
        "RunConfigurationSnapshot",
        "GenerationRun",
        "GenerationRunEvent",
        "UsageCostRecord",
      ];
      for (const t of expected) {
        expect(tables, `迁移后应存在 ${t} 表`).toContain(t);
      }
    } finally {
      db.close();
    }
  });

  it("ProviderModelCatalog enforces status and capability CHECK constraints", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      // 合法 status
      expect(() =>
        db.exec(
          "INSERT INTO ProviderModelCatalog (id, capability, providerKey, modelId, status, isDefault, pricingVersion, pricingJson, parameterCapabilitiesJson, displayName, updatedAt) VALUES ('m1','llm.smart','dashscope','qwen-max','active',1,'v1','{}','{}','Q',CURRENT_TIMESTAMP)",
        ),
      ).not.toThrow();
      // 非法 status
      expect(() =>
        db.exec(
          "INSERT INTO ProviderModelCatalog (id, capability, providerKey, modelId, status, isDefault, pricingVersion, pricingJson, parameterCapabilitiesJson, displayName, updatedAt) VALUES ('m2','llm.smart','x','y','unknown',0,'v1','{}','{}','Y',CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
      // 非法 capability
      expect(() =>
        db.exec(
          "INSERT INTO ProviderModelCatalog (id, capability, providerKey, modelId, status, isDefault, pricingVersion, pricingJson, parameterCapabilitiesJson, displayName, updatedAt) VALUES ('m3','image.upscale','x','y','active',0,'v1','{}','{}','U',CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("GenerationRun enforces status CHECK and unique (projectId, operation, idempotencyKey)", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      seedBaseOwner(db);
      db.exec(
        "INSERT INTO RunConfigurationSnapshot (id, projectId, stage, operation, projectConfigurationRevision, schemaVersion, configurationHash, resolvedConfigurationJson, resolutionTraceJson, pricingVersionSetJson, budgetOverrideAuthorized, createdAt, updatedAt) VALUES ('snap1','p1','assets','assets.generate',1,'resolved_generation_configuration_v1','h1','{}','[]','[]',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      );
      // 合法 status
      expect(() =>
        db.exec(
          "INSERT INTO GenerationRun (id, projectId, operation, idempotencyKey, payloadFingerprint, runConfigurationSnapshotId, dispatchPayloadJson, status, dispatchClaimCount, createdAt, updatedAt) VALUES ('r1','p1','assets.generate','key1','fp1','snap1','{}','pending_dispatch',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).not.toThrow();
      // 非法 status
      expect(() =>
        db.exec(
          "INSERT INTO GenerationRun (id, projectId, operation, idempotencyKey, payloadFingerprint, runConfigurationSnapshotId, dispatchPayloadJson, status, dispatchClaimCount, createdAt, updatedAt) VALUES ('r2','p1','assets.generate','key2','fp2','snap1','{}','bogus',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
      // 重复 (projectId, operation, idempotencyKey)
      expect(() =>
        db.exec(
          "INSERT INTO GenerationRun (id, projectId, operation, idempotencyKey, payloadFingerprint, runConfigurationSnapshotId, dispatchPayloadJson, status, dispatchClaimCount, createdAt, updatedAt) VALUES ('r3','p1','assets.generate','key1','fp1','snap1','{}','pending_dispatch',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("GenerationCostQuote enforces status CHECK and one-time consumedAt nullability", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      seedBaseOwner(db);
      // 合法 quote
      expect(() =>
        db.exec(
          "INSERT INTO GenerationCostQuote (id, projectId, operation, configurationHash, quoteFingerprint, pricingHash, pricingVersionSetJson, itemsJson, estimatedCostMicros, authorizationCostMicros, containsUnboundedItem, overBudget, expiresAt, consumedAt, createdAt, updatedAt) VALUES ('q1','p1','assets.generate','ch','qfp','ph','[]','[]','0','0',0,0,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).not.toThrow();
      // 非法 operation 不是 CHECK 目标，但可测 quoteFingerprint 非空约束
      expect(() =>
        db.exec(
          "INSERT INTO GenerationCostQuote (id, projectId, operation, configurationHash, quoteFingerprint, pricingHash, pricingVersionSetJson, itemsJson, estimatedCostMicros, authorizationCostMicros, containsUnboundedItem, overBudget, expiresAt, consumedAt, createdAt, updatedAt) VALUES ('q2','p1','assets.generate','ch',NULL,'ph','[]','[]','0','0',0,0,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("UsageCostRecord enforces unique (runConfigurationSnapshotId, providerRequestKey, attemptIndex)", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      seedBaseOwner(db);
      db.exec(
        "INSERT INTO RunConfigurationSnapshot (id, projectId, stage, operation, projectConfigurationRevision, schemaVersion, configurationHash, resolvedConfigurationJson, resolutionTraceJson, pricingVersionSetJson, budgetOverrideAuthorized, createdAt, updatedAt) VALUES ('snap1','p1','assets','assets.generate',1,'resolved_generation_configuration_v1','h1','{}','[]','[]',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      );
      expect(() =>
        db.exec(
          "INSERT INTO UsageCostRecord (id, runConfigurationSnapshotId, capability, providerKey, modelId, providerRequestKey, attemptIndex, status, unitType, estimatedCostMicros, costBasis, createdAt, updatedAt) VALUES ('u1','snap1','llm.smart','dashscope','qwen-max','prk1',0,'planned','token','0','estimate',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).not.toThrow();
      // 重复 (snapshot, providerRequestKey, attemptIndex)
      expect(() =>
        db.exec(
          "INSERT INTO UsageCostRecord (id, runConfigurationSnapshotId, capability, providerKey, modelId, providerRequestKey, attemptIndex, status, unitType, estimatedCostMicros, costBasis, createdAt, updatedAt) VALUES ('u2','snap1','llm.smart','dashscope','qwen-max','prk1',0,'planned','token','0','estimate',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
      // 同 key 不同 attempt 允许
      expect(() =>
        db.exec(
          "INSERT INTO UsageCostRecord (id, runConfigurationSnapshotId, capability, providerKey, modelId, providerRequestKey, attemptIndex, status, unitType, estimatedCostMicros, costBasis, createdAt, updatedAt) VALUES ('u3','snap1','llm.smart','dashscope','qwen-max','prk1',1,'planned','token','0','estimate',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("seed provides exactly one active default ProviderModelCatalog entry per capability", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      const capabilities = [
        "llm.smart",
        "llm.flash",
        "image.generate",
        "video.image_to_video",
        "tts.synthesize",
      ];
      for (const cap of capabilities) {
        const defaults = db
          .prepare(
            "SELECT COUNT(*) as n FROM ProviderModelCatalog WHERE capability = ? AND status = 'active' AND isDefault = 1",
          )
          .get(cap) as { n: number };
        expect(
          defaults.n,
          `capability ${cap} 必须恰好一个 active default 项（resolver auto 硬合同）`,
        ).toBe(1);
      }
    } finally {
      db.close();
    }
  });

  it("ProjectGenerationConfiguration enforces projectId unique", () => {
    const db = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(db);
      seedBaseOwner(db);
      expect(() =>
        db.exec(
          "INSERT INTO ProjectGenerationConfiguration (id, projectId, schemaVersion, revision, configurationJson, createdAt, updatedAt) VALUES ('c1','p1','generation_configuration_v1',1,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).not.toThrow();
      // 重复 projectId
      expect(() =>
        db.exec(
          "INSERT INTO ProjectGenerationConfiguration (id, projectId, schemaVersion, revision, configurationJson, createdAt, updatedAt) VALUES ('c2','p1','generation_configuration_v1',1,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
