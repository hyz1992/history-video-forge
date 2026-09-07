import { hashProjectNarrationTtsSettings } from "../../../../shared/src/index.js";
import { readNarrationSource } from "../narration/narration.repository.js";
import { hasPassingNarrationScriptValidation, narrationTextHash } from "../narration/narration-readiness.js";
import type {
  DbClient,
  GenerationRunEventRecord,
  GenerationRunRecord,
  RunConfigurationSnapshotRecord,
} from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

/**
 * S2-2 生成 run 事务 repository（2026-08-23 报价体系移除后简化版）。
 *
 * 生产激活态（Prisma）：snapshot 创建与 pending_dispatch run 创建在**同一个
 * 数据库事务**内完成；数据库唯一约束 (projectId, operation, idempotencyKey)
 * 是幂等的最终防线。事务提交前绝不调用外部 provider。
 *
 * legacy Map 态：用单进程锁 + 失败回滚模拟合同（先校验后变更，冲突返回错误），
 * 不把数据库事务跨到外部网络调用。claim/lease 操作为同步检查-设置（单线程内原子）。
 *
 * 用户面查询一律以已授权 projectId 为入口；dispatcher 内部按 runId 访问仅用于
 * 服务端恢复（非用户请求路径）。
 */

export interface CreateRunTransactionInput {
  snapshot: RunConfigurationSnapshotRecord;
  run: GenerationRunRecord;
  now: Date;
}

export type CreateRunTransactionResult =
  | { ok: true; run: GenerationRunRecord }
  | {
      ok: false;
      error:
        | { code: "generation_run_conflict"; existing: GenerationRunRecord }
        | { code: "generation_run_persistence_failed" };
    };

export interface GenerationRunRepository {
  /**
   * 原子创建 run 事务。唯一约束冲突（并发同 key 提交）返回
   * generation_run_conflict + existing，由服务层做幂等裁决。
   */
  createRunTransaction(input: CreateRunTransactionInput): Promise<CreateRunTransactionResult>;
  /**
   * 原子 claim：只有 status∈(pending_dispatch, running) 且 lease 已过期/未设置时成功，
   * 写 leaseOwner/leaseUntil 并递增 claimCount、置 running。可选expectedClaimCount在同一原子条件固定此次claim身份。
   * 返回 false = 未取得 lease。
   */
  claimRun(runId: string, workerId: string, leaseUntil: Date, now: Date, expectedClaimCount?: number): Promise<boolean>;
  /**
   * 续期 lease：只有 leaseOwner 仍是本 worker 时延长 leaseUntil（handler 执行期间
   * 防存活 worker 被其他 worker 接管重复派发）。提供expectedClaimCount时同时检查running及claim编号。
   * 返回 false = lease 已易主/丢失。
   */
  renewLease(runId: string, workerId: string, leaseUntil: Date, now: Date, expectedClaimCount?: number): Promise<boolean>;
  /**
   * 更新 run 状态；releaseLease=true 时清空 lease（终态）。
   * 不变量一：needs_reconciliation 是对账终态，默认禁止被覆盖（迟到的 finalize
   * 不得抹掉对账信号）；9A 对账工具如需改写传 allowOverwriteNeedsReconciliation。
   * 不变量二（任务 8 终审 I-2）：expectedLeaseOwner 提供时按 lease-owner 条件
   * 更新（fencing）——已失去 lease 的 worker 迟到 finalize 不得覆盖接管者
   * 状态、不得释放接管者 lease；owner 不匹配时不发生任何写入并返回 null。
   */
  updateRunStatus(
    runId: string,
    status: GenerationRunRecord["status"],
    options: {
      releaseLease: boolean;
      now: Date;
      allowOverwriteNeedsReconciliation?: boolean;
      expectedLeaseOwner?: string | null;
      /** 口播采用不可变claim身份；省略时保持旧operation的owner-only合同。 */
      expectedClaimCount?: number;
    },
  ): Promise<GenerationRunRecord | null>;
  appendRunEvent(record: GenerationRunEventRecord): Promise<void>;
  /**
   * 按 snapshotId 读取（服务端恢复路径专用：重放/冲突恢复需随 run 一次加载快照）。
   * 用户面读取仍以 projectId 为入口（generation-cost.repository）。
   */
  getSnapshotById(snapshotId: string): Promise<RunConfigurationSnapshotRecord | null>;
  /** 可恢复运行：pending_dispatch 或 lease 已过期；永远排除 needs_reconciliation。 */
  listRecoverableRuns(now: Date): Promise<GenerationRunRecord[]>;
  getRunById(runId: string): Promise<GenerationRunRecord | null>;
  getRunByKey(
    projectId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<GenerationRunRecord | null>;
  listRunsByProject(projectId: string): Promise<GenerationRunRecord[]>;
}

// --- 独立查询（供 cost service 等消费方使用） -------------------------------

/** 按 projectId 列出全部 run（创建时间升序）。prismaClient 传入时以数据库为权威。 */
export async function listRunsByProject(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<GenerationRunRecord[]> {
  if (prismaClient) {
    const rows = await prismaClient.generationRun.findMany({ where: { projectId } });
    const runs = rows.map(toRunRecord);
    for (const run of runs) syncRunToMemory(db, run);
    return runs.sort(compareRunByCreatedAt);
  }
  const runs: GenerationRunRecord[] = [];
  for (const run of db.generationRuns.values()) {
    if (run.projectId === projectId) runs.push(run);
  }
  return runs.sort(compareRunByCreatedAt);
}

function compareRunByCreatedAt(a: GenerationRunRecord, b: GenerationRunRecord): number {
  if (a.createdAt.getTime() < b.createdAt.getTime()) return -1;
  if (a.createdAt.getTime() > b.createdAt.getTime()) return 1;
  return 0;
}

// --- Map 模式锁 -------------------------------------------------------------

const projectLocks = new WeakMap<DbClient, Map<string, Promise<void>>>();

function withProjectLock<T>(db: DbClient, projectId: string, fn: () => Promise<T>): Promise<T> {
  let locks = projectLocks.get(db);
  if (!locks) {
    locks = new Map();
    projectLocks.set(db, locks);
  }
  const previous = locks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 存 gate 本身（不是链式 promise），finally 中可用恒等判断清理条目
  locks.set(projectId, gate);
  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(projectId) === gate) locks.delete(projectId);
    }
  });
}

