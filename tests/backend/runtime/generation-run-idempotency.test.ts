import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { hydrateSecondAggregates } from "../../../backend/src/db/repositories/prisma-second-aggregate-hydrator.js";
import { hydrateThirdAggregates } from "../../../backend/src/db/repositories/prisma-third-aggregate-hydrator.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { createGenerationRunDispatcher } from "../../../backend/src/modules/generation-run/generation-run-dispatcher.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { buildQuotableReadinessInput, prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import type { GenerationRunRecord } from "../../../backend/src/db/client.js";

/**
 * S2-2 幂等提交事务（2026-08-23 报价体系移除后简化版）。
 * 覆盖：同 key 同 fingerprint 返回同 run；同 key 不同 fingerprint 409；
 * snapshot + pending_dispatch run 同事务；事务失败整体回滚；
 * 事务提交前绝不调用外部 provider；Prisma 唯一约束为最终防线。
 */

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
      // Prisma 句柄延迟释放时跳过清理，避免 EBUSY 掩盖真实断言
    }
  }
});

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "s2-2a-generation-run-"));
  tempDirectories.push(directory);
  const databasePath = join(directory, "test.db");
  const database = new Database(databasePath);
  try {
    applyAllDatabaseMigrations(database);
  } finally {
    database.close();
  }
  return databasePath;
}

// S2-2B：客户端 voice_profile_id 已废弃（快照为唯一权威）；auto 模式提交不再携带。
const SUBMIT_PAYLOAD = { execution_mode: "auto_available" };

async function prepareMapSubmitContext() {
  const app = buildApp();
  await seedQuotableCatalog(app);
  const project = await prepareQuoteProject(app.db);
  const repository = createGenerationRunRepository(app.db);
  return { app, project, repository };
}

function submitInput(overrides: Partial<Parameters<typeof createOrRestoreGenerationRun>[3]> = {}) {
  return {
    operation: "assets.generate" as const,
    idempotencyKey: "client-key-1",
    selection: { task_ids: [] },
    dispatchPayload: SUBMIT_PAYLOAD,
    ...overrides,
  };
}

async function createPrismaContext() {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    openClients.push(client);
    await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
    await client.user.create({ data: { id: "u2", username: "t2", displayName: "T2", passwordHash: "h", role: "USER" } });
    const firstWriter = await PrismaFirstAggregateWriter.create(client, "u1");
    const app = buildApp({
      firstAggregateWriter: firstWriter,
      secondAggregateWriter: new PrismaSecondAggregateWriter(client, "u1"),
      thirdAggregateWriter: new PrismaThirdAggregateWriter(client),
      prismaClient: client,
    });
    await hydrateFirstAggregates(app.db, new Map() as never, client, { storageRoot: process.cwd() });
    await hydrateSecondAggregates(app.db, client);
    await hydrateThirdAggregates(app.db, client);
    const db = app.db;
    await seedQuotableCatalog(app);
    const project = await createProject(db, { name: "T", ownerId: "u1" });
    const repository = createGenerationRunRepository(db, client);
    return { client, db, project, repository };
  }

describe("generation run idempotency (legacy Map mode)", () => {
  it("same key + same payload returns the same run (no duplicate run)", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();
    const first = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toBe(true);
    expect(first.value.run.status).toBe("pending_dispatch");

    // 重放：同 key 同 payload → 同 run，created=false
    const replay = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.created).toBe(false);
    expect(replay.value.run.id).toBe(first.value.run.id);

    // 恰好一个 run
    expect([...app.db.generationRuns.values()].length).toBe(1);
  });

  it("same key + different payload returns generation_idempotency_payload_conflict", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();
    const first = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);

    const conflict = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      submitInput({ selection: { task_ids: ["task_img_001"] } }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("generation_idempotency_payload_conflict");
    expect([...app.db.generationRuns.values()].length).toBe(1);
  });

  it("never calls the provider before the transaction commits; dispatch happens after", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();
    let submitCount = 0;
    const handler = async () => {
      submitCount += 1;
      return { status: "succeeded" as const };
    };
    const dispatcher = createGenerationRunDispatcher({
      db: app.db,
      repository,
      workerId: "w1",
      leaseDurationMs: 30_000,
      handlers: { "assets.generate": handler },
    });

    const result = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 事务提交（服务返回）后、显式派发前：provider 零调用
    expect(submitCount).toBe(0);

    const dispatch = await dispatcher.dispatch(result.value.run.id);
    expect(dispatch.dispatched).toBe(true);
    expect(submitCount).toBe(1);
    const run = app.db.generationRuns.get(result.value.run.id)!;
    expect(run.status).toBe("succeeded");
    expect(run.dispatchLeaseOwner).toBeNull();
  });
});

