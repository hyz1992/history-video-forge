import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const snapshotState = vi.hoisted(() => ({
  body: "",
}));

function isSnapshotPath(path: unknown): boolean {
  return /storage[\\/]db-snapshot\.json(\.bak)?$/.test(String(path));
}

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) => (
      isSnapshotPath(path) || actual.existsSync(path)
    ),
    readFileSync: (path: Parameters<typeof actual.readFileSync>[0], ...args: Parameters<typeof actual.readFileSync>[1][]) => (
      isSnapshotPath(path)
        ? snapshotState.body
        : actual.readFileSync(path, ...args)
    ),
  };
});

import { createDbClient } from "../../../backend/src/db/client.js";
import { loadDbSnapshot, saveDbSnapshot } from "../../../backend/src/db/persistence.js";

describe("db snapshot compatibility", () => {
  it("loads a legacy snapshot without later-added record collections", () => {
    snapshotState.body = JSON.stringify({
      version: "db_snapshot_v1",
      savedAt: "2026-07-08T03:50:14.194Z",
      projects: [["project_1", { id: "project_1", name: "旧项目", status: "topic_candidates_ready" }]],
      events: [],
      topicPackages: [],
      candidateCache: [],
      topicRunCounts: [["project_1", 1]],
      scriptRecords: [],
      storyboardRecords: [],
      assetPlanRecords: [],
      assetManifestRecords: [],
      composeRecords: [],
      renderJobRecords: [],
      topicCandidateStore: {
        project_1: {
          candidatesById: {
            candidate_1: { candidateId: "candidate_1", projectId: "project_1" },
          },
          rounds: [{ roundId: "round_1", roundIndex: 1, createdAt: "2026-07-08T00:00:00.000Z", candidates: [] }],
        },
      },
    });

    const db = createDbClient();
    const topicCandidateStore = new Map();
    const result = loadDbSnapshot(db, topicCandidateStore);

    expect(result).toMatchObject({ ok: true, migratedFrom: "db_snapshot_v1" });
    expect(db.projects.size).toBe(1);
    expect(db.publishPackageRecords.size).toBe(0);
    expect(db.assetProviderJobRecords.size).toBe(0);
    expect(topicCandidateStore.get("project_1")?.rounds).toHaveLength(1);
  });

  it("does not partially mutate db when snapshot is malformed", () => {
    snapshotState.body = '{"version":"db_snapshot_v1","projects":[';

    const db = createDbClient();
    db.projects.set("existing", { id: "existing" } as never);
    const topicCandidateStore = new Map();
    const result = loadDbSnapshot(db, topicCandidateStore);

    expect(result.ok).toBe(false);
    expect(db.projects.has("existing")).toBe(true);
    expect(db.projects.size).toBe(1);
    expect(topicCandidateStore.size).toBe(0);
  });

  it("round-trips provider jobs in snapshot v2 and writes a backup", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-snapshot-v2-"));
    const snapshotPath = join(root, "db-snapshot.json");
    const db = createDbClient();
    db.assetProviderJobRecords.set("job_1", { id: "job_1" } as never);

    expect(saveDbSnapshot(db, new Map(), { snapshotPath })).toMatchObject({ ok: true });
    const saved = JSON.parse(readFileSync(snapshotPath, "utf8"));
    expect(saved.version).toBe("db_snapshot_v2");
    expect(saved.assetProviderJobRecords).toHaveLength(1);

    const reloaded = createDbClient();
    expect(loadDbSnapshot(reloaded, new Map(), { snapshotPath })).toMatchObject({ ok: true, source: "primary" });
    expect(reloaded.assetProviderJobRecords.get("job_1")).toMatchObject({ id: "job_1" });
  });

  it("falls back to a readable backup when the primary snapshot is corrupt", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-snapshot-backup-"));
    const snapshotPath = join(root, "db-snapshot.json");
    const db = createDbClient();
    db.projects.set("project_1", { id: "project_1" } as never);
    saveDbSnapshot(db, new Map(), { snapshotPath });
    saveDbSnapshot(db, new Map(), { snapshotPath });
    writeFileSync(snapshotPath, "{broken", "utf8");

    const reloaded = createDbClient();
    expect(loadDbSnapshot(reloaded, new Map(), { snapshotPath })).toMatchObject({ ok: true, source: "backup" });
    expect(reloaded.projects.has("project_1")).toBe(true);
  });

  it("persists recent recommendation rounds across snapshot reload", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-rounds-"));
    const snapshotPath = join(root, "db-snapshot.json");
    const db = createDbClient();
    db.recommendationRounds.set("project_1", [{
      projectId: "project_1",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      candidates: [{
        eventRegistryEntryId: "event_1",
        eventIdentity: "淝水之战",
        title: "淝水之战",
        fingerprint: "淝水之战::八万晋军击败前秦",
        createdAt: new Date("2026-07-10T00:00:00.000Z"),
      }],
    }]);

    saveDbSnapshot(db, new Map(), { snapshotPath });
    const reloaded = createDbClient();
    loadDbSnapshot(reloaded, new Map(), { snapshotPath });

    expect(reloaded.recommendationRounds.get("project_1")?.[0]?.candidates[0]?.eventIdentity)
      .toBe("淝水之战");
  });
});
