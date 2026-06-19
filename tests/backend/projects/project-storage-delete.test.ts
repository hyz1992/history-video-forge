import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { deleteProjectStorage } from "../../../backend/src/db/persistence";
import type { ProjectRecord } from "../../../backend/src/db/client";

function createProjectRecord(storageRootDir: string): ProjectRecord {
  const now = new Date("2026-06-19T00:00:00.000Z");
  return {
    id: "delete-storage-test",
    name: "Delete Storage Test",
    status: "topic_pending",
    activeTopicPackageId: null,
    activeScriptRecordId: null,
    activeStoryboardRecordId: null,
    activeAssetPlanRecordId: null,
    activeAssetManifestRecordId: null,
    activeComposeRecordId: null,
    activeRenderJobRecordId: null,
    activePublishPackageRecordId: null,
    latestTopicRunTraceJson: null,
    latestScriptRunTraceJson: null,
    latestStoryboardRunTraceJson: null,
    latestAssetPlanRunTraceJson: null,
    latestAssetsRunTraceJson: null,
    latestComposeRunTraceJson: null,
    latestRenderRunTraceJson: null,
    storageDisplayName: "Delete Storage Test",
    storageShortId: "p_delete1",
    storageRootDir,
    storageRenameLocked: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("project storage deletion", () => {
  it("removes project metadata directory under storage/projects", () => {
    const storageRootDir =
      "storage/projects/2099-01-01/Delete Storage Test [p_delete1]";
    const absoluteDir = resolve(storageRootDir);
    mkdirSync(absoluteDir, { recursive: true });
    writeFileSync(join(absoluteDir, "project.json"), "{}", "utf8");

    expect(existsSync(absoluteDir)).toBe(true);

    deleteProjectStorage(createProjectRecord(storageRootDir));

    expect(existsSync(absoluteDir)).toBe(false);
  });
});
