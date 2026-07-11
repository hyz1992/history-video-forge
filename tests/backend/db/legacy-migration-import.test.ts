import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { importLegacySnapshot } from "../../../backend/src/db/migration/import-legacy-snapshot.js";
import { verifyLegacyImport } from "../../../backend/src/db/migration/verify-legacy-import.js";

const migrationSql = readFileSync(join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"), "utf8");
const tempDirectories: string[] = [];

function createDatabase(): string {
  const root = mkdtempSync(join(tmpdir(), "story-forge-import-db-"));
  tempDirectories.push(root);
  const path = join(root, "test.db");
  const db = new Database(path);
  db.exec(migrationSql);
  db.close();
  return path;
}

function createSnapshot(options: { missingActiveScript?: boolean; repairableGarbage?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "story-forge-import-source-"));
  tempDirectories.push(root);
  const storageRootDir = join(root, "projects", "project-1");
  mkdirSync(storageRootDir, { recursive: true });
  const now = "2026-07-11T00:00:00.000Z";
  const snapshot = {
    version: "db_snapshot_v2",
    savedAt: now,
    projects: [["project-1", {
      id: "project-1", name: "Imported project", status: "script_ready",
      activeTopicPackageId: "topic-1",
      activeScriptRecordId: options.missingActiveScript ? "missing-script" : "script-1",
      activeStoryboardRecordId: null, activeAssetPlanRecordId: null,
      activeAssetManifestRecordId: null, activeComposeRecordId: null,
      activeRenderJobRecordId: null,
      activePublishPackageRecordId: options.repairableGarbage ? "missing-publish" : null,
      latestTopicRunTraceJson: null, latestScriptRunTraceJson: null,
      latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null,
      latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null,
      storageDisplayName: "Imported project", storageShortId: "p_project1",
      storageRootDir, storageRenameLocked: false, createdAt: now, updatedAt: now,
    }]],
    events: [["event-1", {
      id: "event-1", canonicalName: "测试事件", aliases: [], canonicalQuotesJson: [],
      canonicalQuoteIntentsJson: [], sourceType: "curated", isProvisional: false,
      createdAt: now, updatedAt: now,
    }]],
    topicPackages: [["topic-1", {
      id: "topic-1", projectId: "project-1", eventRegistryEntryId: "event-1",
      title: "测试选题", selectedAngle: "测试角度", familyLabel: "history", scopeLabel: "single_event",
      coreConflict: "具体冲突", strongScene: "具体场面", stakes: null, packagingSeed: "包装种子",
      canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: { label: "medium" },
      narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
      riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [], createdAt: now,
    }]],
    candidateCache: options.repairableGarbage ? [
      ["orphan-cache", {
        id: "orphan-cache", projectId: "deleted-project", eventRegistryEntryId: null,
        eventIdentity: "调试事件", fingerprint: "orphan-fp", oneLineAngle: "调试",
        familyLabel: "history", scopeLabel: "single_event", viralRubricJson: {},
        estimatedDurationBandJson: {}, strongScene: "场面", coreConflict: "冲突",
        mustCoverPreviewJson: [], createdAt: now,
      }],
      ["cache-1", {
        id: "cache-1", projectId: "project-1", eventRegistryEntryId: "event-1",
        eventIdentity: "测试事件", fingerprint: "duplicate-fp", oneLineAngle: "角度一",
        familyLabel: "history", scopeLabel: "single_event", viralRubricJson: {},
        estimatedDurationBandJson: {}, strongScene: "场面", coreConflict: "冲突",
        mustCoverPreviewJson: [], createdAt: now,
      }],
      ["cache-2", {
        id: "cache-2", projectId: "project-1", eventRegistryEntryId: "event-1",
        eventIdentity: "测试事件", fingerprint: "duplicate-fp", oneLineAngle: "角度二",
        familyLabel: "history", scopeLabel: "single_event", viralRubricJson: {},
        estimatedDurationBandJson: {}, strongScene: "场面", coreConflict: "冲突",
        mustCoverPreviewJson: [], createdAt: now,
      }],
    ] : [],
    topicRunCounts: [["project-1", 1]],
    scriptRecords: [["script-1", {
      id: "script-1", projectId: "project-1", topicPackageId: "topic-1",
      scriptText: "测试脚本正文", openingSpan: "测试开场", endingSpan: "测试结尾",
      estimatedDurationSec: 60, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
      validationResultJson: null, semanticReviewResultJson: null, executionStateJson: null,
      graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now,
    }]],
    storyboardRecords: [], assetPlanRecords: [], assetManifestRecords: [], composeRecords: [],
    renderJobRecords: [], publishPackageRecords: [], assetProviderJobRecords: [],
    recommendationRounds: [["project-1", [{ projectId: "project-1", createdAt: now, candidates: [
      { eventRegistryEntryId: "event-1", eventIdentity: "测试事件", title: "测试事件", fingerprint: "fp-1", createdAt: now },
    ] }]]],
    topicCandidateStore: {},
  };
  const path = join(root, "db-snapshot.json");
  writeFileSync(path, JSON.stringify(snapshot, null, 2), "utf8");
  return path;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("legacy snapshot idempotent import", () => {
  it("imports once, verifies counts and active records, then returns already_applied", async () => {
    const client = await createPrismaClient(createDatabase());
    try {
      const owner = await client.user.create({ data: { username: "import-admin", passwordHash: "hash", role: "admin" } });
      const sourcePath = createSnapshot();
      const first = await importLegacySnapshot(client, { sourcePath, defaultOwnerId: owner.id });
      const countsAfterFirst = await Promise.all([
        client.project.count(), client.topicPackage.count(), client.scriptRecord.count(),
        client.recommendationRound.count(), client.recommendationExposure.count(),
      ]);
      const second = await importLegacySnapshot(client, { sourcePath, defaultOwnerId: owner.id });

      expect(first.status).toBe("completed");
      expect(second.status).toBe("already_applied");
      expect(await Promise.all([
        client.project.count(), client.topicPackage.count(), client.scriptRecord.count(),
        client.recommendationRound.count(), client.recommendationExposure.count(),
      ])).toEqual(countsAfterFirst);
      expect(await client.dataMigrationRun.count()).toBe(1);
      await expect(verifyLegacyImport(client, sourcePath)).resolves.toMatchObject({
        ok: true,
        danglingActiveReferences: [],
        countMismatches: [],
      });
    } finally {
      await client.$disconnect();
    }
  });

  it("rolls back everything and creates no completed marker for a missing active record", async () => {
    const client = await createPrismaClient(createDatabase());
    try {
      const owner = await client.user.create({ data: { username: "rollback-admin", passwordHash: "hash", role: "admin" } });
      await expect(importLegacySnapshot(client, {
        sourcePath: createSnapshot({ missingActiveScript: true }),
        defaultOwnerId: owner.id,
      })).rejects.toThrow("migration_inspection_failed");
      expect(await client.project.count()).toBe(0);
      expect(await client.dataMigrationRun.count()).toBe(0);
    } finally {
      await client.$disconnect();
    }
  });

  it("applies only explicit safe repairs and records them without changing the source", async () => {
    const client = await createPrismaClient(createDatabase());
    try {
      const owner = await client.user.create({ data: { username: "repair-admin", passwordHash: "hash", role: "admin" } });
      const sourcePath = createSnapshot({ repairableGarbage: true });
      const before = readFileSync(sourcePath, "utf8");
      const result = await importLegacySnapshot(client, {
        sourcePath,
        defaultOwnerId: owner.id,
        repairPolicy: "repair_known_safe_cache_and_active_publish",
      });

      expect(readFileSync(sourcePath, "utf8")).toBe(before);
      expect(result.repairs.map((repair) => repair.code)).toEqual([
        "orphan_candidate_cache_skipped",
        "duplicate_candidate_cache_skipped",
        "missing_active_publish_cleared",
      ]);
      expect(await client.recommendationCandidateCache.count()).toBe(1);
      expect((await client.project.findUniqueOrThrow({ where: { id: "project-1" } })).activePublishPackageRecordId).toBeNull();
    } finally {
      await client.$disconnect();
    }
  });
});
