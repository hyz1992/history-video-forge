import type {
  DbClient,
  GenerationCostQuoteRecord,
  RunConfigurationSnapshotRecord,
  UsageCostRecordRecord,
} from "../../db/client.js";

/**
 * S2-2A 任务 8：generation-cost repository（quote 持久化与只读查询）。
 *
 * 所有查询必须以已授权 `projectId` 为入口（owner scope 反查在 controller 完成）；
 * 禁止提供只凭 quote/snapshot/cost id 返回数据的未授权方法。
 * 内存态读写 DbClient 的 Map；Prisma 激活态经 thirdAggregateWriter 双写。
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

export function findQuoteById(
  db: DbClient,
  projectId: string,
  quoteId: string,
): GenerationCostQuoteRecord | null {
  const record = db.generationCostQuotes.get(quoteId);
  if (!record || record.projectId !== projectId) return null;
  return record;
}

export function listQuotesByProject(
  db: DbClient,
  projectId: string,
): GenerationCostQuoteRecord[] {
  const records: GenerationCostQuoteRecord[] = [];
  for (const record of db.generationCostQuotes.values()) {
    if (record.projectId === projectId) records.push(record);
  }
  return records.sort((a, b) => {
    if (a.createdAt.getTime() < b.createdAt.getTime()) return -1;
    if (a.createdAt.getTime() > b.createdAt.getTime()) return 1;
    return 0;
  });
}

// --- snapshot / usage 只读（project-scoped） ---------------------------------

export function findSnapshotById(
  db: DbClient,
  projectId: string,
  snapshotId: string,
): RunConfigurationSnapshotRecord | null {
  const record = db.runConfigurationSnapshots.get(snapshotId);
  if (!record || record.projectId !== projectId) return null;
  return record;
}

export function listSnapshotsByProject(
  db: DbClient,
  projectId: string,
): RunConfigurationSnapshotRecord[] {
  const records: RunConfigurationSnapshotRecord[] = [];
  for (const record of db.runConfigurationSnapshots.values()) {
    if (record.projectId === projectId) records.push(record);
  }
  return records;
}

export function listUsageRecordsByProject(
  db: DbClient,
  projectId: string,
): UsageCostRecordRecord[] {
  const records: UsageCostRecordRecord[] = [];
  for (const record of db.usageCostRecords.values()) {
    const snapshot = db.runConfigurationSnapshots.get(record.runConfigurationSnapshotId);
    if (snapshot && snapshot.projectId === projectId) records.push(record);
  }
  return records.sort((a, b) => {
    if (a.createdAt.getTime() < b.createdAt.getTime()) return -1;
    if (a.createdAt.getTime() > b.createdAt.getTime()) return 1;
    return 0;
  });
}
