import type { DbClient, ProviderModelCatalogRecord } from "../../db/client.js";

/**
 * S2-2A 任务 7：provider/model 目录 repository。
 *
 * 内存态读写 DbClient 的 Map；Prisma 激活态通过 firstAggregateWriter 双写：
 * - 存在 `applyProviderModelCatalogSeedBatch`（Prisma 事务批量）时整批一次提交，
 *   中段失败整体回滚，不留半应用状态（codex 审计 P3）。
 * - 否则退回逐条 upsert（persist-then-memory）：writer 失败向上传播，
 *   内存只反映已成功持久化的前缀，重跑 seed 可自愈。
 */

/** 按稳定 id 排序读取全部目录项（消除 Map 迭代顺序对消费方的影响）。 */
export function listProviderModelCatalog(
  db: DbClient,
): ProviderModelCatalogRecord[] {
  return [...db.providerModelCatalog.values()].sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * 持久化一批目录记录并同步内存。
 * 优先走 writer 的事务批量方法；批量提交成功后才统一更新内存 Map。
 */
async function persistCatalogRecords(
  db: DbClient,
  records: ProviderModelCatalogRecord[],
): Promise<void> {
  if (records.length === 0) return;
  if (db.firstAggregateWriter?.applyProviderModelCatalogSeedBatch) {
    await db.firstAggregateWriter.applyProviderModelCatalogSeedBatch(records);
    for (const record of records) {
      db.providerModelCatalog.set(record.id, record);
    }
    return;
  }
  for (const record of records) {
    await db.firstAggregateWriter?.saveProviderModelCatalogEntry(record);
    db.providerModelCatalog.set(record.id, record);
  }
}

export interface ApplySeedResult {
  appliedCount: number;
  /** 本次被禁用的陈旧目录项 id（不在 seed 内且仍处于 active 的历史行）。 */
  disabledStaleIds: string[];
}

/**
 * 应用服务端受控目录 seed。
 *
 * - seed 内条目按 id upsert，保持 active 状态。
 * - 不在 seed 内的既有条目（如任务 2 迁移的占位行）统一降级为
 *   status=disabled、isDefault=false，避免与 seed 并存形成多个 active 默认项。
 * - 幂等：重复应用同一 seed 不会再产生 disabledStaleIds。
 */
export async function applyProviderModelCatalogSeed(
  db: DbClient,
  seed: ProviderModelCatalogRecord[],
): Promise<ApplySeedResult> {
  const seedIds = new Set(seed.map((entry) => entry.id));
  const disabledStaleIds: string[] = [];
  const now = new Date();

  // 1. 禁用不在 seed 内的陈旧行（已 disabled 且非默认的行跳过，保证幂等）。
  const staleRecords: ProviderModelCatalogRecord[] = [];
  for (const existing of db.providerModelCatalog.values()) {
    if (seedIds.has(existing.id)) continue;
    if (existing.status !== "active" && !existing.isDefault) continue;
    staleRecords.push({ ...existing, status: "disabled", isDefault: false, updatedAt: now });
    disabledStaleIds.push(existing.id);
  }

  // 2. 陈旧行禁用 + seed upsert 作为一个批次持久化（Prisma 事务原子生效）。
  await persistCatalogRecords(db, [...staleRecords, ...seed]);

  return {
    appliedCount: seed.length,
    disabledStaleIds: disabledStaleIds.sort(),
  };
}

/**
 * 把指定目录项物化为 disabled（含落库与内存）。
 *
 * 供启动 bootstrap 使用：readiness 判定不可报价/不可真实派发的条目写入目录状态，
 * 目录 API（只返回 active）与后续报价/派发边界即不再看到它们；
 * 下次启动 seed 会按当前环境重新 upsert，环境恢复后自动纠正。
 */
export async function disableProviderModelCatalogEntries(
  db: DbClient,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const now = new Date();
  const records: ProviderModelCatalogRecord[] = [];
  for (const id of ids) {
    const existing = db.providerModelCatalog.get(id);
    if (!existing) continue;
    if (existing.status !== "active" && !existing.isDefault) continue;
    records.push({ ...existing, status: "disabled", isDefault: false, updatedAt: now });
  }
  await persistCatalogRecords(db, records);
  return records.map((record) => record.id);
}
