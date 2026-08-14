import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import {
  getSegmentOverride,
  upsertSegmentOverride,
} from "../../../backend/src/modules/storyboard/storyboard-segment-override.repository.js";

/**
 * S2-2A 任务 4 步骤 1：分镜覆盖 repository 测试。
 *
 * 详细设计 4.4 + 任务 4 步骤 4：
 * - override 值严格为 api_video | remotion_motion | null（null 表示继承）。
 * - upsert 带 expected_revision；并发修改者只有一个成功，另一个 409
 *   storyboard_segment_override_revision_conflict。
 * - 不直接修改历史 planJson。
 */
describe("storyboard segment override repository", () => {
  it("returns null when no override exists for the segment", async () => {
    const db = createDbClient();
    expect(getSegmentOverride(db, "storyboard-1", "sb_001")).toBeNull();
  });

  it("creates an override with revision 1", async () => {
    const db = createDbClient();
    const result = await upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "api_video",
      expectedRevision: null,
      updatedByUserId: "u1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(1);
    expect(result.value.strategyOverride).toBe("api_video");

    const read = getSegmentOverride(db, "storyboard-1", "sb_001");
    expect(read?.strategyOverride).toBe("api_video");
    expect(read?.revision).toBe(1);
  });

  it("updates override with correct expected_revision", async () => {
    const db = createDbClient();
    upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "api_video",
      expectedRevision: null,
      updatedByUserId: "u1",
    });
    const result = await upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "remotion_motion",
      expectedRevision: 1,
      updatedByUserId: "u1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(2);
    expect(result.value.strategyOverride).toBe("remotion_motion");
  });

  it("rejects stale expected_revision with 409 conflict code", async () => {
    const db = createDbClient();
    upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "api_video",
      expectedRevision: null,
      updatedByUserId: "u1",
    });
    const result = await upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "remotion_motion",
      expectedRevision: 99,
      updatedByUserId: "u1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("storyboard_segment_override_revision_conflict");
  });

  it("clears override with null (inherit), creating revision 2", async () => {
    const db = createDbClient();
    upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "api_video",
      expectedRevision: null,
      updatedByUserId: "u1",
    });
    const result = await upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: null,
      expectedRevision: 1,
      updatedByUserId: "u1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strategyOverride).toBeNull();
    expect(result.value.revision).toBe(2);
  });

  it("rejects illegal override values (no inherit string)", async () => {
    const db = createDbClient();
    const result = await upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      // @ts-expect-error intentionally illegal value
      strategyOverride: "inherit",
      expectedRevision: null,
      updatedByUserId: "u1",
    });
    expect(result.ok).toBe(false);
  });

  it("does not mutate the storyboard planJson (override is independent)", async () => {
    const db = createDbClient();
    // 预置一个 planJson 记录
    db.storyboardRecords.set("storyboard-1", {
      id: "storyboard-1",
      projectId: "p1",
      topicPackageId: "tp1",
      scriptRecordId: "sr1",
      planJson: { segments: [{ segment_id: "sb_001" }] },
      validationResultJson: {},
      executionStateJson: null,
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
    } as never);
    upsertSegmentOverride(db, {
      projectId: "p1",
      storyboardRecordId: "storyboard-1",
      segmentId: "sb_001",
      strategyOverride: "api_video",
      expectedRevision: null,
      updatedByUserId: "u1",
    });
    const record = db.storyboardRecords.get("storyboard-1")!;
    const segments = (record.planJson as { segments: Array<Record<string, unknown>> }).segments;
    // planJson 不被 override 修改
    expect(segments[0]).not.toHaveProperty("visual_strategy_override");
    expect(segments[0]).not.toHaveProperty("visual_strategy_preference");
  });
});
