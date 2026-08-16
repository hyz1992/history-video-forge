import { describe, expect, it, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { acceptSegmentFallback } from "../../../backend/src/modules/assets/assets-run.service.js";
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

describe("S2-2A accept-fallback service over real Prisma writer", () => {
  it("accepts through the service without losing writer this-binding", async () => {
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

      // 内存 db 镜像（service 读取的视图），并挂真实 Prisma writer
      const db = createDbClient();
      const project = await createProject(db, { name: "P1", ownerId: "u1" });
      project.id = "p1";
      project.status = "assets_blocked";
      db.projects.set("p1", project);
      const dbManifest = manifestRecord("p1", "manifest_1", 1);
      dbManifest.manifestJson = {
        manifest_version: "asset_manifest_v1",
        segment_routes: [
          {
            segment_id: "sb_001",
            tts_artifact_id: null,
            subtitle_artifact_id: null,
            primary_visual_artifact_id: "artifact_img_1",
            visual_route_type: "video_clip",
            motion_artifact_id: "artifact_motion_1",
            fallback_visual_artifact_id: "artifact_img_1",
            sfx_artifact_ids: [],
            bgm_placement_ids: [],
            readiness: "blocked_waiting_user",
            notes: [],
          },
        ],
        executions: [
          { execution_id: "exec_img_1", task_id: "task_img_1", task_type: "image_still", status: "completed", origin: "provider", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:00:00.000Z", provider_id: "fake", attempts: 1, output_artifact_ids: ["artifact_img_1"], notes: [] },
          { execution_id: "exec_motion_1", task_id: "task_motion_1", task_type: "render_motion_cue", status: "completed", origin: "local", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:00:00.000Z", provider_id: null, attempts: 0, output_artifact_ids: ["artifact_motion_1"], notes: [] },
          { execution_id: "exec_video_1", task_id: "task_video_1", task_type: "video_clip", status: "failed", origin: "provider", started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:00:00.000Z", provider_id: "fake", attempts: 1, output_artifact_ids: [], notes: [] },
        ],
        artifacts: [
          { artifact_id: "artifact_img_1", artifact_type: "image", origin: "provider", file_uri: "generated://img.png", created_at: "2026-01-01T00:00:00.000Z", metadata: {} },
          { artifact_id: "artifact_motion_1", artifact_type: "motion_recipe", origin: "inline", file_uri: "inline://motion-recipe/1", created_at: "2026-01-01T00:00:00.000Z", metadata: {} },
        ],
        audio_summary: {
          voice_profile_id: "v",
          tts_total_duration_sec: null,
          tts_chunk_artifact_ids: [],
          tts_chunk_routes: [],
          tts_merged_artifact_id: null,
          subtitle_artifact_id: null,
          bgm_placements: [],
          sfx_artifact_ids: [],
        },
      };
      dbManifest.executionStateJson = { run_id: "run_1", activated: true };
      db.assetManifestRecords.set("manifest_1", dbManifest);
      project.activeAssetManifestRecordId = "manifest_1";
      db.assetPlanRecords.set("asset_plan_1", {
        id: "asset_plan_1",
        projectId: "p1",
        topicPackageId: "topic_1",
        scriptRecordId: "script_1",
        storyboardRecordId: "storyboard_1",
        planJson: {
          plan_version: "asset_plan_v1",
          source_storyboard_record_id: "storyboard_1",
          source_script_record_id: "script_1",
          source_topic_package_id: "topic_1",
          art_bible: {},
          visual_budget: {},
          downgrade_policy: {},
          global_audio_strategy: {},
          tts_plan: { voice_profile_id: "v", estimated_total_duration_sec: 5, chunking_strategy: "segment_boundary", chunks: [] },
          tasks: [
            { task_id: "task_img_1", order: 0, task_type: "image_still", source_segment_id: "sb_001", source_excerpt: "x", production_intent: "i", recommended_mode: "auto", provider_hint: null, prompt_draft: null, parameters: {}, manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] }, risk_notes: [], cost_tier: "low", initial_status: "planned" },
            { task_id: "task_motion_1", order: 1, task_type: "render_motion_cue", source_segment_id: "sb_001", source_excerpt: "x", production_intent: "m", recommended_mode: "auto", provider_hint: null, prompt_draft: null, parameters: {}, manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] }, risk_notes: [], cost_tier: "free", initial_status: "planned" },
            { task_id: "task_video_1", order: 2, task_type: "video_clip", source_segment_id: "sb_001", source_excerpt: "x", production_intent: "v", recommended_mode: "auto", provider_hint: null, prompt_draft: null, parameters: {}, manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] }, risk_notes: [], cost_tier: "high", initial_status: "planned" },
          ],
          dependencies: [],
          cost_summary: { total_tasks: 3, by_type: {}, by_cost_tier: { free: 0, low: 0, medium: 0, high: 0 }, estimated_provider_calls: 0, notes: [] },
          global_production_notes: [],
        },
        validationResultJson: { stage: "asset_planning_local_validation", decision: "pass" },
        executionStateJson: {},
        graphTraceSummaryJson: null,
        runtimeDiagnosticsJson: null,
        createdAt: new Date(),
      });
      db.generationRuns.set("run_1", runRecord("p1", "run_1", "snap1"));
      db.thirdAggregateWriter = writer as never;

      const response = await acceptSegmentFallback({
        db,
        project,
        runId: "run_1",
        segmentId: "sb_001",
        expectedRunId: "run_1",
        expectedVersion: "1",
        actorUserId: "u1",
      });

      // 服务层经真实 writer 事务路径成功（不再 TypeError）
      expect(response.statusCode).toBe(200);
      const body = response.body as { version: string; manifest: { segment_routes: Array<{ fallback_decision: string }> } };
      expect(body.version).toBe("2");
      expect(body.manifest.segment_routes[0]!.fallback_decision).toBe("user_accepted");

      // 数据库侧：revision=2、event 恰好一条、audit 一条
      const row = await client.assetManifestRecord.findUnique({ where: { id: "manifest_1" } });
      expect(row?.revision).toBe(2);
      const events = await client.generationRunEvent.findMany({ where: { generationRunId: "run_1" } });
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe("fallback_accepted");
      const audits = await client.auditLog.findMany({ where: { projectId: "p1" } });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.actorUserId).toBe("u1");

      // 进程内事件视图已镜像
      expect(db.generationRunEvents.get("run_1") ?? []).toHaveLength(1);
    } finally {
      await client.$disconnect();
    }
  });
});
