import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { recoverInterruptedRuns } from "../../../backend/src/runtime/recovery/interrupted-run-recovery.js";

describe("interrupted run recovery", () => {
  it.each([
    ["topic_generating", "topic_pending"],
    ["script_generating", "script_ready"],
    ["storyboard_generating", "storyboard_ready"],
    ["asset_plan_generating", "asset_plan_ready"],
    ["assets_generating", "assets_blocked"],
    ["render_rendering", "render_failed"],
  ])("recovers %s to %s without resubmitting", (from, to) => {
    const db = createDbClient();
    db.projects.set("p1", { id: "p1", status: from } as never);

    const result = recoverInterruptedRuns(db, { recoveredAt: "2026-07-10T00:00:00.000Z" });

    expect(db.projects.get("p1")?.status).toBe(to);
    expect(result.recoveredProjectIds).toContain("p1");
  });

  it("marks submitted provider jobs failed for manual retry", () => {
    const db = createDbClient();
    db.assetProviderJobRecords.set("job_1", { id: "job_1", status: "running" } as never);

    const result = recoverInterruptedRuns(db, { recoveredAt: "2026-07-10T00:00:00.000Z" });
    const job = db.assetProviderJobRecords.get("job_1")!;

    expect(result.recoveredProviderJobIds).toEqual(["job_1"]);
    expect(job).toMatchObject({ status: "failed", errorCode: "process_interrupted" });
  });
});
