import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { buildQuotableReadinessInput, prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";

/**
 * 任务 8 终审遗留 I-2（9A 步骤 0 收口）：updateRunStatus lease-owner fencing。
 *
 * 不变量：迟到的 finalize（来自已失去 lease 的 worker）不得覆盖接管者的
 * 状态、不得释放接管者的 lease。判定依据是 dispatchLeaseOwner 条件更新，
 * 而不是"run 存在即可写"。覆盖 Map 与 Prisma 两种实现、迟到成功/迟到失败
 * 两种 outcome、以及 fence 通过时正常写终态的正控。
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
  const directory = mkdtempSync(join(tmpdir(), "s2-2a-lease-fencing-"));
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

async function submitRun(
  db: ReturnType<typeof buildApp>["db"],
  project: Awaited<ReturnType<typeof prepareQuoteProject>>,
  key: string,
  prismaClient?: Awaited<ReturnType<typeof createPrismaClient>>,
) {
  const repository = createGenerationRunRepository(db, prismaClient);
  const submit = await createOrRestoreGenerationRun(
    db, project, project.ownerId,
    {
      operation: "assets.generate",
      idempotencyKey: key,
      selection: { task_ids: [] },
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildQuotableReadinessInput(), repository, prismaClient },
  );
  if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
  return { run: submit.value.run, repository };
}

describe("updateRunStatus lease-owner fencing (Map mode)", () => {
  it("a fenced updateRunStatus (owner mismatch) mutates nothing and returns null", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await submitRun(app.db, project, "fence-map-1");

    // worker-A 取得 lease
    const clock = { now: Date.now() };
    const claimed = await repository.claimRun(run.id, "worker-A", new Date(clock.now + 30_000), new Date(clock.now));
    expect(claimed).toBe(true);

    // worker-B（非 lease 持有者）不得改状态、不得释放 lease
    const fenced = await repository.updateRunStatus(run.id, "succeeded", {
      releaseLease: true,
      now: new Date(clock.now + 1000),
      expectedLeaseOwner: "worker-B",
    });
    expect(fenced).toBeNull();
    const stored = app.db.generationRuns.get(run.id)!;
    expect(stored.status).toBe("running");
    expect(stored.dispatchLeaseOwner).toBe("worker-A");
    expect(stored.dispatchLeaseExpiresAt).not.toBeNull();

    // lease 持有者本人可以正常写终态并释放 lease
    const owner = await repository.updateRunStatus(run.id, "succeeded", {
      releaseLease: true,
      now: new Date(clock.now + 2000),
      expectedLeaseOwner: "worker-A",
    });
    expect(owner?.status).toBe("succeeded");
    const after = app.db.generationRuns.get(run.id)!;
    expect(after.status).toBe("succeeded");
    expect(after.dispatchLeaseOwner).toBeNull();
    expect(after.dispatchLeaseExpiresAt).toBeNull();
  });

  it("a late finalize from the ORIGINAL owner still applies when the expired lease has not been taken over", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await submitRun(app.db, project, "fence-map-3");

    // worker-A claim 后 handler 挂起；lease 到期但无人接管
    let releaseHandler!: () => void;
    const gate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    const dispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-A", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { await gate; return { status: "succeeded" as const }; } },
    });
    const dispatchPromise = dispatcher.dispatch(run.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stored = app.db.generationRuns.get(run.id)!;
    stored.dispatchLeaseExpiresAt = new Date(Date.now() - 1); // lease 过期（未接管）

    // 原 owner 的迟到 finalize 仍生效：fencing 按 owner 身份判定，不是按租期——
    // 接管前唯一 owner 的终态写入合法（claim 的恢复条件保证接管者只会接手非终态 run）
    releaseHandler();
    await dispatchPromise;
    const final = app.db.generationRuns.get(run.id)!;
    expect(final.status).toBe("succeeded");
    expect(final.dispatchLeaseOwner).toBeNull();
    const events = app.db.generationRunEvents.get(run.id) ?? [];
    expect(events.some((event) => event.eventType === "dispatch_finalize_fenced_out")).toBe(false);
  });

  it("a late finalize from a stale worker cannot overwrite the new owner's state (dispatcher level)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    const { run, repository } = await submitRun(app.db, project, "fence-map-2");

    // worker-crashed claim 后 handler 挂起（模拟进程假死）
    let releaseCrashed!: () => void;
    const crashedGate = new Promise<void>((resolve) => { releaseCrashed = resolve; });
    let crashedDispatcherResolved = false;
    const crashedDispatcher = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-crashed", leaseDurationMs: 30_000,
      handlers: {
        "assets.generate": async () => {
          await crashedGate;
          return { status: "succeeded" as const };
        },
      },
    });
    void crashedDispatcher.dispatch(run.id).then(() => { crashedDispatcherResolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.db.generationRuns.get(run.id)!.dispatchLeaseOwner).toBe("worker-crashed");

    // lease 到期，worker-B 接管并完成
    const current = app.db.generationRuns.get(run.id)!;
    current.dispatchLeaseExpiresAt = new Date(Date.now() - 1);
    const takeoverCalls = { submit: 0 };
    const workerB = createGenerationRunDispatcher({
      db: app.db, repository, workerId: "worker-B", leaseDurationMs: 30_000,
      handlers: { "assets.generate": async () => { takeoverCalls.submit += 1; return { status: "failed" as const, reason_code: "provider_rejected", message: "rejected" }; } },
    });
    const takeover = await workerB.dispatch(run.id);
    expect(takeover.dispatched).toBe(true);
    const afterTakeover = app.db.generationRuns.get(run.id)!;
    expect(afterTakeover.status).toBe("failed");
    expect(afterTakeover.dispatchLeaseOwner).toBeNull();

    // 迟到的 crashed worker 现在 finalize（succeeded）——不得把 failed 改回 succeeded
    releaseCrashed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await Promise.race([
      (async () => { while (!crashedDispatcherResolved) await new Promise((r) => setTimeout(r, 5)); })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("crashed dispatcher did not settle")), 2000)),
    ]);
    const final = app.db.generationRuns.get(run.id)!;
    expect(final.status).toBe("failed");
    expect(final.dispatchLeaseOwner).toBeNull();
    // 迟到 finalize 被丢弃时有审计事件可查
    const events = app.db.generationRunEvents.get(run.id) ?? [];
    expect(events.some((event) => event.eventType === "dispatch_finalize_fenced_out")).toBe(true);
  });
});

describe("updateRunStatus lease-owner fencing (Prisma mode)", () => {
  async function createPrismaFencingContext() {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    openClients.push(client);
    await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
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
    await seedQuotableCatalog(app);
    const project = await createProject(app.db, { name: "T", ownerId: "u1" });
    return { client, db: app.db, project };
  }

  it("late finalize loses to the new lease owner in the database (not just the memory mirror)", async () => {
    const { client, db, project } = await createPrismaFencingContext();
    const { run, repository } = await submitRun(db, project, "fence-prisma-1", client);

    const claimed = await repository.claimRun(run.id, "worker-stale", new Date(Date.now() + 30_000), new Date());
    expect(claimed).toBe(true);

    // 数据库直接模拟接管：lease 到期后 worker-B 原子接管并写 running
    await client.generationRun.update({
      where: { id: run.id },
      data: {
        status: "running",
        dispatchLeaseOwner: "worker-B",
        dispatchLeaseExpiresAt: new Date(Date.now() + 30_000),
        dispatchClaimCount: { increment: 1 },
      },
    });

    // 失租 worker-stale 迟到 finalize：数据库层面不得生效
    const fenced = await repository.updateRunStatus(run.id, "succeeded", {
      releaseLease: true,
      now: new Date(),
      expectedLeaseOwner: "worker-stale",
    });
    expect(fenced).toBeNull();
    const dbRun = await client.generationRun.findUnique({ where: { id: run.id } });
    expect(dbRun?.status).toBe("running");
    expect(dbRun?.dispatchLeaseOwner).toBe("worker-B");
    expect(dbRun?.dispatchLeaseExpiresAt).not.toBeNull();

    // 新 owner 正常写终态
    const owner = await repository.updateRunStatus(run.id, "succeeded", {
      releaseLease: true,
      now: new Date(),
      expectedLeaseOwner: "worker-B",
    });
    expect(owner?.status).toBe("succeeded");
    const final = await client.generationRun.findUnique({ where: { id: run.id } });
    expect(final?.status).toBe("succeeded");
    expect(final?.dispatchLeaseOwner).toBeNull();
  });

  it("fencing does not weaken the needs_reconciliation terminal-state protection", async () => {
    const { client, db, project } = await createPrismaFencingContext();
    const { run, repository } = await submitRun(db, project, "fence-prisma-2", client);

    const claimed = await repository.claimRun(run.id, "worker-A", new Date(Date.now() + 30_000), new Date());
    expect(claimed).toBe(true);
    // 对账终态先行写入（迟到 finalize 场景的邻界组合）
    await client.generationRun.update({
      where: { id: run.id },
      data: { status: "needs_reconciliation" },
    });

    const stillOwned = await repository.updateRunStatus(run.id, "succeeded", {
      releaseLease: true,
      now: new Date(),
      expectedLeaseOwner: "worker-A",
    });
    // lease owner 匹配但 needs_reconciliation 是对账终态：默认禁止覆盖
    expect(stillOwned?.status).toBe("needs_reconciliation");
    const dbRun = await client.generationRun.findUnique({ where: { id: run.id } });
    expect(dbRun?.status).toBe("needs_reconciliation");

    // 显式授权（9A 对账工具专用）才能改写
    const overwritten = await repository.updateRunStatus(run.id, "failed", {
      releaseLease: true,
      now: new Date(),
      expectedLeaseOwner: "worker-A",
      allowOverwriteNeedsReconciliation: true,
    });
    expect(overwritten?.status).toBe("failed");
  });
 it.each(['succeeded','failed','needs_reconciliation'] as const)('Prisma 同 owner 迟到 %s 在 updateMany 条件内拒绝',async status=>{
  const {client,db,project}=await createPrismaFencingContext(),{run,repository}=await submitRun(db,project,'same-owner-'+status,client);await repository.claimRun(run.id,'same',new Date(Date.now()+30000),new Date());
  await client.generationRun.update({where:{id:run.id},data:{dispatchLeaseExpiresAt:new Date(Date.now()-1)}});await repository.claimRun(run.id,'same',new Date(Date.now()+60000),new Date());const expected=await client.generationRun.findUnique({where:{id:run.id}});
  const updateOriginal=client.generationRun.updateMany.bind(client.generationRun);const update=vi.spyOn(client.generationRun,'updateMany').mockImplementation(args=>updateOriginal(args));expect(await repository.updateRunStatus(run.id,status,{releaseLease:true,now:new Date(),expectedLeaseOwner:'same',expectedClaimCount:1})).toBeNull();expect(update.mock.calls[0][0].where).toMatchObject({dispatchLeaseOwner:'same',dispatchClaimCount:1});expect(await client.generationRun.findUnique({where:{id:run.id}})).toEqual(expected);
  expect(await repository.renewLease(run.id,'same',new Date(Date.now()+90000),new Date(),1)).toBe(false);expect(update.mock.calls.at(-1)![0].where).toMatchObject({dispatchLeaseOwner:'same',dispatchClaimCount:1});expect(await client.generationRun.findUnique({where:{id:run.id}})).toEqual(expected);
  expect(await repository.renewLease(run.id,'same',new Date(Date.now()+120000),new Date(),2)).toBe(true);expect(await repository.updateRunStatus(run.id,status,{releaseLease:true,now:new Date(),expectedLeaseOwner:'same',expectedClaimCount:2})).toMatchObject({status,dispatchClaimCount:2,dispatchLeaseOwner:null});update.mockRestore();
 });
 it('Prisma finalize 更新窗口内同 owner 接管仍由原子条件拒绝',async()=>{
  const {client,db,project}=await createPrismaFencingContext(),{run,repository}=await submitRun(db,project,'same-owner-window',client);await repository.claimRun(run.id,'same',new Date(Date.now()+30000),new Date());const original=client.generationRun.updateMany.bind(client.generationRun);let injected=false;const spy=vi.spyOn(client.generationRun,'updateMany').mockImplementation(async args=>{if(!injected){injected=true;await client.generationRun.update({where:{id:run.id},data:{dispatchClaimCount:{increment:1},dispatchLeaseExpiresAt:new Date(Date.now()+60000)}})}return original(args)});
  expect(await repository.updateRunStatus(run.id,'failed',{releaseLease:true,now:new Date(),expectedLeaseOwner:'same',expectedClaimCount:1})).toBeNull();expect(await client.generationRun.findUnique({where:{id:run.id}})).toMatchObject({status:'running',dispatchLeaseOwner:'same',dispatchClaimCount:2});spy.mockRestore();
 });

});


describe('口播 claim 身份冻结（Map）',()=>{
 it.each(['succeeded','failed','needs_reconciliation'] as const)('迟到 %s 不修改同/异 owner 新 claim',async status=>{
  for(const owner of ['worker','other']){
   const app=buildApp({skipSnapshotLoad:true});await seedQuotableCatalog(app);const project=await prepareQuoteProject(app.db);const {run,repository}=await submitRun(app.db,project,status+owner);run.operation='script.narration.generate';
   let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let handlerCount=0,captured:any;
   const dispatcher=createGenerationRunDispatcher({db:app.db,repository,workerId:'worker',leaseDurationMs:30000,handlers:{'script.narration.generate':async claimed=>{captured=claimed;handlerCount++;entered();await gate;return status==='succeeded'?{status}:{status,reason_code:'test_remote',message:'test'};}}});
   const pending=dispatcher.dispatch(run.id);await started;const stored=app.db.generationRuns.get(run.id)!;stored.dispatchLeaseExpiresAt=new Date(Date.now()-1);expect(await repository.claimRun(run.id,owner,new Date(Date.now()+60000),new Date())).toBe(true);const expected=structuredClone(stored);
   release();expect(await pending).toMatchObject({dispatched:true,fencedOut:true});expect(app.db.generationRuns.get(run.id)).toEqual(expected);expect(captured.dispatchClaimCount).toBe(1);expect(handlerCount).toBe(1);
   expect(await repository.renewLease(run.id,'worker',new Date(Date.now()+90000),new Date(),1)).toBe(false);expect(app.db.generationRuns.get(run.id)).toEqual(expected);
   expect(await repository.renewLease(run.id,owner,new Date(Date.now()+120000),new Date(),2)).toBe(true);expect(await repository.updateRunStatus(run.id,'succeeded',{releaseLease:true,now:new Date(),expectedLeaseOwner:owner,expectedClaimCount:2})).toMatchObject({status:'succeeded',dispatchClaimCount:2,dispatchLeaseOwner:null,dispatchLeaseExpiresAt:null});
  }
 });
 it('续租 timer 使用冻结 claim，不延长同 owner 接管租约',async()=>{
  const app=buildApp({skipSnapshotLoad:true});await seedQuotableCatalog(app);const project=await prepareQuoteProject(app.db);const {run,repository}=await submitRun(app.db,project,'renew-timer');run.operation='script.narration.generate';let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
  vi.useFakeTimers();try{const dispatcher=createGenerationRunDispatcher({db:app.db,repository,workerId:'worker',leaseDurationMs:100,handlers:{'script.narration.generate':async()=>{entered();await gate;return {status:'succeeded'}}}});const pending=dispatcher.dispatch(run.id);await started;run.dispatchLeaseExpiresAt=new Date(Date.now()-1);await repository.claimRun(run.id,'worker',new Date(Date.now()+10000),new Date());const expected=structuredClone(run);await vi.advanceTimersByTimeAsync(60);expect(run).toEqual(expected);release();await pending;}finally{release();vi.useRealTimers();}
 });
 it('claim 后再读之前接管，不得借新 token 执行旧 handler',async()=>{
  const app=buildApp({skipSnapshotLoad:true});await seedQuotableCatalog(app);const project=await prepareQuoteProject(app.db);const {run,repository}=await submitRun(app.db,project,'claim-read-window');run.operation='script.narration.generate';const claim=repository.claimRun;repository.claimRun=async(...args)=>{const ok=await claim(...args);if(ok){run.dispatchLeaseExpiresAt=new Date(Date.now()-1);await claim(run.id,'worker',new Date(Date.now()+60000),new Date());}return ok};const handler=vi.fn(async()=>({status:'succeeded' as const}));const dispatcher=createGenerationRunDispatcher({db:app.db,repository,workerId:'worker',leaseDurationMs:30000,handlers:{'script.narration.generate':handler}});
  expect(await dispatcher.dispatch(run.id)).toMatchObject({dispatched:false,reason:'fenced_out'});expect(handler).not.toHaveBeenCalled();expect(run).toMatchObject({status:'running',dispatchLeaseOwner:'worker',dispatchClaimCount:2});
 });
});
