import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { recoverAndPersistInterruptedRuns, recoverInterruptedRuns } from "../../../backend/src/runtime/recovery/interrupted-run-recovery.js";

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

  it("persists recovered Prisma project and provider-job state", async () => {
    const db = createDbClient();
    const syncedProjects: string[] = [];
    const savedJobs: string[] = [];
    db.projects.set("p1", { id: "p1", status: "assets_generating" } as never);
    db.assetProviderJobRecords.set("job_1", { id: "job_1", status: "submitted" } as never);
    db.firstAggregateWriter = {
      ownerId: "owner",
      syncProject: async (project) => { syncedProjects.push(project.id); },
    } as never;
    db.thirdAggregateWriter = {
      saveProviderJob: async (job) => { savedJobs.push(job.id); return job; },
    } as never;

    const result = await recoverAndPersistInterruptedRuns(db, { recoveredAt: "2026-07-12T00:00:00.000Z" });

    expect(result).toEqual({ recoveredProjectIds: ["p1"], recoveredProviderJobIds: ["job_1"] });
    expect(syncedProjects).toEqual(["p1"]);
    expect(savedJobs).toEqual(["job_1"]);
  });
});
