import type {
  AuditLogRecord,
  DbClient,
  GenerationCostQuoteRecord,
  GenerationRunEventRecord,
  GenerationRunRecord,
  RunConfigurationSnapshotRecord,
} from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

/**
 * S2-2A 任务 8：GenerationRun 事务 repository。
 *
 * 生产激活态（Prisma）：quote 消费、snapshot 创建、pending_dispatch run 创建与
 * 超额授权审计在**同一个数据库事务**内完成；数据库唯一约束
 * (projectId, operation, idempotencyKey) / GenerationRun.quoteId 是幂等的最终防线。
 * 事务提交前绝不调用外部 provider。
 *
 * legacy Map 态：用单进程锁 + 失败回滚模拟合同（先校验后变更，冲突返回错误），
 * 不把数据库事务跨到外部网络调用。claim/lease 操作为同步检查-设置（单线程内原子）。
 *
 * 用户面查询一律以已授权 projectId 为入口；dispatcher 内部按 runId 访问仅用于
 * 服务端恢复（非用户请求路径）。
 */

export interface CreateRunTransactionInput {
  quote: GenerationCostQuoteRecord;
  snapshot: RunConfigurationSnapshotRecord;
  run: GenerationRunRecord;
  /** authorize_budget_override=true 时在同一事务写入审计。 */
  audit: {
    actorUserId: string | null;
    projectId: string;
    action: string;
    targetType: string;
    targetId: string | null;
    metadataJson: Record<string, unknown> | null;
  } | null;
  now: Date;
}

export type CreateRunTransactionResult =
  | { ok: true; run: GenerationRunRecord }
  | {
      ok: false;
      error:
        | { code: "generation_quote_not_found" }
        | { code: "generation_quote_consumed" }
        | { code: "generation_run_conflict"; existing: GenerationRunRecord };
    };

export interface GenerationRunRepository {
  /**
   * 原子创建 run 事务。唯一约束冲突（并发同 key 提交）返回
   * generation_run_conflict + existing，由服务层做幂等裁决。
   */
  createRunTransaction(input: CreateRunTransactionInput): Promise<CreateRunTransactionResult>;
  /**
   * 原子 claim：只有 status∈(pending_dispatch, running) 且 lease 已过期/未设置时成功，
   * 写 leaseOwner/leaseUntil 并递增 claimCount、置 running。返回 false = 未取得 lease。
   */
  claimRun(runId: string, workerId: string, leaseUntil: Date, now: Date): Promise<boolean>;
  /** 更新 run 状态；releaseLease=true 时清空 lease（终态）。 */
  updateRunStatus(
    runId: string,
    status: GenerationRunRecord["status"],
    options: { releaseLease: boolean; now: Date },
  ): Promise<GenerationRunRecord | null>;
  appendRunEvent(record: GenerationRunEventRecord): Promise<void>;
  /** 可恢复运行：pending_dispatch 或 lease 已过期；永远排除 needs_reconciliation。 */
  listRecoverableRuns(now: Date): GenerationRunRecord[];
  getRunById(runId: string): GenerationRunRecord | null;
  getRunByKey(
    projectId: string,
    operation: string,
    idempotencyKey: string,
  ): GenerationRunRecord | null;
  listRunsByProject(projectId: string): GenerationRunRecord[];
}

// --- 独立查询（供 cost service 等消费方使用） -------------------------------

/** 按 projectId 列出全部 run（创建时间升序）。 */
export function listRunsByProject(db: DbClient, projectId: string): GenerationRunRecord[] {
  const runs: GenerationRunRecord[] = [];
  for (const run of db.generationRuns.values()) {
    if (run.projectId === projectId) runs.push(run);
  }
  return runs.sort((a, b) => {
    if (a.createdAt.getTime() < b.createdAt.getTime()) return -1;
    if (a.createdAt.getTime() > b.createdAt.getTime()) return 1;
    return 0;
  });
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
  locks.set(projectId, previous.then(() => gate));
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
      return withProjectLock(db, input.quote.projectId, async () => {
        const quote = db.generationCostQuotes.get(input.quote.id);
        if (!quote) return { ok: false, error: { code: "generation_quote_not_found" } };
        if (quote.consumedAt !== null) {
          return { ok: false, error: { code: "generation_quote_consumed" } };
        }
        const existing = getRunByKeyMap(db, input.run.projectId, input.run.operation, input.run.idempotencyKey);
        if (existing) {
          return { ok: false, error: { code: "generation_run_conflict", existing } };
        }
        // 校验全部通过后才变更（失败回滚模拟：任何前置校验失败都不会留下半成品）
        quote.consumedAt = input.now;
        quote.updatedAt = input.now;
        db.runConfigurationSnapshots.set(input.snapshot.id, input.snapshot);
        db.generationRuns.set(input.run.id, input.run);
        if (input.audit) {
          const auditRecord: AuditLogRecord = {
            id: db.generateId(),
            actorUserId: input.audit.actorUserId,
            projectId: input.audit.projectId,
            action: input.audit.action,
            targetType: input.audit.targetType,
            targetId: input.audit.targetId,
            metadataJson: input.audit.metadataJson,
            createdAt: input.now,
          };
          db.auditLogs.set(auditRecord.id, auditRecord);
        }
        return { ok: true, run: input.run };
      });
    },
    async claimRun(runId, workerId, leaseUntil, now) {
      // 同步检查-设置：单线程内原子，等价于数据库条件更新。
      const run = db.generationRuns.get(runId);
      if (!run) return false;
      if (run.status !== "pending_dispatch" && run.status !== "running") return false;
      if (run.dispatchLeaseExpiresAt !== null && run.dispatchLeaseExpiresAt.getTime() >= now.getTime()) {
        return false;
      }
      run.status = "running";
      run.dispatchLeaseOwner = workerId;
      run.dispatchLeaseExpiresAt = leaseUntil;
      run.dispatchClaimCount += 1;
      run.updatedAt = now;
      return true;
    },
    async updateRunStatus(runId, status, options) {
      const run = db.generationRuns.get(runId);
      if (!run) return null;
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
    listRecoverableRuns(now) {
      const runs: GenerationRunRecord[] = [];
      for (const run of db.generationRuns.values()) {
        if (run.status !== "pending_dispatch" && run.status !== "running") continue;
        if (run.dispatchLeaseExpiresAt !== null && run.dispatchLeaseExpiresAt.getTime() >= now.getTime()) {
          continue;
        }
        runs.push(run);
      }
      return runs;
    },
    getRunById(runId) {
      return db.generationRuns.get(runId) ?? null;
    },
    getRunByKey(projectId, operation, idempotencyKey) {
      return getRunByKeyMap(db, projectId, operation, idempotencyKey);
    },
    listRunsByProject(projectId) {
      return listRunsByProject(db, projectId);
    },
  };
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

