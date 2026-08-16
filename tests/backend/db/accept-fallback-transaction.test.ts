import { describe, expect, it, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";
import type {
  AssetManifestRecord,
  GenerationRunRecord,
  RunConfigurationSnapshotRecord,
} from "../../../backend/src/db/client.js";

const tempDirectories: string[] = [];

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "svf-accept-fallback-"));
  tempDirectories.push(directory);
  const databasePath = join(directory, "test.db");
  const database = new Database(databasePath);
  try {
    applyAllDatabaseMigrations(database);
  } finally {
    database.close();
  }
  return databasePath;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function snapshotRecord(projectId: string, id: string): RunConfigurationSnapshotRecord {
  return {
    id, projectId, userId: null, stage: "assets", operation: "assets.generate", runId: null,
    projectConfigurationRevision: 1, schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "fnv1a64:111111111111abc1",
    resolvedConfigurationJson: {}, resolutionTraceJson: [],
    quoteId: null, quoteFingerprint: null,
    estimatedCostMicros: "0", authorizationCostMicros: "0",
    budgetLimitMicros: null, budgetOverrideAuthorized: false,
    pricingHash: null, pricingVersionSetJson: [],
    createdAt: new Date(), updatedAt: new Date(),
  };
}

function runRecord(projectId: string, id: string, snapshotId: string): GenerationRunRecord {
  return {
    id, projectId, userId: null, operation: "assets.generate", idempotencyKey: `key-${id}`,
    payloadFingerprint: "fp", quoteId: null, runConfigurationSnapshotId: snapshotId,
    dispatchPayloadJson: {}, status: "running",
    dispatchLeaseOwner: null, dispatchLeaseExpiresAt: null, dispatchClaimCount: 0,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

async function seedSourceChain(
  client: { topicPackage: { create: (a: unknown) => Promise<unknown> }; scriptRecord: { create: (a: unknown) => Promise<unknown> }; storyboardRecord: { create: (a: unknown) => Promise<unknown> }; assetPlanRecord: { create: (a: unknown) => Promise<unknown> } },
  projectId: string,
) {
  await client.topicPackage.create({
    data: { id: "topic_1", projectId, title: "T", selectedAngle: "A", familyLabel: "F", scopeLabel: "S", coreConflict: "C", strongScene: "S", packagingSeed: "P", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], narrativeTensionMapJson: {}, ambiguityNotesJson: [] },
  });
  await client.scriptRecord.create({
    data: { id: "script_1", projectId, topicPackageId: "topic_1", scriptText: "text", openingSpan: "o", endingSpan: "e", estimatedDurationSec: 5, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass" },
  });
  await client.storyboardRecord.create({
    data: { id: "storyboard_1", projectId, topicPackageId: "topic_1", scriptRecordId: "script_1", planJson: {}, validationResultJson: {} },
  });
  await client.assetPlanRecord.create({
    data: { id: "asset_plan_1", projectId, topicPackageId: "topic_1", scriptRecordId: "script_1", storyboardRecordId: "storyboard_1", planJson: {}, validationResultJson: {}, executionStateJson: {} },
  });
}

function manifestRecord(projectId: string, id: string, revision: number): AssetManifestRecord {
  return {
    id, projectId, revision,
    topicPackageId: "topic_1",
    scriptRecordId: "script_1",
    storyboardRecordId: "storyboard_1",
    assetPlanRecordId: "asset_plan_1",
    manifestJson: {
      manifest_version: "asset_manifest_v1",
      segment_routes: [{ segment_id: "sb_001", readiness: "blocked_waiting_user" }],
    },
    validationResultJson: { stage: "assets_local_validation", decision: "blocked" },
    executionStateJson: { run_id: "run_1", activated: true },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  };
}

describe("S2-2A accept-fallback Prisma transaction", () => {
  it("commits manifest CAS, project status, event and audit atomically with exactly one event", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await client.project.create({
        data: { id: "p1", name: "P1", ownerId: "u1", createdById: "u1", status: "assets_blocked", storageKey: "p1", storageDisplayName: "P1", storageRenameLocked: false },
      });
      await seedSourceChain(client as never, "p1");
      const writer = new PrismaThirdAggregateWriter(client);
      await writer.appendRunConfigurationSnapshot(snapshotRecord("p1", "snap1"));
      await writer.saveGenerationRun(runRecord("p1", "run_1", "snap1"));
      await writer.saveAssetManifest(manifestRecord("p1", "manifest_1", 1), "u1");

      const candidate = manifestRecord("p1", "manifest_1", 1);
      candidate.manifestJson = {
        ...candidate.manifestJson,
        segment_routes: [{ segment_id: "sb_001", readiness: "ready", fallback_decision: "user_accepted" }],
      };
      candidate.validationResultJson = { stage: "assets_local_validation", decision: "partial", errors: [], warnings: ["assets_video_fallback_used"], metrics: {} };

      const applied = await writer.acceptSegmentFallbackCommit?.({
        manifestRecord: candidate,
        expectedRevision: 1,
        projectStatus: "assets_partial",
        actorUserId: "u1",
        projectOwnerId: "u1",
        runId: "run_1",
        segmentId: "sb_001",
      });
      expect(applied).toBe(true);

      // manifest revision 递增，内容为候选
      const row = await client.assetManifestRecord.findUnique({ where: { id: "manifest_1" } });
      expect(row?.revision).toBe(2);
      expect((row?.manifestJson as { segment_routes: Array<{ fallback_decision: string }> }).segment_routes[0]!.fallback_decision).toBe("user_accepted");

      // event 恰好一条（事务内创建，事务后无重复写入）
      const events = await client.generationRunEvent.findMany({ where: { generationRunId: "run_1" } });
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("fallback_accepted");
      expect((events[0]!.eventJson as Record<string, unknown>).actor_user_id).toBe("u1");
      expect((events[0]!.eventJson as Record<string, unknown>).old_route).toBe("video_clip");
      expect((events[0]!.eventJson as Record<string, unknown>).new_route).toBe("image_with_motion");

      // audit 恰好一条且带 actor
      const audits = await client.auditLog.findMany({ where: { projectId: "p1" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.action).toBe("assets.accept_fallback");
      expect(audits[0]!.actorUserId).toBe("u1");

      // 项目状态已更新
      const project = await client.project.findUnique({ where: { id: "p1" } });
      expect(project?.status).toBe("assets_partial");
    } finally {
      await client.$disconnect();
    }
  });

  it("only one concurrent accept succeeds and the loser leaves no writes", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await client.project.create({
        data: { id: "p1", name: "P1", ownerId: "u1", createdById: "u1", status: "assets_blocked", storageKey: "p1", storageDisplayName: "P1", storageRenameLocked: false },
      });
      await seedSourceChain(client as never, "p1");
      const writer = new PrismaThirdAggregateWriter(client);
      await writer.appendRunConfigurationSnapshot(snapshotRecord("p1", "snap1"));
      await writer.saveGenerationRun(runRecord("p1", "run_1", "snap1"));
      await writer.saveAssetManifest(manifestRecord("p1", "manifest_1", 1), "u1");

      const commit = () => {
        const candidate = manifestRecord("p1", "manifest_1", 1);
        candidate.manifestJson = {
          ...candidate.manifestJson,
          segment_routes: [{ segment_id: "sb_001", readiness: "ready", fallback_decision: "user_accepted" }],
        };
        return writer.acceptSegmentFallbackCommit!({
          manifestRecord: candidate,
          expectedRevision: 1,
          projectStatus: "assets_partial",
          actorUserId: "u1",
          projectOwnerId: "u1",
          runId: "run_1",
          segmentId: "sb_001",
        });
      };

      const [first, second] = await Promise.all([commit(), commit()]);
      expect([first, second].filter(Boolean)).toHaveLength(1);

      // 无论谁赢，最终只有一次提交：revision=2、event=1、audit=1
      const row = await client.assetManifestRecord.findUnique({ where: { id: "manifest_1" } });
      expect(row?.revision).toBe(2);
      const events = await client.generationRunEvent.findMany({ where: { generationRunId: "run_1" } });
      expect(events).toHaveLength(1);
      const audits = await client.auditLog.findMany({ where: { projectId: "p1" } });
      expect(audits).toHaveLength(1);
    } finally {
      await client.$disconnect();
    }
  });

  it("rolls back everything when the run event parent is missing", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      await client.user.create({ data: { id: "u1", username: "t", displayName: "T", passwordHash: "h", role: "USER" } });
      await client.project.create({
        data: { id: "p1", name: "P1", ownerId: "u1", createdById: "u1", status: "assets_blocked", storageKey: "p1", storageDisplayName: "P1", storageRenameLocked: false },
      });
      await seedSourceChain(client as never, "p1");
      const writer = new PrismaThirdAggregateWriter(client);
      // 不创建 GenerationRun → 事务内 event 外键失败 → 整体回滚
      await writer.saveAssetManifest(manifestRecord("p1", "manifest_1", 1), "u1");

      const candidate = manifestRecord("p1", "manifest_1", 1);
      candidate.manifestJson = {
        ...candidate.manifestJson,
        segment_routes: [{ segment_id: "sb_001", readiness: "ready", fallback_decision: "user_accepted" }],
      };
      await expect(
        writer.acceptSegmentFallbackCommit!({
          manifestRecord: candidate,
          expectedRevision: 1,
          projectStatus: "assets_partial",
          actorUserId: "u1",
          projectOwnerId: "u1",
          runId: "run_missing",
          segmentId: "sb_001",
        }),
      ).rejects.toThrow();

      // 回滚：manifest revision 未变、项目状态未变、无 event/audit
      const row = await client.assetManifestRecord.findUnique({ where: { id: "manifest_1" } });
      expect(row?.revision).toBe(1);
      const project = await client.project.findUnique({ where: { id: "p1" } });
      expect(project?.status).toBe("assets_blocked");
      const events = await client.generationRunEvent.findMany();
      expect(events).toHaveLength(0);
      const audits = await client.auditLog.findMany();
      expect(audits).toHaveLength(0);
    } finally {
      await client.$disconnect();
    }
  });
});
