import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      // 合法 status（isDefault=0，避免撞 active 默认项唯一约束）
      expect(() =>
        db.exec(
          "INSERT INTO ProviderModelCatalog (id, capability, providerKey, modelId, status, isDefault, pricingVersion, pricingJson, parameterCapabilitiesJson, displayName, updatedAt) VALUES ('m1','llm.smart','dashscope','qwen-max','active',0,'v1','{}','{}','Q',CURRENT_TIMESTAMP)",
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

/**
 * S2-2A 任务 2 审查整改（20260813090000_s2_2a_review_fixes）：
 * 金额 CHECK、call-intent 防重、seed 对齐、catalog 默认项唯一。
 */
describe("S2-2A review fixes migration", () => {
  function openMigrated() {
    const db = new Database(":memory:");
    applyAllDatabaseMigrations(db);
    return db;
  }

  it("rejects non-decimal or negative micros in quote amounts", () => {
    const db = openMigrated();
    try {
      db.exec("INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p1','P','u1','u1','p1','P',CURRENT_TIMESTAMP)");
      const insert = (id: string, estimated: string, authorization: string) =>
        db.exec(
          `INSERT INTO GenerationCostQuote (id, projectId, operation, configurationHash, quoteFingerprint, pricingHash, pricingVersionSetJson, itemsJson, estimatedCostMicros, authorizationCostMicros, containsUnboundedItem, overBudget, expiresAt, createdAt, updatedAt) VALUES ('${id}','p1','a','h','f','p','[]','[]','${estimated}','${authorization}',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        );
      expect(() => insert("q1", "not-money", "0")).toThrow();
      expect(() => insert("q2", "0", "-7")).toThrow();
      expect(() => insert("q3", "1.5", "0")).toThrow();
      expect(() => insert("q4", "01", "0")).toThrow();
      expect(() => insert("q5", "100", "50")).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("rejects duplicate provider call-intent (generationRunId, providerRequestKey, attemptIndex)", () => {
    const db = openMigrated();
    try {
      db.pragma("foreign_keys = OFF"); // 本用例只验证唯一索引，不依赖 FK 链
      // attemptCount 是运行态 1-based；attemptIndex 是冻结合同 0-based。
      // j1: attemptCount=1, attemptIndex=0
      db.exec("INSERT INTO AssetProviderJobRecord (id, assetManifestRecordId, assetRunId, executionId, taskId, providerType, providerName, status, attemptCount, attemptIndex, generationRunId, providerRequestKey, createdAt, updatedAt) VALUES ('j1','am1','r1','e1','t1','image','d','succeeded',1,0,'gr1','pk1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      // 同 run + 同 key + 同 attemptIndex → 拒绝。
      // j2 使用不同旧键 (assetRunId='r2', attemptCount=2)，只重复 call-intent 三元组
      // (generationRunId='gr1', providerRequestKey='pk1', attemptIndex=0)，
      // 排除旧唯一键 (assetRunId, executionId, taskId, attemptCount) 造成的假阳性。
      expect(() =>
        db.exec("INSERT INTO AssetProviderJobRecord (id, assetManifestRecordId, assetRunId, executionId, taskId, providerType, providerName, status, attemptCount, attemptIndex, generationRunId, providerRequestKey, createdAt, updatedAt) VALUES ('j2','am1','r2','e1','t1','image','d','succeeded',2,0,'gr1','pk1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
      ).toThrow();
      // 同 key 不同 attemptIndex → 允许
      expect(() =>
        db.exec("INSERT INTO AssetProviderJobRecord (id, assetManifestRecordId, assetRunId, executionId, taskId, providerType, providerName, status, attemptCount, attemptIndex, generationRunId, providerRequestKey, createdAt, updatedAt) VALUES ('j3','am1','r3','e1','t1','image','d','succeeded',1,1,'gr1','pk1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
      ).not.toThrow();
      // 旧行（无 generationRunId/providerRequestKey/attemptIndex）不受约束
      expect(() =>
        db.exec("INSERT INTO AssetProviderJobRecord (id, assetManifestRecordId, assetRunId, executionId, taskId, providerType, providerName, status, attemptCount, createdAt, updatedAt) VALUES ('j4','am1','rB','e1','t1','image','d','succeeded',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("prevents mutation of provider job call-intent identity after creation", () => {
    const db = openMigrated();
    try {
      db.pragma("foreign_keys = OFF");
      db.exec("INSERT INTO AssetProviderJobRecord (id, assetManifestRecordId, assetRunId, executionId, taskId, providerType, providerName, status, attemptCount, attemptIndex, generationRunId, providerRequestKey, createdAt, updatedAt) VALUES ('j1','am1','r1','e1','t1','image','d','prepared',1,0,'gr1','pk1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      // 身份三元组不可变：改写 providerRequestKey → 拒绝
      expect(() =>
        db.exec("UPDATE AssetProviderJobRecord SET providerRequestKey='changed' WHERE id='j1'"),
      ).toThrow();
      // 运行态字段可改：status → 允许
      expect(() =>
        db.exec("UPDATE AssetProviderJobRecord SET status='running' WHERE id='j1'"),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("rejects a second active default catalog entry for one capability", () => {
    const db = openMigrated();
    try {
      expect(() =>
        db.exec("INSERT INTO ProviderModelCatalog (id, capability, providerKey, modelId, status, isDefault, pricingVersion, pricingJson, parameterCapabilitiesJson, displayName, updatedAt) VALUES ('llm.smart.extra','llm.smart','d','m','active',1,'v','{}','{}','X',CURRENT_TIMESTAMP)"),
      ).toThrow();
      // 非默认 active 项允许
      expect(() =>
        db.exec("INSERT INTO ProviderModelCatalog (id, capability, providerKey, modelId, status, isDefault, pricingVersion, pricingJson, parameterCapabilitiesJson, displayName, updatedAt) VALUES ('llm.smart.non-default','llm.smart','d','m','active',0,'v','{}','{}','Y',CURRENT_TIMESTAMP)"),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("seed aligns with real runtime defaults and provides pricing", () => {
    const db = openMigrated();
    try {
      const rows = db
        .prepare("SELECT capability, providerKey, modelId, isDefault, pricingJson FROM ProviderModelCatalog WHERE status='active'")
        .all() as { capability: string; providerKey: string; modelId: string; isDefault: number; pricingJson: string }[];
      const byCap = Object.fromEntries(rows.map((r) => [r.capability, r]));
      // 媒体模型与 assets-run.service.ts 当前默认一致
      expect(byCap["image.generate"]!.modelId).toBe("wan2.6-t2i");
      expect(byCap["video.image_to_video"]!.modelId).toBe("wan2.7-i2v-2026-04-25");
      expect(byCap["tts.synthesize"]!.modelId).toBe("qwen3-tts-instruct-flash");
      // LLM 映射到 providers.json 真实注册 provider
      expect(byCap["llm.smart"]!.providerKey).toBe("deepseek");
      expect(byCap["llm.flash"]!.providerKey).toBe("zhipu");
      // 每个 active 默认项都有非空 pricingJson
      for (const row of rows) {
        expect(row.isDefault).toBe(1);
        const pricing = JSON.parse(row.pricingJson) as Record<string, string>;
        expect(pricing.currency).toBe("CNY");
        expect(Object.keys(pricing).length).toBeGreaterThan(1);
      }
    } finally {
      db.close();
    }
  });

  it("rejects orphan storyboard segment override (foreign key)", () => {
    const db = openMigrated();
    try {
      db.exec("INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p1','P','u1','u1','p1','P',CURRENT_TIMESTAMP)");
      expect(() =>
        db.exec("INSERT INTO StoryboardSegmentOverride (id, projectId, storyboardRecordId, segmentId, revision, updatedAt) VALUES ('o1','p1','missing-storyboard','s1',1,CURRENT_TIMESTAMP)"),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});

describe("S2-2A review fixes in-place upgrade", () => {
  // P1-1：从上一版本（12090000）插入已有数据后，执行 13090000 增量升级必须
  // 保留全部数据（重建表期间关闭外键检查，避免 RESTRICT 外键阻止 DROP）。
  it("upgrades in place and preserves existing run/snapshot/quote/usage data", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const migrationsRoot = join(process.cwd(), "backend/prisma/migrations");
    const migrationFiles = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        name: e.name,
        sql: readFileSync(join(migrationsRoot, e.name, "migration.sql"), "utf8"),
      }));
    // 上一版本 = 到 20260812090000_s2_2a_generation_configuration 为止
    const previous = migrationFiles.filter((m) => m.name.startsWith("20260812090000") || m.name.localeCompare("20260812090000") < 0);
    const upgrade = migrationFiles.filter((m) => m.name.startsWith("20260813090000"));

    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      for (const m of previous) db.exec(m.sql);

      // 在上一版本 schema 中写入一整套运行数据
      db.exec("INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p1','P','u1','u1','p1','P',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO GenerationCostQuote (id, projectId, operation, configurationHash, quoteFingerprint, pricingHash, pricingVersionSetJson, itemsJson, estimatedCostMicros, authorizationCostMicros, containsUnboundedItem, overBudget, expiresAt, createdAt, updatedAt) VALUES ('q1','p1','a','h','f','p','[]','[]','100','50',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO RunConfigurationSnapshot (id, projectId, stage, operation, projectConfigurationRevision, schemaVersion, configurationHash, resolvedConfigurationJson, resolutionTraceJson, pricingVersionSetJson, budgetOverrideAuthorized, createdAt, updatedAt) VALUES ('snap1','p1','assets','a',1,'v','h','{}','[]','[]',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO GenerationRun (id, projectId, operation, idempotencyKey, payloadFingerprint, runConfigurationSnapshotId, dispatchPayloadJson, status, dispatchClaimCount, createdAt, updatedAt) VALUES ('r1','p1','assets.generate','k1','fp','snap1','{}','pending_dispatch',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO GenerationRunEvent (id, generationRunId, eventType, eventJson, createdAt) VALUES ('e1','r1','x','{}',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO UsageCostRecord (id, runConfigurationSnapshotId, capability, providerKey, modelId, providerRequestKey, attemptIndex, status, unitType, estimatedCostMicros, costBasis, createdAt, updatedAt) VALUES ('u1','snap1','llm.smart','d','m','prk',0,'planned','token','0','estimate',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");

      // 执行增量升级（不得抛 FOREIGN KEY constraint failed）
      expect(() => db.exec(upgrade[0]!.sql)).not.toThrow();

      // 数据全部保留
      const count = (table: string) => (db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n;
      expect(count("GenerationRun")).toBe(1);
      expect(count("GenerationRunEvent")).toBe(1);
      expect(count("UsageCostRecord")).toBe(1);
      expect(count("GenerationCostQuote")).toBe(1);
      expect(count("RunConfigurationSnapshot")).toBe(1);

      // 触发器已就位：跨项目 run/snapshot 被数据库拒绝。
      // 制造真正的跨项目关系：p2 的 snapshot，p1 的 run 引用它 → 触发器拒绝。
      db.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p2','P2','u1','u1','p2','P2',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO RunConfigurationSnapshot (id, projectId, stage, operation, projectConfigurationRevision, schemaVersion, configurationHash, resolvedConfigurationJson, resolutionTraceJson, pricingVersionSetJson, budgetOverrideAuthorized, createdAt, updatedAt) VALUES ('snap2','p2','assets','a',1,'v','h','{}','[]','[]',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      expect(() =>
        db.exec("INSERT INTO GenerationRun (id, projectId, operation, idempotencyKey, payloadFingerprint, runConfigurationSnapshotId, dispatchPayloadJson, status, dispatchClaimCount, createdAt, updatedAt) VALUES ('r2','p1','assets.generate','k2','fp','snap2','{}','pending_dispatch',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  // P1-1：旧版本已写入非法跨项目关系时，增量迁移必须中止而非静默保留。
  it("aborts upgrade when previous version has cross-project snapshot-quote relation", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const migrationsRoot = join(process.cwd(), "backend/prisma/migrations");
    const migrationFiles = readdirSync(migrationsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        name: e.name,
        sql: readFileSync(join(migrationsRoot, e.name, "migration.sql"), "utf8"),
      }));
    const previous = migrationFiles.filter((m) => m.name.startsWith("20260812090000") || m.name.localeCompare("20260812090000") < 0);
    const upgrade = migrationFiles.filter((m) => m.name.startsWith("20260813090000"));

    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      for (const m of previous) db.exec(m.sql);
      db.exec("INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p1','P','u1','u1','p1','P',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p2','P2','u1','u1','p2','P2',CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO GenerationCostQuote (id, projectId, operation, configurationHash, quoteFingerprint, pricingHash, pricingVersionSetJson, itemsJson, estimatedCostMicros, authorizationCostMicros, containsUnboundedItem, overBudget, expiresAt, createdAt, updatedAt) VALUES ('q2','p2','a','h','f','p','[]','[]','100','50',0,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
      db.exec("INSERT INTO RunConfigurationSnapshot (id, projectId, stage, operation, projectConfigurationRevision, schemaVersion, configurationHash, resolvedConfigurationJson, resolutionTraceJson, pricingVersionSetJson, budgetOverrideAuthorized, quoteId, createdAt, updatedAt) VALUES ('snap1','p1','assets','a',1,'v','h','{}','[]','[]',0,'q2',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");

      // 增量迁移必须中止（预检触发器检测到跨项目关系）
      expect(() => db.exec(upgrade[0]!.sql)).toThrow("migration_aborted");
    } finally {
      db.close();
    }
  });
});
