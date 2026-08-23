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
    containsUnboundedItem: false,
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

describe("usage recording end-to-end through the Prisma writer (C-1 修复锁定)", () => {
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

  it("recordProviderJobUsage with a real provider job id passes the FK and persists to the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "s2-2a-usage-e2e-"));
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
      data: { id: "p1", name: "P", ownerId: "u1", createdById: "u1", storageKey: "p1", storageDisplayName: "P" },
    });
    await client.generationCostQuote.create({
      data: {
        id: "quote_e2e_001", projectId: "p1", userId: "u1", operation: "assets.generate",
        configurationHash: "h", quoteFingerprint: "f", pricingHash: "ph", pricingVersionSetJson: [],
        itemsJson: [], estimatedCostMicros: "1000000", authorizationCostMicros: "999999999",
        containsUnboundedItem: false, budgetLimitMicros: null, overBudget: false,
        expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
      },
    });
    await client.runConfigurationSnapshot.create({
      data: {
        id: "snap_e2e_001", projectId: "p1", stage: "assets", operation: "assets.generate",
        runId: "run_e2e_001", projectConfigurationRevision: 1, schemaVersion: "v1", configurationHash: "h",
        resolvedConfigurationJson: {}, resolutionTraceJson: [], quoteId: "quote_e2e_001", quoteFingerprint: "f",
        estimatedCostMicros: "1000000", authorizationCostMicros: "999999999", budgetLimitMicros: null,
        budgetOverrideAuthorized: false, pricingHash: null, pricingVersionSetJson: [],
      },
    });
    await client.generationRun.create({
      data: {
        id: "run_e2e_001", projectId: "p1", operation: "assets.generate", idempotencyKey: "e2e-1",
        payloadFingerprint: "f", runConfigurationSnapshotId: "snap_e2e_001", dispatchPayloadJson: {},
        status: "running",
      },
    });
    const db = createDbClient();
    // 装配 Prisma writer：usage 落库走 thirdAggregateWriter（生产装配等价）
    const { PrismaThirdAggregateWriter } = await import("../../../backend/src/db/repositories/prisma-third-aggregate-writer.js");
    db.thirdAggregateWriter = new PrismaThirdAggregateWriter(client);
    db.runConfigurationSnapshots.set("snap_e2e_001", makeSnapshot({
      id: "snap_e2e_001", projectId: "p1", userId: "u1", runId: "run_e2e_001",
      quoteId: "quote_e2e_001", authorizationCostMicros: "999999999",
    }));
    db.generationRuns.set("run_e2e_001", makeRun({
      id: "run_e2e_001", projectId: "p1", userId: "u1", quoteId: "quote_e2e_001",
    }));
    // 建 provider job 行（assetProviderJobRecordId 外键父记录必须真实存在于库）
    await client.topicPackage.create({
      data: {
        id: "tp1", projectId: "p1", title: "T", selectedAngle: "A", familyLabel: "F", scopeLabel: "S",
        coreConflict: "C", strongScene: "SC", stakes: "ST", packagingSeed: "PS",
        canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {},
        narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
        riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
      },
    });
    await client.scriptRecord.create({
      data: {
        id: "sr1", projectId: "p1", topicPackageId: "tp1", scriptText: "T", openingSpan: "O", endingSpan: "E",
        estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
      },
    });
    await client.storyboardRecord.create({
      data: { id: "sb1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1", planJson: {}, validationResultJson: {} },
    });
    await client.assetPlanRecord.create({
      data: {
        id: "ap1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1", storyboardRecordId: "sb1",
        planJson: { tasks: [] }, validationResultJson: {}, executionStateJson: {},
      },
    });
    await client.assetManifestRecord.create({
      data: {
        id: "manifest_e2e_1", projectId: "p1", topicPackageId: "tp1", scriptRecordId: "sr1",
        storyboardRecordId: "sb1", assetPlanRecordId: "ap1", revision: 1,
        manifestJson: {}, validationResultJson: {},
      },
    });
    await client.assetProviderJobRecord.create({
      data: {
        id: "job_e2e_real_001", assetManifestRecordId: "manifest_e2e_1", assetRunId: "run_e2e_001",
        executionId: "exec_tts_001", taskId: "tts_001", providerType: "tts",
        providerName: "dashscope_tts", status: "completed", attemptCount: 1,
        generationRunId: "run_e2e_001", providerRequestKey: "assets:run_e2e_001:tts_001", attemptIndex: 0,
      },
    });
    const job = makeProviderJob({ id: "job_e2e_real_001", assetRunId: "run_e2e_001", generationRunId: "run_e2e_001" });
    db.assetProviderJobRecords.set(job.id, job);

    const { recordProviderJobUsage } = await import("../../../backend/src/modules/generation-cost/usage-cost-recorder.js");
    const outcome = await recordProviderJobUsage(
      baseInput(db, {
        providerJob: job,
        snapshot: makeSnapshot({
          id: "snap_e2e_001", projectId: "p1", userId: "u1",
          runId: "run_e2e_001", quoteId: "quote_e2e_001",
        }),
      }),
    );
    expect(outcome.record.assetProviderJobRecordId).toBe("job_e2e_real_001");

    // Prisma 态：usage 行真实落库（FK 通过，非吞错）
    const rows = await client.usageCostRecord.findMany({ where: { runConfigurationSnapshotId: "snap_e2e_001" } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.assetProviderJobRecordId).toBe("job_e2e_real_001");
    expect(rows[0]!.estimatedCostMicros).toBe(outcome.record.estimatedCostMicros);
  });
});
