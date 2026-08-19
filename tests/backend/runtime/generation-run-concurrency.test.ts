import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import {
  createGenerationRunDispatcher,
  type GenerationRunDispatchHandler,
} from "../../../backend/src/modules/generation-run/generation-run-dispatcher.js";
import { createGenerationCostQuote } from "../../../backend/src/modules/generation-cost/generation-cost.service.js";
import { buildQuotableReadinessInput, prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";
import type { GenerationRunRecord } from "../../../backend/src/db/client.js";

/**
 * S2-2A 任务 8：dispatcher 并发与 lease 合同（详细设计 4.7）。
 * 覆盖：两个 dispatcher 并发争抢同一 run 只有一个获得 lease；
 * provider submit 只发生一次；lease 未到期不重复派发；
 * lease 到期后接管；needs_reconciliation 禁止自动二次提交；
 * 外部 call intent 以稳定 request key 判重。
 */

/** 带 intent 判重的 fake provider handler：同一 run 只允许一次 submit。 */
function makeIntentHandler(spy: { submit: () => void; poll: () => void }): GenerationRunDispatchHandler {
  const submitted = new Set<string>();
  return async (run) => {
    const intentKey = `intent:${run.id}:${run.operation}`;
    if (submitted.has(intentKey)) {
      // 重复 intent：只能轮询已有 provider job，不能再次 submit
      spy.poll();
      return { status: "succeeded" };
    }
    submitted.add(intentKey);
    spy.submit();
    return { status: "succeeded" };
  };
}

function mutableClock() {
  let current = Date.now();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}

async function prepareRun(db: ReturnType<typeof buildApp>["db"], project: ReturnType<typeof prepareQuoteProject> extends Promise<infer T> ? T : never) {
  const quoteResult = await createGenerationCostQuote(
    db, project, project.ownerId, { operation: "assets.generate" },
    { readinessInput: buildQuotableReadinessInput() },
  );
  if (!quoteResult.ok) throw new Error("quote creation failed");
  const repository = createGenerationRunRepository(db);
  const submit = await createOrRestoreGenerationRun(
    db, project, project.ownerId,
    {
      operation: "assets.generate",
      costQuoteId: quoteResult.value.quote.id,
      authorizeBudgetOverride: false,
      idempotencyKey: `run-${Math.random().toString(36).slice(2)}`,
      selection: { task_ids: [] },
      runOverrides: undefined,
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildQuotableReadinessInput(), repository },
  );
  if (!submit.ok) throw new Error("submit failed");
  return { run: submit.value.run, repository };
}

describe("generation run dispatcher concurrency", () => {
  it("only one of two dispatchers wins the atomic lease; provider submits exactly once", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await prepareRun(app.db, project);

    const calls = { submit: 0, poll: 0 };
    const handler = makeIntentHandler({
      submit: () => { calls.submit += 1; },
      poll: () => { calls.poll += 1; },
    });
    const clock = mutableClock();
    const dispatcherA = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": handler },
    });
    const dispatcherB = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-B", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": handler },
    });

    const [resultA, resultB] = await Promise.all([
      dispatcherA.dispatch(run.id),
      dispatcherB.dispatch(run.id),
    ]);
    expect(resultA.dispatched || resultB.dispatched).toBe(true);
    const claimed = [resultA, resultB].filter((r) => r.dispatched);
    expect(claimed.length).toBe(1);
    expect(calls.submit).toBe(1);
    expect(calls.poll).toBe(0);

    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.dispatchClaimCount).toBe(1);
    expect(stored.status).toBe("succeeded");
    expect(stored.dispatchLeaseOwner).toBeNull();
  });

  it("does not re-dispatch while the lease is held (not expired)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await prepareRun(app.db, project);

    const calls = { submit: 0 };
    const clock = mutableClock();
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const dispatcherB = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-B", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });

    // 第一个 dispatcher 模拟崩溃：claim 后 handler 卡住（不完成）
    let releaseHandler: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const dispatcherCrashed = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-crashed", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { await gate; return { status: "succeeded" }; } },
    });
    const crashDispatch = dispatcherCrashed.dispatch(run.id);
    // 等 claim 生效（handler 进入等待）
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.dispatchLeaseOwner).toBe("worker-crashed");
    expect(stored.status).toBe("running");

    // lease 未到期：其他 worker 不得接管（不重复派发）
    const attempt = await dispatcher.dispatch(run.id);
    expect(attempt.dispatched).toBe(false);
    if (!attempt.dispatched) expect(attempt.reason).toBe("lease_held");
    expect(calls.submit).toBe(0);

    // 释放崩溃 handler → 原 worker 完成
    releaseHandler!();
    await crashDispatch;
    expect(calls.submit).toBe(0);
    expect(app.db.generationRuns.get(run.id)!.status).toBe("succeeded");
  });

  it("another worker can take over only after the lease expires", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await prepareRun(app.db, project);

    const calls = { submit: 0 };
    const clock = mutableClock();
    const dispatcherA = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });
    const dispatcherB = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-B", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { calls.submit += 1; return { status: "succeeded" }; } },
    });

    // worker-A 崩溃：claim 成功但 handler 永不返回（模拟进程死亡）
    const neverResolve = new Promise<never>(() => {});
    let dispatcherCrashed: ReturnType<typeof createGenerationRunDispatcher>;
    dispatcherCrashed = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-crashed", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": async () => { await neverResolve; return { status: "succeeded" }; } },
    });
    void dispatcherCrashed.dispatch(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.db.generationRuns.get(run.id)!.dispatchLeaseOwner).toBe("worker-crashed");

    // 未到期：B 无法接管
    const early = await dispatcherB.dispatch(run.id);
    expect(early.dispatched).toBe(false);

    // lease 到期后：B 可接管并完成
    clock.advance(31_000);
    const late = await dispatcherB.dispatch(run.id);
    expect(late.dispatched).toBe(true);
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.dispatchLeaseOwner).toBeNull();
    expect(stored.status).toBe("succeeded");
    expect(stored.dispatchClaimCount).toBe(2);
    // A 的 handler 从未执行（claim 后即"死亡"），只有 B 执行了 submit
    expect(calls.submit).toBe(1);
  });

  it("marks needs_reconciliation and never auto re-submits when the provider result is uncertain", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await prepareRun(app.db, project);

    const calls = { submit: 0 };
    const clock = mutableClock();
    const handler: GenerationRunDispatchHandler = async () => {
      calls.submit += 1;
      // provider 不支持幂等且"远端已执行、本地未确认"
      return { status: "needs_reconciliation", reason_code: "remote_state_uncertain", message: "provider outcome unknown" };
    };
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000, now: clock.now,
      handlers: { "assets.generate": handler },
    });

    const first = await dispatcher.dispatch(run.id);
    expect(first.dispatched).toBe(true);
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.status).toBe("needs_reconciliation");
    expect(stored.dispatchLeaseOwner).toBeNull();
    expect(calls.submit).toBe(1);

    // 扫描与再次派发都跳过 needs_reconciliation
    const retry = await dispatcher.dispatch(run.id);
    expect(retry.dispatched).toBe(false);
    await dispatcher.scanAndDispatch();
    await dispatcher.scanAndDispatch();
    expect(calls.submit).toBe(1);
    expect(app.db.generationRuns.get(run.id)!.dispatchClaimCount).toBe(1);

    // lease 到期后仍然不自动重试
    clock.advance(60_000);
    await dispatcher.scanAndDispatch();
    expect(calls.submit).toBe(1);
  });

  it("a failed dispatch appends a run event and releases the lease", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await prepareRun(app.db, project);

    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => ({ status: "failed" as const, reason_code: "provider_rejected", message: "rejected" }) },
    });
    const result = await dispatcher.dispatch(run.id);
    expect(result.dispatched).toBe(true);
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.status).toBe("failed");
    expect(stored.dispatchLeaseOwner).toBeNull();
    const events = app.db.generationRunEvents.get(run.id) ?? [];
    expect(events.some((e) => e.eventType === "dispatch_failed")).toBe(true);
    expect(events[events.length - 1]!.eventJson).toMatchObject({ reason_code: "provider_rejected" });
  });
});
