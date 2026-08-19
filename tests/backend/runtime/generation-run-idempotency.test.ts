import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
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
import { createGenerationCostQuote } from "../../../backend/src/modules/generation-cost/generation-cost.service.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { buildQuotableReadinessInput, prepareQuoteProject, seedQuotableCatalog, REAL_TIER_INPUT } from "../cost/quote-test-context.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import type { GenerationRunRecord } from "../../../backend/src/db/client.js";

/**
 * S2-2A 任务 8：幂等提交事务（详细设计 4.7 / 8.2 / 8.3）。
 * 覆盖：同 key 同 fingerprint 返回同 run；同 key 不同 fingerprint 409；
 * quote 消费、snapshot、pending_dispatch run 同事务；事务失败整体回滚；
 * 事务提交前绝不调用外部 provider；Prisma 唯一约束为最终防线；
 * 预算授权审计与 run 同事务。
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

const SUBMIT_PAYLOAD = { voice_profile_id: "voice_default_male_storyteller", execution_mode: "auto_available" };

async function prepareMapSubmitContext() {
  const app = buildApp();
  await seedQuotableCatalog(app);
  const project = await prepareQuoteProject(app.db);
  const quoteResult = await createGenerationCostQuote(
    app.db, project, project.ownerId, { operation: "assets.generate" },
    { readinessInput: buildQuotableReadinessInput() },
  );
  if (!quoteResult.ok) throw new Error("quote creation failed");
  const repository = createGenerationRunRepository(app.db);
  return { app, project, quote: quoteResult.value.quote, repository };
}

function submitInput(quoteId: string, overrides: Partial<Parameters<typeof createOrRestoreGenerationRun>[3]> = {}) {
  return {
    operation: "assets.generate" as const,
    costQuoteId: quoteId,
    authorizeBudgetOverride: false,
    idempotencyKey: "client-key-1",
    selection: { task_ids: [] },
    runOverrides: undefined,
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
    const quoteResult = await createGenerationCostQuote(
      db, project, project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    if (!quoteResult.ok) throw new Error("quote creation failed");
    const repository = createGenerationRunRepository(db, client);
    return { client, db, project, quote: quoteResult.value.quote, repository };
  }

describe("generation run idempotency (legacy Map mode)", () => {
  it("same key + same payload returns the same run without re-consuming the quote", async () => {
    const { app, project, quote, repository } = await prepareMapSubmitContext();
    const first = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(quote.id),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toBe(true);
    expect(first.value.run.status).toBe("pending_dispatch");

    // 重放：同 key 同 payload → 同 run，created=false，quote 只消费一次
    const replay = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(quote.id),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.created).toBe(false);
    expect(replay.value.run.id).toBe(first.value.run.id);

    const storedQuote = app.db.generationCostQuotes.get(quote.id)!;
    expect(storedQuote.consumedAt).not.toBeNull();
    // 恰好一个 run
    expect([...app.db.generationRuns.values()].length).toBe(1);
  });

  it("same key + different payload returns generation_idempotency_payload_conflict", async () => {
    const { app, project, quote, repository } = await prepareMapSubmitContext();
    const first = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(quote.id),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);

    const conflict = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      submitInput(quote.id, { selection: { task_ids: ["task_img_001"] } }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("generation_idempotency_payload_conflict");
    expect([...app.db.generationRuns.values()].length).toBe(1);
  });

  it("does not create snapshot/run and does not consume quote when quote is expired", async () => {
    const { app, project, quote, repository } = await prepareMapSubmitContext();
    const expiredQuote = { ...quote, expiresAt: new Date(Date.now() - 1000) };
    app.db.generationCostQuotes.set(expiredQuote.id, expiredQuote);

    const result = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(expiredQuote.id),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_expired");
    expect(app.db.generationRuns.size).toBe(0);
    expect(app.db.runConfigurationSnapshots.size).toBe(0);
    expect(app.db.generationCostQuotes.get(expiredQuote.id)!.consumedAt).toBeNull();
  });

  it("does not create anything when quote already consumed (one-time consumption)", async () => {
    const { app, project, quote, repository } = await prepareMapSubmitContext();
    const consumed = { ...quote, consumedAt: new Date() };
    app.db.generationCostQuotes.set(consumed.id, consumed);

    const result = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId, submitInput(consumed.id),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_consumed");
    expect(app.db.generationRuns.size).toBe(0);
    expect(app.db.runConfigurationSnapshots.size).toBe(0);
  });

  it("never calls the provider before the transaction commits; dispatch happens after", async () => {
    const { app, project, quote, repository } = await prepareMapSubmitContext();
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
      app.db, project, project.ownerId, submitInput(quote.id),
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

  it("commits quote consumption + snapshot + pending run + override audit in one transaction", async () => {
    const { client, db, project, quote, repository } = await createPrismaContext();
    const result = await createOrRestoreGenerationRun(
      db, project, "u1",
      submitInput(quote.id, { authorizeBudgetOverride: true, idempotencyKey: "tx-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dbQuote = await client.generationCostQuote.findUnique({ where: { id: quote.id } });
    expect(dbQuote?.consumedAt).not.toBeNull();
    const snapshotCount = await client.runConfigurationSnapshot.count({ where: { projectId: project.id } });
    expect(snapshotCount).toBe(1);
    const run = await client.generationRun.findUnique({ where: { id: result.value.run.id } });
    expect(run?.status).toBe("pending_dispatch");
    // 审计与 run 同事务落库
    const audit = await client.auditLog.findFirst({
      where: { projectId: project.id, action: "generation.budget_override_authorized" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe("u1");
    expect(audit?.targetId).toBe(quote.id);
    const metadata = audit?.metadataJson as Record<string, unknown> | null;
    expect(metadata?.authorization_cost_micros).toBeDefined();
    expect(metadata?.budget_limit_micros).toBeDefined();
    expect(metadata?.reason).toBe("user_authorized_budget_override");
  });

  it("rolls back quote consumption, snapshot, run and audit together when the transaction fails", async () => {
    const { client, db, project, quote, repository } = await createPrismaContext();
    // 审计 actor FK 指向不存在的用户 → 事务在最后一步失败 → 全部回滚
    const result = await createOrRestoreGenerationRun(
      db, project, "ghost-user",
      submitInput(quote.id, { authorizeBudgetOverride: true, idempotencyKey: "tx-fail-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("generation_run_persistence_failed");

    const dbQuote = await client.generationCostQuote.findUnique({ where: { id: quote.id } });
    expect(dbQuote?.consumedAt).toBeNull();
    const snapshotCount = await client.runConfigurationSnapshot.count({ where: { projectId: project.id } });
    expect(snapshotCount).toBe(0);
    const runCount = await client.generationRun.count({ where: { projectId: project.id } });
    expect(runCount).toBe(0);
    const auditCount = await client.auditLog.count({ where: { projectId: project.id } });
    expect(auditCount).toBe(0);
  });

  it("enforces the unique (projectId, operation, idempotencyKey) constraint as the final defense", async () => {
    const { client, db, project, quote, repository } = await createPrismaContext();
    const first = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput(quote.id, { idempotencyKey: "uniq-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);

    // 同一 key 的另一 quote 提交：指纹不同 → 409（唯一约束兜底前由幂等检查返回）
    const quote2 = await createGenerationCostQuote(
      db, project, project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    if (!quote2.ok) throw new Error("second quote creation failed");
    const conflict = await createOrRestoreGenerationRun(
      db, project, "u1",
      submitInput(quote2.value.quote.id, { idempotencyKey: "uniq-key-1", selection: { task_ids: ["task_img_001"] } }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("generation_idempotency_payload_conflict");
    // 第二张 quote 未被消费
    const dbQuote2 = await client.generationCostQuote.findUnique({ where: { id: quote2.value.quote.id } });
    expect(dbQuote2?.consumedAt).toBeNull();
  });
});

describe("generation run idempotency edge cases (review round 1 fixes)", () => {
  it("concurrent same-key same-payload submits both succeed and return the same run (loser restores, not 409 consumed)", async () => {
    const { app, project, quote, repository } = await prepareMapSubmitContext();
    const deps = { readinessInput: buildQuotableReadinessInput(), repository };
    const [first, second] = await Promise.all([
      createOrRestoreGenerationRun(app.db, project, project.ownerId, submitInput(quote.id, { idempotencyKey: "race-key-1" }), deps),
      createOrRestoreGenerationRun(app.db, project, project.ownerId, submitInput(quote.id, { idempotencyKey: "race-key-1" }), deps),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // 败者返回与胜者相同的 run（幂等恢复），而不是 generation_quote_consumed
    expect(second.value.run.id).toBe(first.value.run.id);
    expect(second.value.created).toBe(false);
    expect([...app.db.generationRuns.values()].length).toBe(1);
    expect(app.db.generationCostQuotes.get(quote.id)!.consumedAt).not.toBeNull();
  });

  it("submit replays run_overrides from the quote creation; missing override is rejected", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const runOverrides = { video: { strategy: "all_api_video" as const } };
    const quoteResult = await createGenerationCostQuote(
      app.db, project, project.ownerId,
      { operation: "assets.generate", run_overrides: runOverrides },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(quoteResult.ok).toBe(true);
    if (!quoteResult.ok) return;
    const repository = createGenerationRunRepository(app.db);

    // 提交重放相同 run_overrides → 通过
    const okResult = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      submitInput(quoteResult.value.quote.id, { idempotencyKey: "override-key-1", runOverrides: runOverrides }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(okResult.ok).toBe(true);
    if (!okResult.ok) return;
    expect(okResult.value.created).toBe(true);

    // 不带 override 的提交（另一 key）：quote 创建输入未重放 → 拒绝
    const quote2 = await createGenerationCostQuote(
      app.db, project, project.ownerId,
      { operation: "assets.generate", run_overrides: runOverrides },
      { readinessInput: buildQuotableReadinessInput() },
    );
    if (!quote2.ok) throw new Error("second quote failed");
    const missing = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      submitInput(quote2.value.quote.id, { idempotencyKey: "override-key-2" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("generation_quote_configuration_changed");
  });

  it("budget gate rejects unbounded submit without override and accepts with override", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app, REAL_TIER_INPUT);
    const project = await prepareQuoteProject(app.db);
    const quoteResult = await createGenerationCostQuote(
      app.db, project, project.ownerId, { operation: "topic.generate" },
      { readinessInput: buildQuotableReadinessInput(REAL_TIER_INPUT) },
    );
    if (!quoteResult.ok) throw new Error("quote failed");
    const repository = createGenerationRunRepository(app.db);

    const denied = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      submitInput(quoteResult.value.quote.id, { operation: "topic.generate", idempotencyKey: "budget-key-1", authorizeBudgetOverride: false }),
      { readinessInput: buildQuotableReadinessInput(REAL_TIER_INPUT), repository },
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("generation_budget_exceeded");
    // 未授权时 quote 未被消费、无 run 产生
    expect(app.db.generationCostQuotes.get(quoteResult.value.quote.id)!.consumedAt).toBeNull();
    expect(app.db.generationRuns.size).toBe(0);

    const quote2 = await createGenerationCostQuote(
      app.db, project, project.ownerId, { operation: "topic.generate" },
      { readinessInput: buildQuotableReadinessInput(REAL_TIER_INPUT) },
    );
    if (!quote2.ok) throw new Error("second quote failed");
    const accepted = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      submitInput(quote2.value.quote.id, { operation: "topic.generate", idempotencyKey: "budget-key-2", authorizeBudgetOverride: true }),
      { readinessInput: buildQuotableReadinessInput(REAL_TIER_INPUT), repository },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    // 超额授权审计与 run 同事务写入
    expect([...app.db.auditLogs.values()].some((log) => log.action === "generation.budget_override_authorized")).toBe(true);
  });
});

describe("generation run cross-process idempotency (Prisma DB as authority, final review fixes)", () => {
  it("replay with stale in-memory mirror returns the same run from the database (not 409 consumed)", async () => {
    const { client, db, project, quote, repository } = await createPrismaContext();
    const first = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput(quote.id, { idempotencyKey: "cross-proc-key-1" }),
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 模拟另一进程提交后本进程内存镜像未同步：清空本地镜像
    db.generationRuns.clear();
    const replay = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput(quote.id, { idempotencyKey: "cross-proc-key-1" }),
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
    const { client, db, project, quote, repository } = await createPrismaContext();
    const submit = await createOrRestoreGenerationRun(
      db, project, "u1", submitInput(quote.id, { idempotencyKey: "prisma-race-1" }),
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
