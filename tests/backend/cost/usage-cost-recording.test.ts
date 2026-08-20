import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

/** S2-2A 任务 9A：usage 成本记账失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 9A 步骤 1 验收：
 * 2. 同 provider job attempt 只记一条 usage（唯一约束防重复记账）。
 * 3. actual cost 与 estimate 分开存储和返回。
 * 5. actual 超出 authorization bound 时追加 pricing_overrun，并将对应
 *    catalog item 标记待审/禁用；不能改写已消费 quote。
 * 8. provider 响应无法给出精确账单时记录 actualCostState:
 *    estimated_after_execution，不得标为 provider invoice actual。
 */

import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { seedQuotableCatalog } from "./quote-test-context.js";
import {
  recordProviderJobUsage,
  type RecordProviderJobUsageInput,
} from "../../../backend/src/modules/generation-cost/usage-cost-recorder.js";
import type {
  AssetProviderJobRecord,
  GenerationRunRecord,
  RunConfigurationSnapshotRecord,
} from "../../../backend/src/db/client.js";

function makeSnapshot(overrides: Partial<RunConfigurationSnapshotRecord> = {}): RunConfigurationSnapshotRecord {
  const now = new Date();
  return {
    id: "snap_usage_001",
    projectId: "project_usage_001",
    userId: "user_usage_001",
    stage: "assets",
    operation: "assets.generate",
    runId: "run_usage_001",
    projectConfigurationRevision: 1,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "fnv1a64:test",
    resolvedConfigurationJson: {},
    resolutionTraceJson: [],
    quoteId: "quote_usage_001",
    quoteFingerprint: "sha256:test",
    estimatedCostMicros: "10000000",
    authorizationCostMicros: "12000000",
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: "sha256:pricing",
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRun(overrides: Partial<GenerationRunRecord> = {}): GenerationRunRecord {
  const now = new Date();
  return {
    id: "run_usage_001",
    projectId: "project_usage_001",
    userId: "user_usage_001",
    operation: "assets.generate",
    idempotencyKey: "usage-key-1",
    payloadFingerprint: "hash",
    quoteId: "quote_usage_001",
    runConfigurationSnapshotId: "snap_usage_001",
    dispatchPayloadJson: {},
    status: "running",
    dispatchLeaseOwner: "worker",
    dispatchLeaseExpiresAt: new Date(now.getTime() + 30_000),
    dispatchClaimCount: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeProviderJob(overrides: Partial<AssetProviderJobRecord> = {}): AssetProviderJobRecord {
  const now = new Date();
  return {
    id: "job_usage_001",
    assetManifestRecordId: "manifest_001",
    assetRunId: "run_usage_001",
    executionId: "exec_tts_001",
    taskId: "tts_001",
    providerType: "tts",
    providerName: "dashscope_tts",
    providerJobId: "provider-job-1",
    status: "completed",
    attemptCount: 1,
    generationRunId: "run_usage_001",
    providerRequestKey: "assets:run_usage_001:tts_001",
    attemptIndex: 0,
    rawRequestJson: {},
    rawResponseJson: {},
    errorCode: null,
    errorMessage: null,
    submittedAt: now,
    lastPolledAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseInput(db: ReturnType<typeof createDbClient>, overrides: Partial<RecordProviderJobUsageInput> = {}): RecordProviderJobUsageInput {
  return {
    db,
    snapshot: makeSnapshot(),
    runId: "run_usage_001",
    providerJob: makeProviderJob(),
    capability: "tts.synthesize",
    providerKey: "dashscope",
    modelId: "qwen3-tts-instruct-flash",
    measuredUnits: { unitType: "tts_character", count: 33 },
    providerUsage: null,
    durationMs: 1500,
    ...overrides,
  };
}

describe("usage cost recording (任务 9A 验收 2/3/8)", () => {
  it("验收2: 同一 (snapshot, providerRequestKey, attemptIndex) 重放只保留一条记录并更新状态", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    app.db.runConfigurationSnapshots.set("snap_usage_001", makeSnapshot());
    app.db.generationRuns.set("run_usage_001", makeRun());

    const first = await recordProviderJobUsage(
      baseInput(app.db, { providerJob: makeProviderJob({ status: "submitted" }) }),
    );
    expect(first.record.status).toBe("submitted");

    // 重放：同 attempt 的迟到回执只更新原记录（submitted → succeeded）
    const second = await recordProviderJobUsage(
      baseInput(app.db, { providerJob: makeProviderJob({ status: "completed" }) }),
    );
    expect(app.db.usageCostRecords.size).toBe(1);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.status).toBe("succeeded");

    // 新 attempt（重试）是新记录：attemptIndex 不同
    const retry = await recordProviderJobUsage(
      baseInput(app.db, {
        providerJob: makeProviderJob({ attemptIndex: 1, status: "completed" }),
      }),
    );
    expect(app.db.usageCostRecords.size).toBe(2);
    expect(retry.record.attemptIndex).toBe(1);
  });

  it("验收3: estimate 与 actual 分开存储：provider 确认值可与估算不同且互不覆盖", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    app.db.runConfigurationSnapshots.set("snap_usage_001", makeSnapshot());
    app.db.generationRuns.set("run_usage_001", makeRun());

    // provider 回执给出与估算不同的实际费用
    const result = await recordProviderJobUsage(
      baseInput(app.db, {
        providerUsage: { inputUnits: 1, outputUnits: 0, costMicros: "5555555" },
      }),
    );
    expect(result.record.estimatedCostMicros).not.toBe(result.record.actualCostMicros);
    expect(result.record.actualCostMicros).toBe("5555555");
    expect(result.record.costBasis).toBe("provider_usage");
    expect(result.actualCostState).toBe("provider_confirmed");
    expect(result.record.inputUnits).toBe(1);
  });

  it("验收8: provider 无法给出账单时按实测计量估 actual，标记 estimated_after_execution 而非 provider actual", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    app.db.runConfigurationSnapshots.set("snap_usage_001", makeSnapshot());
    app.db.generationRuns.set("run_usage_001", makeRun());

    const result = await recordProviderJobUsage(baseInput(app.db));
    // 实际费用按执行后实测单位计价（本地计量），basis 不得标 provider_usage/invoice
    expect(result.actualCostState).toBe("estimated_after_execution");
    expect(result.record.costBasis).toBe("estimate");
    expect(result.record.actualCostMicros).not.toBeNull();
    expect(result.record.outputUnits).toBe(33);
  });
});

describe("pricing overrun handling (任务 9A 验收 5)", () => {
  it("actual 超出 authorization bound：追加 pricing_overrun run event + 禁用对应 catalog item，不改写已消费 quote", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    // 授权上界压到极低：必然超额
    const snapshot = makeSnapshot({ authorizationCostMicros: "1000" });
    app.db.runConfigurationSnapshots.set("snap_usage_001", snapshot);
    app.db.generationRuns.set("run_usage_001", makeRun());
    const quoteBefore = {
      id: "quote_usage_001",
      projectId: "project_usage_001",
      userId: "user_usage_001",
      operation: "assets.generate",
      configurationHash: "fnv1a64:test",
      quoteFingerprint: "sha256:test",
      pricingHash: "sha256:pricing",
      pricingVersionSetJson: [],
      itemsJson: [],
      estimatedCostMicros: "10000000",
      authorizationCostMicros: "1000",
      containsUnboundedItem: false,
      budgetLimitMicros: null,
      overBudget: true,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    app.db.generationCostQuotes.set("quote_usage_001", quoteBefore);

    const result = await recordProviderJobUsage(baseInput(app.db, { snapshot }));
    expect(result.overrun).toBe(true);

    // append-only run event：pricing_overrun
    const events = app.db.generationRunEvents.get("run_usage_001") ?? [];
    const overrunEvents = events.filter((event) => event.eventType === "pricing_overrun");
    expect(overrunEvents.length).toBe(1);
    expect(overrunEvents[0]!.eventJson).toMatchObject({
      capability: "tts.synthesize",
      provider_key: "dashscope",
      model_id: "qwen3-tts-instruct-flash",
    });

    // 对应 catalog item 被禁用（不适合自动新运行，待管理员复核）
    const ttsCatalogEntries = [...app.db.providerModelCatalog.values()].filter(
      (entry) =>
        entry.capability === "tts.synthesize" &&
        entry.providerKey === "dashscope" &&
        entry.modelId === "qwen3-tts-instruct-flash",
    );
    expect(ttsCatalogEntries.length).toBeGreaterThan(0);
    for (const entry of ttsCatalogEntries) {
      expect(entry.status).toBe("disabled");
    }

    // 已消费 quote 不被改写
    const quoteAfter = app.db.generationCostQuotes.get("quote_usage_001")!;
    expect(quoteAfter.authorizationCostMicros).toBe("1000");
    expect(quoteAfter.quoteFingerprint).toBe("sha256:test");
    expect(quoteAfter.consumedAt).toEqual(quoteBefore.consumedAt);
  });

  it("actual 未超出授权上界时不产生 overrun 副作用", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    app.db.runConfigurationSnapshots.set("snap_usage_001", makeSnapshot());
    app.db.generationRuns.set("run_usage_001", makeRun());

    const result = await recordProviderJobUsage(baseInput(app.db));
    expect(result.overrun).toBe(false);
    const events = app.db.generationRunEvents.get("run_usage_001") ?? [];
    expect(events.some((event) => event.eventType === "pricing_overrun")).toBe(false);
    const ttsEntry = [...app.db.providerModelCatalog.values()].find(
      (entry) =>
        entry.capability === "tts.synthesize" &&
        entry.providerKey === "dashscope" &&
        entry.modelId === "qwen3-tts-instruct-flash",
    );
    expect(ttsEntry?.status).toBe("active");
  });
});

describe("usage cost unique constraint (Prisma, 任务 9A 验收 2 数据库防线)", () => {
  const tempDirectories: string[] = [];
  const openClients: Array<Awaited<ReturnType<typeof createPrismaClient>>> = [];

  afterEach(async () => {
    for (const client of openClients.splice(0)) {
      try {
        await client.$disconnect();
      } catch {
        // Windows 下句柄可能已释放，忽略
      }
    }
    for (const directory of tempDirectories.splice(0)) {
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // 忽略句柄延迟释放
      }
    }
  });

  it("数据库唯一约束拒绝同 (snapshot, providerRequestKey, attemptIndex) 的第二条插入", async () => {
    const directory = mkdtempSync(join(tmpdir(), "s2-2a-usage-unique-"));
    tempDirectories.push(directory);
    const databasePath = join(directory, "test.db");
    const database = new Database(databasePath);
    try {
      applyAllDatabaseMigrations(database);
    } finally {
      database.close();
    }
    const client = await createPrismaClient(databasePath);
    openClients.push(client);
    await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
    await client.project.create({
      data: { id: "project_usage_001", name: "P", ownerId: "u1", createdById: "u1", storageKey: "k", storageDisplayName: "P" },
    });
    await client.runConfigurationSnapshot.create({
      data: {
        id: "snap_usage_001", projectId: "project_usage_001", stage: "assets", operation: "assets.generate",
        runId: null, projectConfigurationRevision: 1, schemaVersion: "v1", configurationHash: "h",
        resolvedConfigurationJson: {}, resolutionTraceJson: [], quoteId: null, quoteFingerprint: null,
        estimatedCostMicros: "1000", authorizationCostMicros: "2000", budgetLimitMicros: null,
        budgetOverrideAuthorized: false, pricingHash: null, pricingVersionSetJson: [],
      },
    });
    const row = {
      runConfigurationSnapshotId: "snap_usage_001",
      providerRequestKey: "assets:run_usage_001:tts_001",
      attemptIndex: 0,
      capability: "tts.synthesize",
      providerKey: "dashscope",
      modelId: "qwen3-tts-instruct-flash",
      status: "succeeded",
      unitType: "tts_character",
      inputUnits: null,
      outputUnits: 33,
      estimatedCostMicros: "1000",
      actualCostMicros: "1000",
      costBasis: "estimate",
      durationMs: 100,
    };
    await client.usageCostRecord.create({ data: { id: "usage_001", ...row } });
    await expect(client.usageCostRecord.create({ data: { id: "usage_002", ...row } })).rejects.toMatchObject({
      code: "P2002",
    });
  });
});
