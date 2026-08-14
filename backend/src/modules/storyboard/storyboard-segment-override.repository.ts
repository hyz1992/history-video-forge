import type { DbClient, StoryboardSegmentOverrideRecord } from "../../db/client.js";

/**
 * S2-2A 任务 4：分镜级视觉策略覆盖 repository（详细设计 4.4 节）。
 *
 * - 独立于 StoryboardPlan（不修改 planJson）。
 * - 值严格为 api_video | remotion_motion | null（null 表示继承，无 inherit 字符串）。
 * - upsert 带 expected_revision；并发修改者只有一个成功，另一个 409
 *   storyboard_segment_override_revision_conflict。
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

export function upsertSegmentOverride(
  db: DbClient,
  input: SegmentOverrideInput,
): SegmentOverrideUpsertResult {
  // 严格值校验（null 表示继承；不接受 inherit 等字符串）
  if (input.strategyOverride !== "api_video" && input.strategyOverride !== "remotion_motion" && input.strategyOverride !== null) {
    return { ok: false, error: { code: "invalid_override_value", reason: "override must be api_video | remotion_motion | null" } };
  }

  const existing = getSegmentOverride(db, input.storyboardRecordId, input.segmentId);
  if (existing) {
    if (input.expectedRevision !== existing.revision) {
      return {
        ok: false,
        error: { code: "storyboard_segment_override_revision_conflict", current_revision: existing.revision },
      };
    }
  } else {
    if (input.expectedRevision !== null) {
      return {
        ok: false,
        error: { code: "storyboard_segment_override_revision_conflict", current_revision: 0 },
      };
    }
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

  db.storyboardSegmentOverrides.set(record.id, record);
  void db.secondAggregateWriter?.saveStoryboardSegmentOverride(record);

  return {
    ok: true,
    value: { id: record.id, revision: newRevision, strategyOverride: input.strategyOverride },
  };
}
