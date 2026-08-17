import type { DbClient, ProviderModelCatalogRecord } from "../../db/client.js";

/**
 * S2-2A 任务 7：provider/model 目录 repository。
 *
 * 内存态读写 DbClient 的 Map；Prisma 激活态通过 firstAggregateWriter 的
 * saveProviderModelCatalogEntry（按 id upsert）双写。catalog 读取是纯内存快照，
 * 供 resolver、readiness 与计价服务消费。
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

export interface ApplySeedResult {
  appliedCount: number;
  /** 本次被禁用的陈旧目录项 id（不在 seed 内且仍处于 active 的历史行）。 */
  disabledStaleIds: string[];
}

/**
 * 应用服务端受控目录 seed。
 *
 * - seed 内条目按 id upsert（firstAggregateWriter + 内存 Map），保持 active 状态。
 * - 不在 seed 内的既有条目（如任务 2 迁移的占位行）统一降级为
 *   status=disabled、isDefault=false，避免与 seed 并存形成多个 active 默认项。
 * - 写序遵循"数据库成功后才更新内存"（任务 3/6 已确立的模式）：writer 失败时
 *   错误向上传播，内存只反映已成功持久化的前缀；重跑 seed 可自愈。
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
  for (const existing of db.providerModelCatalog.values()) {
    if (seedIds.has(existing.id)) continue;
    if (existing.status !== "active" && !existing.isDefault) continue;
    const disabled: ProviderModelCatalogRecord = {
      ...existing,
      status: "disabled",
      isDefault: false,
      updatedAt: now,
    };
    await db.firstAggregateWriter?.saveProviderModelCatalogEntry(disabled);
    db.providerModelCatalog.set(disabled.id, disabled);
    disabledStaleIds.push(disabled.id);
  }

  // 2. upsert seed 条目（先持久化，成功后才更新内存）。
  for (const entry of seed) {
    await db.firstAggregateWriter?.saveProviderModelCatalogEntry(entry);
    db.providerModelCatalog.set(entry.id, entry);
  }

  return {
    appliedCount: seed.length,
    disabledStaleIds: disabledStaleIds.sort(),
  };
}
