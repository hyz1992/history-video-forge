import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import {
  createGenerationRunDispatcher,
  type GenerationRunDispatchHandler,
} from "../../../backend/src/modules/generation-run/generation-run-dispatcher.js";
import { buildQuotableReadinessInput, prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";
import type { GenerationRunRecord } from "../../../backend/src/db/client.js";

/**
 * S2-2A 任务 8：dispatcher 恢复（详细设计 4.7）。
 * 覆盖：启动扫描 pending_dispatch；扫描 lease 过期 running；
 * 扫描与低频 sweep 都跳过 needs_reconciliation；
 * 崩溃 run 在 lease 到期前不被重复派发。
 */

function mutableClock() {
  let current = Date.now();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

async function createPendingRun(db: ReturnType<typeof buildApp>["db"], project: ReturnType<typeof prepareQuoteProject> extends Promise<infer T> ? T : never, key: string) {
  const repository = createGenerationRunRepository(db);
  const submit = await createOrRestoreGenerationRun(
    db, project, project.ownerId,
    {
      operation: "assets.generate",
      idempotencyKey: key,
      selection: { task_ids: [] },
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildQuotableReadinessInput(), repository },
  );
  if (!submit.ok) throw new Error("submit failed");
  return { run: submit.value.run, repository };
}

describe("generation run dispatcher recovery", () => {
  it("startup scan dispatches pending_dispatch runs (crash after commit, before dispatch)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await createPendingRun(app.db, project, "recover-pending-1");

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-startup", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(1);
    expect(calls.submit).toBe(1);
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.status).toBe("succeeded");
  });

  it("startup scan takes over runs whose lease expired", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await createPendingRun(app.db, project, "recover-expired-1");

    // 模拟上一次崩溃留下的 running + 已过期 lease
    const crashed: GenerationRunRecord = { ...run, status: "running", dispatchLeaseOwner: "dead-worker", dispatchLeaseExpiresAt: new Date(Date.now() - 5000), dispatchClaimCount: 1 };
    app.db.generationRuns.set(run.id, crashed);

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-startup", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(1);
    expect(calls.submit).toBe(1);
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.status).toBe("succeeded");
    expect(stored.dispatchLeaseOwner).toBeNull();
    expect(stored.dispatchClaimCount).toBe(2);
  });

  it("does not touch runs whose lease is still valid", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await createPendingRun(app.db, project, "recover-valid-1");

    const active: GenerationRunRecord = { ...run, status: "running", dispatchLeaseOwner: "alive-worker", dispatchLeaseExpiresAt: new Date(Date.now() + 20_000), dispatchClaimCount: 1 };
    app.db.generationRuns.set(run.id, active);

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-startup", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(0);
    expect(calls.submit).toBe(0);
  });

  it("scan and sweep skip needs_reconciliation runs", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await createPendingRun(app.db, project, "recover-recon-1");

    const reconciliation: GenerationRunRecord = { ...run, status: "needs_reconciliation", dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null, dispatchClaimCount: 1 };
    app.db.generationRuns.set(run.id, reconciliation);
    // 另加一个正常 pending run 验证扫描仍然工作
    const { run: pendingRun } = await createPendingRun(app.db, project, "recover-pending-2");

    const calls = { submit: 0 };
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-startup", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const result = await dispatcher.scanAndDispatch();
    expect(result.claimed).toBe(1);
    expect(calls.submit).toBe(1);
    expect(app.db.generationRuns.get(run.id)!.status).toBe("needs_reconciliation");
    expect(app.db.generationRuns.get(pendingRun.id)!.status).toBe("succeeded");
  });

  it("low-frequency sweep recovers lease-expired runs on explicit tick", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await createPendingRun(app.db, project, "recover-sweep-1");

    const clock = mutableClock();
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => ({ status: "succeeded" as const }) },
    });
    // 第一次 tick：claim 后模拟进程崩溃（handler 挂起）
    const neverResolve = new Promise<never>(() => {});
    const crashedDispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-crashed", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { await neverResolve; return { status: "succeeded" }; } },
    });
    void crashedDispatcher.dispatch(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.db.generationRuns.get(run.id)!.dispatchLeaseOwner).toBe("worker-crashed");

    // sweep tick：lease 未到期 → 不接管
    const tick1 = await dispatcher.scanAndDispatch();
    expect(tick1.claimed).toBe(0);

    // 低频 sweep 的显式 tick：lease 已到期 → 接管并完成
    clock.advance(31_000);
    const tick2 = await dispatcher.scanAndDispatch();
    expect(tick2.claimed).toBe(1);
    expect(app.db.generationRuns.get(run.id)!.status).toBe("succeeded");
  });
});