class RunConflictAbort extends Error {
  constructor(public readonly existing: GenerationRunRecord) {
    super("generation_run_conflict");
    this.name = "RunConflictAbort";
  }
}

function createPrismaRepository(db: DbClient, client: AppPrismaClient): GenerationRunRepository {
  return {
    async createRunTransaction(input) {
      let conflictExisting: GenerationRunRecord | null = null;
      try {
        await client.$transaction(async (tx) => {
          const quote = await tx.generationCostQuote.findUnique({ where: { id: input.quote.id } });
          if (!quote) throw new QuoteAbort("generation_quote_not_found");
          if (quote.consumedAt !== null) throw new QuoteAbort("generation_quote_consumed");
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

          // 1. 原子消费 quote（条件更新：只有未消费行能被置为 consumedAt）。
          const consumed = await tx.generationCostQuote.updateMany({
            where: { id: input.quote.id, consumedAt: null },
            data: { consumedAt: input.now, updatedAt: input.now },
          });
          if (consumed.count !== 1) throw new QuoteAbort("generation_quote_consumed");
          // 2. 不可变 snapshot。
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
          // 3. pending_dispatch run（唯一约束为最终防线；冲突必须中止整个事务，
          //    不能让已消费的 quote 与半成品 snapshot 带着提交）。
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
          // 4. 超额授权审计（同事务；失败整体回滚）。
          if (input.audit) {
            await tx.auditLog.create({
              data: {
                actorUserId: input.audit.actorUserId,
                projectId: input.audit.projectId,
                action: input.audit.action,
                targetType: input.audit.targetType,
                targetId: input.audit.targetId,
                metadataJson: input.audit.metadataJson as never,
              },
            });
          }
        });
      } catch (error) {
        if (error instanceof RunConflictAbort) {
          return { ok: false as const, error: { code: "generation_run_conflict" as const, existing: error.existing } };
        }
        if (error instanceof QuoteAbort) {
          return { ok: false as const, error: { code: error.code as "generation_quote_not_found" | "generation_quote_consumed" } };
        }
        throw error;
      }

      // 提交成功后才同步内存镜像
      syncRunToMemory(db, input.run);
      const quote = db.generationCostQuotes.get(input.quote.id);
      if (quote) {
        quote.consumedAt = input.now;
        quote.updatedAt = input.now;
      }
      db.runConfigurationSnapshots.set(input.snapshot.id, input.snapshot);
      return { ok: true as const, run: input.run };
    },
    async claimRun(runId, workerId, leaseUntil, now) {
      const result = await client.generationRun.updateMany({
        where: {
          id: runId,
          status: { in: ["pending_dispatch", "running"] },
          OR: [{ dispatchLeaseExpiresAt: null }, { dispatchLeaseExpiresAt: { lt: now } }],
        },
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
    async updateRunStatus(runId, status, options) {
      const data: Record<string, unknown> = { status, updatedAt: options.now };
      if (options.releaseLease) {
        data["dispatchLeaseOwner"] = null;
        data["dispatchLeaseExpiresAt"] = null;
      }
      await client.generationRun.updateMany({ where: { id: runId }, data });
      const row = await client.generationRun.findUnique({ where: { id: runId } });
      if (!row) return null;
      const run = toRunRecord(row);
      syncRunToMemory(db, run);
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
    listRecoverableRuns(now) {
      const runs: GenerationRunRecord[] = [];
      for (const run of db.generationRuns.values()) {
        if (run.status !== "pending_dispatch" && run.status !== "running") continue;
        if (run.dispatchLeaseExpiresAt !== null && run.dispatchLeaseExpiresAt.getTime() >= now.getTime()) {
          continue;
        }
        runs.push(run);
      }
      return runs;
    },
    getRunById(runId) {
      return db.generationRuns.get(runId) ?? null;
    },
    getRunByKey(projectId, operation, idempotencyKey) {
      return getRunByKeyMap(db, projectId, operation, idempotencyKey);
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
class QuoteAbort extends Error {
  constructor(public readonly code: "generation_quote_not_found" | "generation_quote_consumed") {
    super(code);
    this.name = "QuoteAbort";
  }
}

export function createGenerationRunRepository(
  db: DbClient,
  prismaClient?: AppPrismaClient,
): GenerationRunRepository {
  if (prismaClient) return createPrismaRepository(db, prismaClient);
  return createMapRepository(db);
}
