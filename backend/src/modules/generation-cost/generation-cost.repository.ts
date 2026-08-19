import type {
  DbClient,
  GenerationCostQuoteRecord,
  RunConfigurationSnapshotRecord,
  UsageCostRecordRecord,
} from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

/**
 * S2-2A 任务 8：generation-cost repository（quote 持久化与只读查询）。
 *
 * 所有查询必须以已授权 `projectId` 为入口（owner scope 反查在 controller 完成）；
 * 禁止提供只凭 quote/snapshot/cost id 返回数据的未授权方法。
 * 内存态读写 DbClient 的 Map；Prisma 激活态经 thirdAggregateWriter 双写，
 * 只读查询传入 prismaClient 时以数据库为权威（跨进程一致性，外部审查 N1）：
 * 查询结果同步回内存镜像，单实例内读写语义保持一致。
 */

// --- quote 写入 -------------------------------------------------------------

export async function saveGenerationCostQuote(
  db: DbClient,
  record: GenerationCostQuoteRecord,
): Promise<void> {
  if (db.thirdAggregateWriter) {
    await db.thirdAggregateWriter.saveGenerationCostQuote(record);
  }
  db.generationCostQuotes.set(record.id, record);
}

// --- quote 只读（project-scoped） -------------------------------------------

export async function findQuoteById(
  db: DbClient,
  projectId: string,
  quoteId: string,
  prismaClient?: AppPrismaClient,
): Promise<GenerationCostQuoteRecord | null> {
  if (prismaClient) {
    const row = await prismaClient.generationCostQuote.findUnique({ where: { id: quoteId } });
    if (!row || row.projectId !== projectId) return null;
    const record = toQuoteRecord(row);
    db.generationCostQuotes.set(record.id, record);
    return record;
  }
  const record = db.generationCostQuotes.get(quoteId);
  if (!record || record.projectId !== projectId) return null;
  return record;
}

