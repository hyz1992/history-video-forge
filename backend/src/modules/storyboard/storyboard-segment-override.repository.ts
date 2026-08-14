import type { DbClient, StoryboardSegmentOverrideRecord } from "../../db/client.js";

/**
 * S2-2A 任务 4：分镜级视觉策略覆盖 repository（详细设计 4.4 节）。
 *
 * - 独立于 StoryboardPlan（不修改 planJson）。
 * - 值严格为 api_video | remotion_motion | null（null 表示继承，无 inherit 字符串）。
 * - upsert 带 expected_revision；并发修改者只有一个成功，另一个 409
 *   storyboard_segment_override_revision_conflict。
 * - P1 整改：Prisma 激活态走数据库级 CAS（create 唯一冲突 / updateMany revision 条件），
 *   持久化成功后才更新内存 Map；非唯一事务异常继续抛出。
 */

export interface SegmentOverrideInput {
  projectId: string;
  storyboardRecordId: string;
  segmentId: string;
  strategyOverride: "api_video" | "remotion_motion" | null;
  expectedRevision: number | null;
  updatedByUserId: string;
}

export type SegmentOverrideUpsertResult =
  | { ok: true; value: { id: string; revision: number; strategyOverride: "api_video" | "remotion_motion" | null } }
  | { ok: false; error: { code: "storyboard_segment_override_revision_conflict"; current_revision: number } }
  | { ok: false; error: { code: "invalid_override_value"; reason: string } };

export function getSegmentOverride(
  db: DbClient,
  storyboardRecordId: string,
  segmentId: string,
): StoryboardSegmentOverrideRecord | null {
  for (const record of db.storyboardSegmentOverrides.values()) {
    if (record.storyboardRecordId === storyboardRecordId && record.segmentId === segmentId) {
      return record;
    }
  }
  return null;
}

export async function upsertSegmentOverride(
  db: DbClient,
  input: SegmentOverrideInput,
): Promise<SegmentOverrideUpsertResult> {
  // 严格值校验（null 表示继承；不接受 inherit 等字符串）
  if (input.strategyOverride !== "api_video" && input.strategyOverride !== "remotion_motion" && input.strategyOverride !== null) {
    return { ok: false, error: { code: "invalid_override_value", reason: "override must be api_video | remotion_motion | null" } };
  }

  const existing = getSegmentOverride(db, input.storyboardRecordId, input.segmentId);
  // 本地乐观锁预检（内存态无并发；Prisma 态由 CAS 兜底）
  if (existing) {
    if (input.expectedRevision !== existing.revision) {
      return {
        ok: false,
        error: { code: "storyboard_segment_override_revision_conflict", current_revision: existing.revision },
      };
    }
  } else if (input.expectedRevision !== null) {
    return {
      ok: false,
      error: { code: "storyboard_segment_override_revision_conflict", current_revision: 0 },
    };
  }

  const now = new Date();
  const newRevision = existing ? existing.revision + 1 : 1;
  const record: StoryboardSegmentOverrideRecord = {
    id: existing?.id ?? db.generateId(),
    projectId: input.projectId,
    storyboardRecordId: input.storyboardRecordId,
    segmentId: input.segmentId,
    strategyOverride: input.strategyOverride,
    revision: newRevision,
    updatedByUserId: input.updatedByUserId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  // P1：Prisma 激活态走数据库级 CAS，await 完成才更新内存
  if (db.secondAggregateWriter?.casUpsertStoryboardSegmentOverride) {
    const result = await db.secondAggregateWriter.casUpsertStoryboardSegmentOverride(
      record,
      existing ? existing.revision : 0,
    );
    if (!result.success) {
      // 并发 loser：同步数据库真实记录到内存，用实际 revision 返回冲突
      syncOverrideRecord(db, result.existingRecord);
      return {
        ok: false,
        error: { code: "storyboard_segment_override_revision_conflict", current_revision: result.existingRecord.revision },
      };
    }
  } else {
    void db.secondAggregateWriter?.saveStoryboardSegmentOverride(record);
  }

  // 持久化成功后才更新内存 Map
  db.storyboardSegmentOverrides.set(record.id, record);

  return {
    ok: true,
    value: { id: record.id, revision: newRevision, strategyOverride: input.strategyOverride },
  };
}

/** 用数据库返回的真实记录同步内存（同 (storyboardRecordId, segmentId) 旧记录替换）。 */
function syncOverrideRecord(db: DbClient, record: StoryboardSegmentOverrideRecord): void {
  for (const [key, existing] of db.storyboardSegmentOverrides) {
    if (existing.storyboardRecordId === record.storyboardRecordId && existing.segmentId === record.segmentId) {
      db.storyboardSegmentOverrides.delete(key);
    }
  }
  db.storyboardSegmentOverrides.set(record.id, record);
}