describe("generation run submit transaction (Prisma mode)", () => {

  it("commits snapshot + pending run in one transaction", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const result = await createOrRestoreGenerationRun(
      db, project, "u1",
      submitInput({ idempotencyKey: "tx-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshotCount = await client.runConfigurationSnapshot.count({ where: { projectId: project.id } });
    expect(snapshotCount).toBe(1);
    const run = await client.generationRun.findUnique({ where: { id: result.value.run.id } });
    expect(run?.status).toBe("pending_dispatch");
  });

  it("rolls back snapshot and run together when the transaction fails", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    // 持久化失败（DB 不可用）：服务层捕获为 persistence_failed，无半成品落库
    const failingRepo = {
      ...repository,
      createRunTransaction: () => Promise.reject(new Error("db unavailable")),
    };
    const result = await createOrRestoreGenerationRun(
      db, project, "u1",
      submitInput({ idempotencyKey: "tx-fail-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository: failingRepo },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("generation_run_persistence_failed");

    const snapshotCount = await client.runConfigurationSnapshot.count({ where: { projectId: project.id } });
    expect(snapshotCount).toBe(0);
    const runCount = await client.generationRun.count({ where: { projectId: project.id } });
    expect(runCount).toBe(0);
  });

  it("enforces the unique (projectId, operation, idempotencyKey) constraint as the final defense", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const first = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "uniq-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);

    // 同一 key 不同 payload（selection 变化）：指纹不同 → 409
    const conflict = await createOrRestoreGenerationRun(
      db, project, "u1",
      submitInput({ idempotencyKey: "uniq-key-1", selection: { task_ids: ["task_img_001"] } }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("generation_idempotency_payload_conflict");
  });
});

describe("generation run idempotency edge cases (review round 1 fixes)", () => {
  it("concurrent same-key same-payload submits both succeed and return the same run (loser restores)", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();
    const deps = { readinessInput: buildQuotableReadinessInput(), repository };
    const [first, second] = await Promise.all([
      createOrRestoreGenerationRun(app.db, project, project.ownerId, submitInput({ idempotencyKey: "race-key-1" }), deps),
      createOrRestoreGenerationRun(app.db, project, project.ownerId, submitInput({ idempotencyKey: "race-key-1" }), deps),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // 败者返回与胜者相同的 run（幂等恢复）
    expect(second.value.run.id).toBe(first.value.run.id);
    expect(second.value.created).toBe(false);
    expect([...app.db.generationRuns.values()].length).toBe(1);
  });
});

describe("generation run cross-process idempotency (Prisma DB as authority, final review fixes)", () => {
  it("replay with stale in-memory mirror returns the same run from the database", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const first = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "cross-proc-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 模拟另一进程提交后本进程内存镜像未同步：清空本地镜像（run 与 snapshot 都清，
    // 覆盖冷镜像进程场景——重放路径的快照查找必须同样走 DB）
    db.generationRuns.clear();
    db.runConfigurationSnapshots.clear();
    const replay = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "cross-proc-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.created).toBe(false);
    expect(replay.value.run.id).toBe(first.value.run.id);
    // 镜像已从 DB 同步回
    expect(db.generationRuns.get(first.value.run.id)).not.toBeUndefined();
  });

  it("two dispatchers racing on the same run in Prisma mode: only one wins the atomic lease", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "prisma-race-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;
    // 清空镜像，让两个 dispatcher 都从 DB 读到 pending run
    db.generationRuns.clear();

    const calls = { submit: 0 };
    const dispatcherA = createGenerationRunDispatcher({
      db, repository, workerId: "prisma-A", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const dispatcherB = createGenerationRunDispatcher({
      db, repository, workerId: "prisma-B", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const [resultA, resultB] = await Promise.all([
      dispatcherA.dispatch(runId),
      dispatcherB.dispatch(runId),
    ]);
    expect(resultA.dispatched || resultB.dispatched).toBe(true);
    expect([resultA, resultB].filter((r) => r.dispatched).length).toBe(1);
    expect(calls.submit).toBe(1);

    const dbRun = await client.generationRun.findUnique({ where: { id: runId } });
    expect(dbRun?.status).toBe("succeeded");
    expect(dbRun?.dispatchClaimCount).toBe(1);
  });
});

describe("generation run Prisma-mode sweep scans the database (final review fixes)", () => {
  it("takes over a pending run created by another process (cold in-memory mirror)", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "db-scan-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;

    // 冷镜像：本进程没有任何 run/snapshot 镜像（另一进程创建的）
    db.generationRuns.clear();
    db.runConfigurationSnapshots.clear();

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db, repository, workerId: "db-scan-worker", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    // 低频 sweep 的显式 tick：从 DB 扫描 pending run 并接管
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(1);
    expect(calls.submit).toBe(1);
    const dbRun = await client.generationRun.findUnique({ where: { id: runId } });
    expect(dbRun?.status).toBe("succeeded");
  });

  it("Prisma-mode sweep skips needs_reconciliation runs from the database", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "db-scan-key-2" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;
    // 直接置为 needs_reconciliation 并清镜像
    await client.generationRun.update({ where: { id: runId }, data: { status: "needs_reconciliation" } });
    db.generationRuns.clear();
    db.runConfigurationSnapshots.clear();

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db, repository, workerId: "db-scan-worker", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(0);
    expect(calls.submit).toBe(0);
    const dbRun = await client.generationRun.findUnique({ where: { id: runId } });
    expect(dbRun?.status).toBe("needs_reconciliation");
  });
});

describe("cold-mirror submit and cost reads with DB as authority (external review N1/F1 fixes)", () => {
  it("cost read APIs read from the database when the in-memory mirror is cold", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "cold-cost-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;

    // 清空全部相关镜像（snapshots/runs）
    db.runConfigurationSnapshots.clear();
    db.generationRuns.clear();

    const { getRunConfiguration, getProjectCostSummary } = await import("../../../backend/src/modules/generation-cost/generation-cost.service.js");
    const config = await getRunConfiguration(db, project.id, runId, client);
    expect(config).not.toBeNull();
    expect(config?.run_id).toBe(runId);
    expect(config?.run_status).toBe("pending_dispatch");
    expect(config?.configuration_hash).toBeTruthy();

    const summary = await getProjectCostSummary(db, project.id, client);
    expect(summary.run_count).toBe(1);
    expect(summary.run_status_counts.pending_dispatch).toBe(1);
  });
});

describe("cold-mirror cost records association (N4 fix)", () => {
  it("costs/records restores run_id/run_status/operation from the database when the mirror is cold", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "cold-records-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;

    // 写入一条 usage record（任务 9A 才生产，这里直接落库模拟）
    const snapshot = db.runConfigurationSnapshots.get(submit.value.snapshot.id)!;
    await client.usageCostRecord.create({
      data: {
        id: "usage-cold-1",
        runConfigurationSnapshotId: snapshot.id,
        assetProviderJobRecordId: null,
        interactionId: null,
        capability: "image.generate",
        providerKey: "dashscope",
        modelId: "wan2.6-t2i",
        providerRequestKey: "intent-cold-1",
        attemptIndex: 0,
        status: "succeeded",
        unitType: "image",
        inputUnits: 1,
        outputUnits: 1,
        estimatedCostMicros: "200000",
        actualCostMicros: "200000",
        costBasis: "provider_usage",
        durationMs: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // 冷镜像：清空全部相关镜像
    db.runConfigurationSnapshots.clear();
    db.generationRuns.clear();
    db.usageCostRecords.clear();

    const { listProjectCostRecords } = await import("../../../backend/src/modules/generation-cost/generation-cost.service.js");
    const records = await listProjectCostRecords(db, project.id, client);
    expect(records.length).toBe(1);
    const record = records[0]!;
    // 关联字段从 DB 恢复，而非降级为 null/unknown
    expect(record.run_id).toBe(runId);
    expect(record.run_status).toBe("pending_dispatch");
    expect(record.operation).toBe("assets.generate");
    expect(record.estimated_cost_cny).toBe("0.200000");
    expect(record.actual_cost_cny).toBe("0.200000");
  });
});

describe("cross-process dispatch with cold project mirror (final review Important-1 fix)", () => {
  it("skips dispatch without marking the run failed when the project context is not in the mirror", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "cold-project-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;

    // 冷 project 镜像：sweep（DB 权威）发现 run，但本进程没有 project 上下文
    db.projects.clear();
    db.generationRuns.clear();

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db, repository, workerId: "cold-project-worker", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(0);
    expect(calls.submit).toBe(0);

    // run 未被误杀：仍在数据库中保持 pending_dispatch（可被持有 project 上下文的实例接管）
    const dbRun = await client.generationRun.findUnique({ where: { id: runId } });
    expect(dbRun?.status).toBe("pending_dispatch");
  });
});

describe("legacy in-flight runs are never taken over by sweep (final review C1 fix)", () => {
  it("a running run with null lease (legacy in-flight) is not claimed by scan or dispatch", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "legacy-run-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;

    // 模拟 legacy 在跑 run：running + 从未持有 lease（ensureAssetsGenerationRun 形状）
    await client.generationRun.update({
      where: { id: runId },
      data: { status: "running", dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null },
    });
    db.generationRuns.clear();
    db.runConfigurationSnapshots.clear();

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db, repository, workerId: "sweep-worker", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const scan = await dispatcher.scanAndDispatch();
    expect(scan.claimed).toBe(0);
    // 直接 dispatch 同样拒绝
    const direct = await dispatcher.dispatch(runId);
    expect(direct.dispatched).toBe(false);
    expect(calls.submit).toBe(0);
    // run 状态不被 sweep 改写（仍由原始执行者持有）
    const dbRun = await client.generationRun.findUnique({ where: { id: runId } });
    expect(dbRun?.status).toBe("running");
    expect(dbRun?.dispatchClaimCount).toBe(0);
  });

  it("a running run whose lease expired IS taken over (claim semantics unchanged)", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();
    const submitResult = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput({ idempotencyKey: "expired-lease-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submitResult.ok) throw new Error("submit failed");
    const run = submitResult.value.run;
    // 已 claim 且 lease 过期的 running run 仍可接管
    const expired: typeof run = {
      ...run, status: "running", dispatchLeaseOwner: "dead-worker",
      dispatchLeaseExpiresAt: new Date(Date.now() - 5000), dispatchClaimCount: 1,
    };
    app.db.generationRuns.set(run.id, expired);
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "takeover-worker", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => ({ status: "succeeded" as const }) },
    });
    const result = await dispatcher.dispatch(run.id);
    expect(result.dispatched).toBe(true);
    expect(app.db.generationRuns.get(run.id)!.dispatchClaimCount).toBe(2);
  });
});

describe("Prisma concurrent same-key loser recovers the winner run (final review I1 fix)", () => {
  it("run-conflict transaction abort re-queries run-by-key and restores the same run", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();

    // 胜者先行提交（同 key 同 payload）
    const winner = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput({ idempotencyKey: "race-loser-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!winner.ok) throw new Error("winner failed");

    // 模拟败者（并发时序）：预检查 miss，事务内撞唯一约束（run_conflict）中止；
    // 中止后回查能看到已提交的胜者 run。
    let runByKeyCalls = 0;
    const loserRepo = {
      ...repository,
      getRunByKey: async () => {
        runByKeyCalls += 1;
        // 第一次（预检查）：胜者不可见；第二次（中止后回查）：胜者已提交
        return runByKeyCalls === 1 ? null : winner.value.run;
      },
      createRunTransaction: () => Promise.resolve({ ok: false as const, error: { code: "generation_run_conflict" as const, existing: winner.value.run } }),
    };
    const loser = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput({ idempotencyKey: "race-loser-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository: loserRepo },
    );
    // 败者经事务外回查恢复胜者 run
    expect(loser.ok).toBe(true);
    if (!loser.ok) return;
    expect(loser.value.created).toBe(false);
    expect(loser.value.run.id).toBe(winner.value.run.id);
  });
});

describe("needs_reconciliation terminal state protection (final review I-1 fix)", () => {
  it("a late finalize cannot overwrite needs_reconciliation with failed/succeeded", async () => {
    const { app, project, repository } = await prepareMapSubmitContext();
    const submit = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput({ idempotencyKey: "recon-protect-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    const runId = submit.value.run.id;

    // handler 判定结果不确定 → needs_reconciliation 终态
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-recon", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => ({ status: "needs_reconciliation" as const, reason_code: "remote_state_uncertain", message: "unknown" }) },
    });
    const first = await dispatcher.dispatch(runId);
    expect(first.dispatched).toBe(true);
    expect(app.db.generationRuns.get(runId)!.status).toBe("needs_reconciliation");

    // 迟到的 finalize（如另一 dispatcher 的 outcome 或内部收尾）尝试写 failed/succeeded
    const lateFailed = await repository.updateRunStatus(runId, "failed", { releaseLease: true, now: new Date() });
    expect(lateFailed?.status).toBe("needs_reconciliation");
    const lateSucceeded = await repository.updateRunStatus(runId, "succeeded", { releaseLease: true, now: new Date() });
    expect(lateSucceeded?.status).toBe("needs_reconciliation");
    expect(app.db.generationRuns.get(runId)!.status).toBe("needs_reconciliation");
  });

  it("Prisma mode: needs_reconciliation row is not overwritten in the database", async () => {
    const { client, db, project, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput({ idempotencyKey: "recon-protect-2" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error("submit failed");
    await repository.claimRun(submit.value.run.id, "w", new Date(Date.now() + 30_000), new Date());
    await repository.updateRunStatus(submit.value.run.id, "needs_reconciliation", { releaseLease: true, now: new Date() });
    const blocked = await repository.updateRunStatus(submit.value.run.id, "failed", { releaseLease: true, now: new Date() });
    expect(blocked?.status).toBe("needs_reconciliation");
    const dbRun = await client.generationRun.findUnique({ where: { id: submit.value.run.id } });
    expect(dbRun?.status).toBe("needs_reconciliation");
  });
});
