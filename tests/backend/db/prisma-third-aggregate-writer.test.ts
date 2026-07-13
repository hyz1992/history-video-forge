import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { AssetManifestRecord, AssetProviderJobRecord, ComposeRecord, ProjectRecord, PublishPackageRecord, RenderJobRecord } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

const projectRec = (id: string, status: string, ownerId = "owner"): ProjectRecord => ({ id, ownerId, createdById: ownerId, name: id, status, activeTopicPackageId: null, activeScriptRecordId: null, activeStoryboardRecordId: null, activeAssetPlanRecordId: null, activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestTopicRunTraceJson: null, latestScriptRunTraceJson: null, latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null, latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null, storageDisplayName: "", storageShortId: "", storageRootDir: "", storageRenameLocked: false, createdAt: new Date(), updatedAt: new Date() } as ProjectRecord);

describe("Prisma third aggregate save-only writer", () => {
  it("upserts downstream history and provider jobs without changing active pointers", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-third-writer-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.create({ data: { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "ADMIN" } });
      await client.project.create({ data: { id: "p", ownerId: "owner", createdById: "owner", name: "p", storageKey: "p", storageDisplayName: "p" } });
      await client.topicPackage.create({ data: { id: "t", projectId: "p", title: "t", selectedAngle: "a", familyLabel: "f", scopeLabel: "s", coreConflict: "c", strongScene: "s", packagingSeed: "p", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
      await client.scriptRecord.create({ data: { id: "s", projectId: "p", topicPackageId: "t", scriptText: "s", openingSpan: "o", endingSpan: "e", estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass" } });
      await client.storyboardRecord.create({ data: { id: "b", projectId: "p", topicPackageId: "t", scriptRecordId: "s", planJson: {}, validationResultJson: {} } });
      await client.assetPlanRecord.create({ data: { id: "ap", projectId: "p", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", planJson: {}, validationResultJson: {}, executionStateJson: {} } });
      const writer = new PrismaThirdAggregateWriter(client); const now = new Date("2026-07-12T00:00:00.000Z");
      const manifest = { id: "m", projectId: "p", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", assetPlanRecordId: "ap", manifestJson: { readiness: "generating" }, validationResultJson: {}, executionStateJson: { generating: true }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now } satisfies AssetManifestRecord;
      await writer.saveAssetManifest(manifest, "owner");
      const compose = { id: "c", projectId: "p", assetManifestRecordId: "m", timelineJson: {}, validationResultJson: {}, executionStateJson: { generating: true }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now } satisfies ComposeRecord;
      await writer.saveCompose(compose, "owner");
      const render = { id: "r", projectId: "p", composeRecordId: "c", assetManifestRecordId: "m", status: "rendering", profileJson: {}, outputArtifactJson: null, validationResultJson: { stage: "render_local_validation", decision: "ready_for_render", errors: [], warnings: [], metrics: {} }, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now, updatedAt: now } satisfies RenderJobRecord;
      await writer.saveRender(render, "owner"); render.status = "completed"; render.updatedAt = new Date("2026-07-12T00:01:00.000Z"); await writer.saveRender(render, "owner");
      const publish = { id: "pub", projectId: "p", renderJobRecordId: "r", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", assetManifestRecordId: "m", packageJson: { title: "v1" }, validationResultJson: null, executionStateJson: { generating: true }, createdAt: now, updatedAt: now } satisfies PublishPackageRecord;
      await writer.savePublish(publish, "owner"); publish.packageJson = { title: "v2" }; await writer.savePublish(publish, "owner");
      const job = { id: "job-a", assetManifestRecordId: "m", assetRunId: "run", executionId: "exec", taskId: "task", providerType: "image", providerName: "provider", providerJobId: null, status: "prepared", attemptCount: 0, rawRequestJson: {}, rawResponseJson: null, errorCode: null, errorMessage: null, submittedAt: null, lastPolledAt: null, completedAt: null, createdAt: now, updatedAt: now } satisfies AssetProviderJobRecord;
      const first = await writer.saveProviderJob(job, "owner"); const retry = await writer.saveProviderJob({ ...job, id: "job-b", status: "running", providerJobId: "remote" }, "owner");

      expect(first.id).toBe("job-a"); expect(retry.id).toBe("job-a");
      await expect(client.assetProviderJobRecord.count()).resolves.toBe(1);
      await expect(client.renderJobRecord.findUnique({ where: { id: "r" } })).resolves.toMatchObject({ status: "completed" });
      await expect(client.publishPackageRecord.findUnique({ where: { id: "pub" } })).resolves.toMatchObject({ packageJson: { title: "v2" } });
      await expect(client.project.findUnique({ where: { id: "p" } })).resolves.toMatchObject({ activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null });
      const project = projectRec("p", "asset_plan_ready"); project.latestAssetsRunTraceJson = { run: "assets" };
      await expect(writer.activateAssetManifest(project, manifest)).rejects.toThrow("asset_manifest_activation_stale_source");
      await client.project.update({ where: { id: "p" }, data: { activeAssetPlanRecordId: "ap" } });
      project.status = "assets_ready"; await writer.activateAssetManifest(project, manifest);
      project.status = "compose_ready"; project.latestComposeRunTraceJson = { run: "compose" }; await writer.activateCompose(project, compose);
      project.status = "render_ready"; project.latestRenderRunTraceJson = { run: "render" }; await writer.activateRender(project, render);
      project.status = "publish_ready"; await writer.activatePublish(project, publish);
      await expect(client.project.findUnique({ where: { id: "p" } })).resolves.toMatchObject({ activeAssetManifestRecordId: "m", activeComposeRecordId: "c", activeRenderJobRecordId: "r", activePublishPackageRecordId: "pub", status: "publish_ready" });

      await expect(writer.saveCompose({ ...compose, id: "foreign-compose" }, "other-owner")).rejects.toThrow("project_scope_denied");
      await expect(writer.saveProviderJob({ ...job, id: "foreign-job", attemptCount: 2 }, "other-owner")).rejects.toThrow("asset_manifest_scope_denied");
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });

  it("saveAssetManifest succeeds with project.ownerId different from LOCAL_PROJECT_OWNER_ID", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-third-writer-multi-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.create({ data: { id: "user-a", username: "usera", displayName: "User A", passwordHash: "x", role: "USER" } });
      await client.project.create({ data: { id: "p", ownerId: "user-a", createdById: "user-a", name: "p", storageKey: "p", storageDisplayName: "p" } });
      await client.topicPackage.create({ data: { id: "t", projectId: "p", title: "t", selectedAngle: "a", familyLabel: "f", scopeLabel: "s", coreConflict: "c", strongScene: "s", packagingSeed: "p", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
      await client.scriptRecord.create({ data: { id: "s", projectId: "p", topicPackageId: "t", scriptText: "s", openingSpan: "o", endingSpan: "e", estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass" } });
      await client.storyboardRecord.create({ data: { id: "b", projectId: "p", topicPackageId: "t", scriptRecordId: "s", planJson: {}, validationResultJson: {} } });
      await client.assetPlanRecord.create({ data: { id: "ap", projectId: "p", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", planJson: {}, validationResultJson: {}, executionStateJson: {} } });

      const writer = new PrismaThirdAggregateWriter(client); const now = new Date();
      const manifest = { id: "m", projectId: "p", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", assetPlanRecordId: "ap", manifestJson: {}, validationResultJson: {}, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now } satisfies AssetManifestRecord;
      await writer.saveAssetManifest(manifest, "user-a");
      await expect(client.assetManifestRecord.count()).resolves.toBe(1);

      const project = projectRec("p", "asset_plan_ready", "user-a"); project.latestAssetsRunTraceJson = {};
      await client.project.update({ where: { id: "p" }, data: { activeAssetPlanRecordId: "ap" } });
      project.status = "assets_ready"; await writer.activateAssetManifest(project, manifest);
      await expect(client.project.findUnique({ where: { id: "p" } })).resolves.toMatchObject({ activeAssetManifestRecordId: "m", status: "assets_ready" });

      await expect(writer.saveAssetManifest({ ...manifest, id: "wrong" }, "other-owner")).rejects.toThrow("project_scope_denied");
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });
});