// --- 内存态实现 -------------------------------------------------------------

function createMapRepository(db: DbClient): GenerationRunRepository {
  return {
    async createRunTransaction(input) {
      return withProjectLock(db, input.run.projectId, async () => {
        // 幂等裁决优先：并发同 key 提交的败者必须先看到已有 run（返回 conflict 由
        // 服务层按 fingerprint 裁决）。
        const existing = getRunByKeyMap(db, input.run.projectId, input.run.operation, input.run.idempotencyKey);
        if (existing) {
          return { ok: false, error: { code: "generation_run_conflict", existing } };
        }
        if (input.run.operation === "script.narration.generate") await validateNarrationSubmission(db, input);
        // 校验全部通过后才变更（失败回滚模拟：任何前置校验失败都不会留下半成品）
        db.runConfigurationSnapshots.set(input.snapshot.id, input.snapshot);
        db.generationRuns.set(input.run.id, input.run);
        return { ok: true, run: input.run };
      });
    },
    async claimRun(runId, workerId, leaseUntil, now, expectedClaimCount) {
      // 同步检查-设置：单线程内原子，等价于数据库条件更新（同一恢复条件）。
      const run = db.generationRuns.get(runId);
      if (!run) return false;
      if (!isRecoverableRun(run, now)) return false;
      if (expectedClaimCount !== undefined && run.dispatchClaimCount !== expectedClaimCount) return false;
      run.status = "running";
      run.dispatchLeaseOwner = workerId;
      run.dispatchLeaseExpiresAt = leaseUntil;
      run.dispatchClaimCount += 1;
      run.updatedAt = now;
      return true;
    },
    async renewLease(runId, workerId, leaseUntil, now, expectedClaimCount) {
      const run = db.generationRuns.get(runId);
      if (!run) return false;
      if (run.dispatchLeaseOwner !== workerId) return false;
      if (expectedClaimCount !== undefined && (run.dispatchClaimCount !== expectedClaimCount || run.status !== "running")) return false;
      run.dispatchLeaseExpiresAt = leaseUntil;
      run.updatedAt = now;
      return true;
    },
    async updateRunStatus(runId, status, options) {
      const run = db.generationRuns.get(runId);
      if (!run) return null;
      // fencing（I-2）：lease 已易主时迟到 finalize 不得写入（检查-设置，单线程内原子）
      if (options.expectedLeaseOwner !== undefined && run.dispatchLeaseOwner !== options.expectedLeaseOwner) {
        return null;
      }
      if (options.expectedClaimCount !== undefined && (run.dispatchClaimCount !== options.expectedClaimCount || run.status !== "running")) return null;
      if (run.status === "needs_reconciliation" && !options.allowOverwriteNeedsReconciliation) {
        return run;
      }
      run.status = status;
      if (options.releaseLease) {
        run.dispatchLeaseOwner = null;
        run.dispatchLeaseExpiresAt = null;
      }
      run.updatedAt = options.now;
      return run;
    },
    async appendRunEvent(record) {
      const events = db.generationRunEvents.get(record.generationRunId) ?? [];
      events.push(record);
      db.generationRunEvents.set(record.generationRunId, events);
    },
    async listRecoverableRuns(now) {
      const runs: GenerationRunRecord[] = [];
      for (const run of db.generationRuns.values()) {
        if (!isRecoverableRun(run, now)) continue;
        runs.push(run);
      }
      return runs;
    },
    // legacy Map 态：内存即存储（无数据库），镜像不会"未同步"。
    async getRunById(runId) {
      return db.generationRuns.get(runId) ?? null;
    },
    async getRunByKey(projectId, operation, idempotencyKey) {
      return getRunByKeyMap(db, projectId, operation, idempotencyKey);
    },
    async getSnapshotById(snapshotId) {
      return db.runConfigurationSnapshots.get(snapshotId) ?? null;
    },
    listRunsByProject(projectId) {
      return listRunsByProject(db, projectId);
    },
  };
}

