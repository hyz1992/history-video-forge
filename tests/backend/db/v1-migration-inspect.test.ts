import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectV1Snapshot } from "../../../backend/src/db/migration/inspect-v1-snapshot.js";

const tempDirectories: string[] = [];

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("V1 snapshot migration inspection", () => {
  it("reports counts, duplicate ids, orphan records, active references, and missing storage without writes", () => {
    const root = mkdtempSync(join(tmpdir(), "story-forge-inspect-"));
    tempDirectories.push(root);
    const validStorage = join(root, "projects", "valid-project");
    mkdirSync(validStorage, { recursive: true });
    const snapshotPath = join(root, "db-snapshot.json");
    const project = {
      id: "project-1",
      name: "Valid project",
      status: "script_ready",
      activeTopicPackageId: "topic-1",
      activeScriptRecordId: "missing-script",
      storageRootDir: validStorage,
    };
    writeFileSync(snapshotPath, JSON.stringify({
      version: "db_snapshot_v2",
      savedAt: "2026-07-11T00:00:00.000Z",
      projects: [
        ["project-1", project],
        ["project-1", { ...project, name: "Duplicate project" }],
        ["project-2", {
          ...project,
          id: "project-2",
          name: "Missing storage project",
          activeTopicPackageId: "topic-2",
          activeScriptRecordId: null,
          storageRootDir: join(root, "projects", "missing-project"),
        }],
      ],
      events: [],
      topicPackages: [
        ["topic-1", { id: "topic-1", projectId: "project-1" }],
        ["topic-2", { id: "topic-2", projectId: "project-1" }],
        ["orphan-topic", { id: "orphan-topic", projectId: "missing-project" }],
      ],
      candidateCache: [
        ["cache-1", { id: "cache-1", projectId: "project-1", fingerprint: "same-fingerprint" }],
        ["cache-2", { id: "cache-2", projectId: "project-1", fingerprint: "same-fingerprint" }],
      ],
      topicRunCounts: [],
      scriptRecords: [
        ["script-bad", { id: "script-bad", projectId: "project-1", topicPackageId: "missing-topic" }],
      ],
      storyboardRecords: [],
      assetPlanRecords: [],
      assetManifestRecords: [],
      composeRecords: [],
      renderJobRecords: [],
      publishPackageRecords: [],
      assetProviderJobRecords: [],
      recommendationRounds: [],
      topicCandidateStore: {},
    }, null, 2), "utf8");
    const beforeHash = sha256(snapshotPath);

    const inspection = inspectV1Snapshot(snapshotPath);

    expect(sha256(snapshotPath)).toBe(beforeHash);
    expect(inspection.sourcePath).toBe(snapshotPath);
    expect(inspection.sourceSha256).toBe(beforeHash);
    expect(inspection.counts.projects).toBe(3);
    expect(inspection.counts.topicPackages).toBe(3);
    expect(inspection.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "duplicate_collection_id",
      "project_storage_missing",
      "orphan_project_reference",
      "orphan_foreign_reference",
      "duplicate_candidate_fingerprint",
      "active_record_missing",
      "active_record_project_mismatch",
    ]));
    expect(inspection.canImport).toBe(false);
  });

  it("returns a stable error report for malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "story-forge-inspect-invalid-"));
    tempDirectories.push(root);
    const snapshotPath = join(root, "db-snapshot.json");
    writeFileSync(snapshotPath, "{not-json", "utf8");
    const beforeHash = sha256(snapshotPath);

    const inspection = inspectV1Snapshot(snapshotPath);

    expect(sha256(snapshotPath)).toBe(beforeHash);
    expect(inspection.sourceSha256).toBe(beforeHash);
    expect(inspection.issues).toContainEqual(expect.objectContaining({
      code: "snapshot_invalid_json",
      severity: "error",
    }));
    expect(inspection.canImport).toBe(false);
  });
});