export async function listQuotesByProject(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<GenerationCostQuoteRecord[]> {
  if (prismaClient) {
    const rows = await prismaClient.generationCostQuote.findMany({ where: { projectId } });
    const records = rows.map(toQuoteRecord);
    for (const record of records) db.generationCostQuotes.set(record.id, record);
    return records.sort(compareByCreatedAt);
  }
  return sortByCreatedAt(
    [...db.generationCostQuotes.values()].filter((record) => record.projectId === projectId),
  );
}

// --- snapshot / usage 只读（project-scoped） ---------------------------------

export async function findSnapshotById(
  db: DbClient,
  projectId: string,
  snapshotId: string,
  prismaClient?: AppPrismaClient,
): Promise<RunConfigurationSnapshotRecord | null> {
  if (prismaClient) {
    const row = await prismaClient.runConfigurationSnapshot.findUnique({ where: { id: snapshotId } });
    if (!row || row.projectId !== projectId) return null;
    const record = toSnapshotRecord(row);
    db.runConfigurationSnapshots.set(record.id, record);
    return record;
  }
  const record = db.runConfigurationSnapshots.get(snapshotId);
  if (!record || record.projectId !== projectId) return null;
  return record;
}

export async function listSnapshotsByProject(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<RunConfigurationSnapshotRecord[]> {
  if (prismaClient) {
    const rows = await prismaClient.runConfigurationSnapshot.findMany({ where: { projectId } });
    const records = rows.map(toSnapshotRecord);
    for (const record of records) db.runConfigurationSnapshots.set(record.id, record);
    return records.sort(compareByCreatedAt);
  }
  return sortByCreatedAt(
    [...db.runConfigurationSnapshots.values()].filter((record) => record.projectId === projectId),
  );
}

export async function listUsageRecordsByProject(
  db: DbClient,
  projectId: string,
  prismaClient?: AppPrismaClient,
): Promise<UsageCostRecordRecord[]> {
  if (prismaClient) {
    const snapshotIds = (
      await prismaClient.runConfigurationSnapshot.findMany({ where: { projectId }, select: { id: true } })
    ).map((row) => row.id);
    const [snapshotRows, runRows, usageRows] = await Promise.all([
      snapshotIds.length === 0
        ? Promise.resolve([])
        : prismaClient.runConfigurationSnapshot.findMany({ where: { id: { in: snapshotIds } } }),
      snapshotIds.length === 0
        ? Promise.resolve([])
        : prismaClient.generationRun.findMany({
            where: { runConfigurationSnapshotId: { in: snapshotIds } },
          }),
      snapshotIds.length === 0
        ? Promise.resolve([])
        : prismaClient.usageCostRecord.findMany({
            where: { runConfigurationSnapshotId: { in: snapshotIds } },
          }),
    ]);
    // 关联记录一并同步镜像：costs/records 的 run_id/run_status/operation
    // 在冷镜像进程下也必须从 DB 恢复（外部审查 N1 同根因）
    for (const row of snapshotRows) {
      const record = toSnapshotRecord(row);
      db.runConfigurationSnapshots.set(record.id, record);
    }
    for (const row of runRows) {
      const record = toRunRecord(row);
      db.generationRuns.set(record.id, record);
    }
    const records = usageRows.map(toUsageRecord);
    for (const record of records) db.usageCostRecords.set(record.id, record);
    return records.sort(compareByCreatedAt);
  }
  const records: UsageCostRecordRecord[] = [];
  for (const record of db.usageCostRecords.values()) {
    const snapshot = db.runConfigurationSnapshots.get(record.runConfigurationSnapshotId);
    if (snapshot && snapshot.projectId === projectId) records.push(record);
  }
  return records.sort(compareByCreatedAt);
}

// --- Prisma row → record 转换 -------------------------------------------------

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
}): import("../../db/client.js").GenerationRunRecord {
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
    status: row.status as import("../../db/client.js").GenerationRunRecord["status"],
    dispatchLeaseOwner: row.dispatchLeaseOwner,
    dispatchLeaseExpiresAt: row.dispatchLeaseExpiresAt,
    dispatchClaimCount: row.dispatchClaimCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// --- 排序辅助 ---------------------------------------------------------------

function compareByCreatedAt(a: { createdAt: Date }, b: { createdAt: Date }): number {
  if (a.createdAt.getTime() < b.createdAt.getTime()) return -1;
  if (a.createdAt.getTime() > b.createdAt.getTime()) return 1;
  return 0;
}

function sortByCreatedAt<T extends { createdAt: Date }>(records: T[]): T[] {
  return records.sort(compareByCreatedAt);
}

// --- Prisma row → record 转换 -------------------------------------------------

function toQuoteRecord(row: {
  id: string;
  projectId: string;
  userId: string | null;
  operation: string;
  configurationHash: string;
  quoteFingerprint: string;
  pricingHash: string;
  pricingVersionSetJson: unknown;
  itemsJson: unknown;
  estimatedCostMicros: string;
  authorizationCostMicros: string;
  containsUnboundedItem: boolean;
  budgetLimitMicros: string | null;
  overBudget: boolean;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GenerationCostQuoteRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    operation: row.operation,
    configurationHash: row.configurationHash,
    quoteFingerprint: row.quoteFingerprint,
    pricingHash: row.pricingHash,
    pricingVersionSetJson: row.pricingVersionSetJson as string[],
    itemsJson: row.itemsJson as unknown[],
    estimatedCostMicros: row.estimatedCostMicros,
    authorizationCostMicros: row.authorizationCostMicros,
    containsUnboundedItem: row.containsUnboundedItem,
    budgetLimitMicros: row.budgetLimitMicros,
    overBudget: row.overBudget,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
    budgetLimitMicros: row.budgetLimitMicros,
    budgetOverrideAuthorized: row.budgetOverrideAuthorized,
    pricingHash: row.pricingHash,
    pricingVersionSetJson: row.pricingVersionSetJson as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toUsageRecord(row: {
  id: string;
  runConfigurationSnapshotId: string;
  assetProviderJobRecordId: string | null;
  interactionId: string | null;
  capability: string;
  providerKey: string;
  modelId: string;
  providerRequestKey: string;
  attemptIndex: number;
  status: string;
  unitType: string;
  inputUnits: number | null;
  outputUnits: number | null;
  estimatedCostMicros: string;
  actualCostMicros: string | null;
  costBasis: string;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}): UsageCostRecordRecord {
  return {
    id: row.id,
    runConfigurationSnapshotId: row.runConfigurationSnapshotId,
    assetProviderJobRecordId: row.assetProviderJobRecordId,
    interactionId: row.interactionId,
    capability: row.capability,
    providerKey: row.providerKey,
    modelId: row.modelId,
    providerRequestKey: row.providerRequestKey,
    attemptIndex: row.attemptIndex,
    status: row.status as UsageCostRecordRecord["status"],
    unitType: row.unitType as UsageCostRecordRecord["unitType"],
    inputUnits: row.inputUnits,
    outputUnits: row.outputUnits,
    estimatedCostMicros: row.estimatedCostMicros,
    actualCostMicros: row.actualCostMicros,
    costBasis: row.costBasis as UsageCostRecordRecord["costBasis"],
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