/** 与 Prisma recoverableRunWhere 同一恢复条件（Map 态）。 */
function isRecoverableRun(run: GenerationRunRecord, now: Date): boolean {
  if (run.status === "pending_dispatch") {
    return run.dispatchLeaseExpiresAt === null || run.dispatchLeaseExpiresAt.getTime() < now.getTime();
  }
  if (run.status === "running") {
    // running 必须 lease 非 null 且已过期；lease=null 是 legacy 在跑 run，禁止接管
    return run.dispatchLeaseExpiresAt !== null && run.dispatchLeaseExpiresAt.getTime() < now.getTime();
  }
  return false;
}

function getRunByKeyMap(
  db: DbClient,
  projectId: string,
  operation: string,
  idempotencyKey: string,
): GenerationRunRecord | null {
  for (const run of db.generationRuns.values()) {
    if (
      run.projectId === projectId &&
      run.operation === operation &&
      run.idempotencyKey === idempotencyKey
    ) {
      return run;
    }
  }
  return null;
}

// --- Prisma 实现 ------------------------------------------------------------

/**
 * 可恢复 run 的权威条件（设计 4.7）：
 * - pending_dispatch（从未派发，或 lease 已过期）：lease 可空或已过期；
 * - running：必须 lease 非 null 且已过期（曾设置 lease 的 claim 过期接管）；
 *   running + lease=null 是 legacy 在跑 run，不属于派发协议，禁止接管。
 */
function recoverableRunWhere(now: Date) {
  return {
    OR: [
      { status: "pending_dispatch", dispatchLeaseExpiresAt: null },
      { status: "pending_dispatch", dispatchLeaseExpiresAt: { lt: now } },
      { status: "running", dispatchLeaseExpiresAt: { lt: now } },
    ],
  };
}

function toRunRecord(row: {
  id: string;
  projectId: string;
  userId: string | null;
  operation: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  quoteId: string | null;
  runConfigurationSnapshotId: string;
  dispatchPayloadJson: unknown;
  status: string;
  dispatchLeaseOwner: string | null;
  dispatchLeaseExpiresAt: Date | null;
  dispatchClaimCount: number;
  createdAt: Date;
  updatedAt: Date;
}): GenerationRunRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    operation: row.operation,
    idempotencyKey: row.idempotencyKey,
    payloadFingerprint: row.payloadFingerprint,
    quoteId: row.quoteId,
    runConfigurationSnapshotId: row.runConfigurationSnapshotId,
    dispatchPayloadJson: row.dispatchPayloadJson as Record<string, unknown>,
    status: row.status as GenerationRunRecord["status"],
    dispatchLeaseOwner: row.dispatchLeaseOwner,
    dispatchLeaseExpiresAt: row.dispatchLeaseExpiresAt,
    dispatchClaimCount: row.dispatchClaimCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function syncRunToMemory(db: DbClient, run: GenerationRunRecord): void {
  db.generationRuns.set(run.id, run);
}

function toSnapshotRecord(row: {
  id: string;
  projectId: string;
  userId: string | null;
  stage: string;
  operation: string;
  runId: string | null;
  projectConfigurationRevision: number;
  schemaVersion: string;
  configurationHash: string;
  resolvedConfigurationJson: unknown;
  resolutionTraceJson: unknown;
  quoteId: string | null;
  quoteFingerprint: string | null;
  estimatedCostMicros: string | null;
  authorizationCostMicros: string | null;
  containsUnboundedItem: boolean;
  budgetLimitMicros: string | null;
  budgetOverrideAuthorized: boolean;
  pricingHash: string | null;
  pricingVersionSetJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): RunConfigurationSnapshotRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    stage: row.stage,
    operation: row.operation,
    runId: row.runId,
    projectConfigurationRevision: row.projectConfigurationRevision,
    schemaVersion: row.schemaVersion,
    configurationHash: row.configurationHash,
    resolvedConfigurationJson: row.resolvedConfigurationJson as Record<string, unknown>,
    resolutionTraceJson: row.resolutionTraceJson as unknown[],
    quoteId: row.quoteId,
    quoteFingerprint: row.quoteFingerprint,
    estimatedCostMicros: row.estimatedCostMicros,
    authorizationCostMicros: row.authorizationCostMicros,
    containsUnboundedItem: row.containsUnboundedItem,
    budgetLimitMicros: row.budgetLimitMicros,
    budgetOverrideAuthorized: row.budgetOverrideAuthorized,
    pricingHash: row.pricingHash,
    pricingVersionSetJson: row.pricingVersionSetJson as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function createPrismaRepository(db: DbClient, client: AppPrismaClient): GenerationRunRepository {
  return {
    async createRunTransaction(input) {
      let conflictExisting: GenerationRunRecord | null = null;
      try {
        await client.$transaction(async (tx) => {
          // 幂等裁决优先：并发同 key 提交的败者必须先看到已有 run（RunConflictAbort
          // 中止事务，由服务层按 fingerprint 裁决）。
          const existing = await tx.generationRun.findUnique({
            where: {
              projectId_operation_idempotencyKey: {
                projectId: input.run.projectId,
                operation: input.run.operation,
                idempotencyKey: input.run.idempotencyKey,
              },
            },
          });
          if (existing) throw new RunConflictAbort(toRunRecord(existing));

          if (input.run.operation === "script.narration.generate") await validateNarrationSubmission(db, input, tx);
          // 1. 不可变 snapshot。
          await tx.runConfigurationSnapshot.create({
            data: {
              id: input.snapshot.id,
              projectId: input.snapshot.projectId,
              userId: input.snapshot.userId,
              stage: input.snapshot.stage,
              operation: input.snapshot.operation,
              runId: input.snapshot.runId,
              projectConfigurationRevision: input.snapshot.projectConfigurationRevision,
              schemaVersion: input.snapshot.schemaVersion,
              configurationHash: input.snapshot.configurationHash,
              resolvedConfigurationJson: input.snapshot.resolvedConfigurationJson as never,
              resolutionTraceJson: input.snapshot.resolutionTraceJson as never,
              quoteId: input.snapshot.quoteId,
              quoteFingerprint: input.snapshot.quoteFingerprint,
              estimatedCostMicros: input.snapshot.estimatedCostMicros,
              authorizationCostMicros: input.snapshot.authorizationCostMicros,
              budgetLimitMicros: input.snapshot.budgetLimitMicros,
              budgetOverrideAuthorized: input.snapshot.budgetOverrideAuthorized,
              pricingHash: input.snapshot.pricingHash,
              pricingVersionSetJson: input.snapshot.pricingVersionSetJson as never,
              createdAt: input.snapshot.createdAt,
              updatedAt: input.snapshot.updatedAt,
            },
          });
          // 2. pending_dispatch run（唯一约束为最终防线；冲突必须中止整个事务，
          //    不能让半成品 snapshot 带着提交）。
          try {
            await tx.generationRun.create({
              data: {
                id: input.run.id,
                projectId: input.run.projectId,
                userId: input.run.userId,
                operation: input.run.operation,
                idempotencyKey: input.run.idempotencyKey,
                payloadFingerprint: input.run.payloadFingerprint,
                quoteId: input.run.quoteId,
                runConfigurationSnapshotId: input.run.runConfigurationSnapshotId,
                dispatchPayloadJson: input.run.dispatchPayloadJson as never,
                status: input.run.status,
                dispatchLeaseOwner: input.run.dispatchLeaseOwner,
                dispatchLeaseExpiresAt: input.run.dispatchLeaseExpiresAt,
                dispatchClaimCount: input.run.dispatchClaimCount,
                createdAt: input.run.createdAt,
                updatedAt: input.run.updatedAt,
              },
            });
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              const existingRow = await tx.generationRun.findUnique({
                where: {
                  projectId_operation_idempotencyKey: {
                    projectId: input.run.projectId,
                    operation: input.run.operation,
                    idempotencyKey: input.run.idempotencyKey,
                  },
                },
              });
              if (existingRow) throw new RunConflictAbort(toRunRecord(existingRow));
            }
            throw error;
          }
        });
      } catch (error) {
        if (error instanceof RunConflictAbort) {
          return { ok: false as const, error: { code: "generation_run_conflict" as const, existing: error.existing } };
        }
        throw error;
      }

      // 提交成功后才同步内存镜像
      syncRunToMemory(db, input.run);
      db.runConfigurationSnapshots.set(input.snapshot.id, input.snapshot);
      return { ok: true as const, run: input.run };
    },
    async claimRun(runId, workerId, leaseUntil, now, expectedClaimCount) {
      // 与 listRecoverableRuns 同一恢复条件（claim 是最终原子裁决）
      const result = await client.generationRun.updateMany({
        where: { id: runId, ...recoverableRunWhere(now), ...(expectedClaimCount === undefined ? {} : {dispatchClaimCount:expectedClaimCount}) },
        data: {
          status: "running",
          dispatchLeaseOwner: workerId,
          dispatchLeaseExpiresAt: leaseUntil,
          dispatchClaimCount: { increment: 1 },
          updatedAt: now,
        },
      });
      if (result.count !== 1) return false;
      const row = await client.generationRun.findUnique({ where: { id: runId } });
      if (row) syncRunToMemory(db, toRunRecord(row));
      return true;
    },
    async renewLease(runId, workerId, leaseUntil, now, expectedClaimCount) {
      // 条件更新：只有 lease 仍归本 worker 时才延长（防易主后误续）
      const result = await client.generationRun.updateMany({
        where: { id: runId, dispatchLeaseOwner: workerId, ...(expectedClaimCount === undefined ? {} : {dispatchClaimCount:expectedClaimCount,status:"running"}) },
        data: { dispatchLeaseExpiresAt: leaseUntil, updatedAt: now },
      });
      if (result.count !== 1) return false;
      const row = await client.generationRun.findUnique({ where: { id: runId } });
      if (row) syncRunToMemory(db, toRunRecord(row));
      return true;
    },
    async updateRunStatus(runId, status, options) {
      const data: Record<string, unknown> = { status, updatedAt: options.now };
      if (options.releaseLease) {
        data["dispatchLeaseOwner"] = null;
        data["dispatchLeaseExpiresAt"] = null;
      }
      // 条件更新：needs_reconciliation 终态默认不可覆盖（对账信号保护）；
      // expectedLeaseOwner 提供时按 lease-owner 条件更新（I-2 fencing）
      const where: Record<string, unknown> = { id: runId };
      if (!options.allowOverwriteNeedsReconciliation) {
        where["status"] = { not: "needs_reconciliation" };
      }
      if (options.expectedLeaseOwner !== undefined) {
        where["dispatchLeaseOwner"] = options.expectedLeaseOwner;
      }
      if (options.expectedClaimCount !== undefined) {
        where["dispatchClaimCount"] = options.expectedClaimCount;
        where["status"] = "running";
      }
      const result = await client.generationRun.updateMany({ where, data });
      const row = await client.generationRun.findUnique({ where: { id: runId } });
      if (!row) return null;
      const run = toRunRecord(row);
      syncRunToMemory(db, run);
      if (result.count === 0 && options.expectedClaimCount !== undefined) return null;
      // 条件更新未命中 + lease 已易主 = fencing 拒绝（迟到 finalize 丢弃）。
      // 未命中但 owner 仍匹配 = needs_reconciliation 终态保护，返回当前 run。
      if (
        result.count === 0 &&
        options.expectedLeaseOwner !== undefined &&
        run.dispatchLeaseOwner !== options.expectedLeaseOwner
      ) {
        return null;
      }
      return run;
    },
    async appendRunEvent(record) {
      await client.generationRunEvent.create({
        data: {
          id: record.id,
          generationRunId: record.generationRunId,
          eventType: record.eventType,
          segmentId: record.segmentId,
          eventJson: record.eventJson as never,
          createdAt: record.createdAt,
        },
      });
      const events = db.generationRunEvents.get(record.generationRunId) ?? [];
      events.push(record);
      db.generationRunEvents.set(record.generationRunId, events);
    },
    async listRecoverableRuns(now) {
      // 数据库为权威：其他进程遗留的 pending/lease-expired run 不在本地镜像中，
      // 存活期 sweep 必须查 DB 才能接管（启动扫描有 hydrate 先行，低频 sweep 没有）。
      // running + lease=null 是 legacy 在跑 run（不属派发协议，无 lease 可判过期），
      // 绝不接管——否则 sweep 会与正在执行的原始请求并发重跑（重复执行/重复计费）。
      const rows = await client.generationRun.findMany({
        where: recoverableRunWhere(now),
      });
      const runs = rows.map(toRunRecord);
      for (const run of runs) syncRunToMemory(db, run);
      return runs;
    },
    // 数据库为权威：另一进程/worker 提交或 claim 后本地内存镜像可能未同步，
    // 幂等重放与 dispatcher 恢复必须查 DB（跨进程正确性）。
    async getRunById(runId) {
      const row = await client.generationRun.findUnique({ where: { id: runId } });
      if (!row) return null;
      const run = toRunRecord(row);
      syncRunToMemory(db, run);
      return run;
    },
    async getRunByKey(projectId, operation, idempotencyKey) {
      const row = await client.generationRun.findUnique({
        where: {
          projectId_operation_idempotencyKey: { projectId, operation, idempotencyKey },
        },
      });
      if (!row) return null;
      const run = toRunRecord(row);
      syncRunToMemory(db, run);
      return run;
    },
    async getSnapshotById(snapshotId) {
      const row = await client.runConfigurationSnapshot.findUnique({ where: { id: snapshotId } });
      if (!row) return null;
      const snapshot = toSnapshotRecord(row);
      db.runConfigurationSnapshots.set(snapshot.id, snapshot);
      return snapshot;
    },
    listRunsByProject(projectId) {
      return listRunsByProject(db, projectId);
    },
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** 事务内中止哨兵：携带结构化错误码，中止整个事务且不提交任何写入。 */
class RunConflictAbort extends Error {
  constructor(public readonly existing: GenerationRunRecord) {
    super("generation_run_conflict");
    this.name = "RunConflictAbort";
  }
}

export function createGenerationRunRepository(
  db: DbClient,
  prismaClient?: AppPrismaClient,
): GenerationRunRepository {
  if (prismaClient) return createPrismaRepository(db, prismaClient);
  return createMapRepository(db);
}

async function validateNarrationSubmission(db: DbClient, input: CreateRunTransactionInput, client?: Parameters<typeof readNarrationSource>[3]) {
    const payload = input.run.dispatchPayloadJson as Record<string, unknown>;
    if (typeof payload.owner_id !== "string" || input.snapshot.userId !== payload.owner_id)
        throw new Error("narration_submission_source_conflict");
    const source = await readNarrationSource(db, input.run.projectId, payload.owner_id, client);
    if (source.project.narrationTimingMode !== "narration_first_v1" || !source.script || source.script.id !== payload.source_script_record_id || source.script.projectId !== input.run.projectId || !hasPassingNarrationScriptValidation(source.script.validationResultJson) || source.confirmation?.sourceTextSha256 !== payload.source_text_sha256 || narrationTextHash(source.script.scriptText) !== payload.source_text_sha256 || source.configuration?.revision !== input.snapshot.projectConfigurationRevision || await hashProjectNarrationTtsSettings(source.configuration.configurationJson) !== payload.source_project_tts_settings_sha256)
        throw new Error("narration_submission_source_conflict");
}
