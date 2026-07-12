import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { AssetManifestRecord, AssetProviderJobRecord, ComposeRecord, ProjectRecord, PublishPackageRecord, RenderJobRecord } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

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
      const writer = new PrismaThirdAggregateWriter(client, "owner"); const now = new Date("2026-07-12T00:00:00.000Z");
      const manifest = { id: "m", projectId: "p", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", assetPlanRecordId: "ap", manifestJson: { readiness: "generating" }, validationResultJson: {}, executionStateJson: { generating: true }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now } satisfies AssetManifestRecord;
      await writer.saveAssetManifest(manifest);
      const compose = { id: "c", projectId: "p", assetManifestRecordId: "m", timelineJson: {}, validationResultJson: {}, executionStateJson: { generating: true }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now } satisfies ComposeRecord;
      await writer.saveCompose(compose);
      const render = { id: "r", projectId: "p", composeRecordId: "c", assetManifestRecordId: "m", status: "rendering", profileJson: {}, outputArtifactJson: null, validationResultJson: { stage: "render_local_validation", decision: "ready_for_render", errors: [], warnings: [], metrics: {} }, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: now, updatedAt: now } satisfies RenderJobRecord;
      await writer.saveRender(render); render.status = "completed"; render.updatedAt = new Date("2026-07-12T00:01:00.000Z"); await writer.saveRender(render);
      const publish = { id: "pub", projectId: "p", renderJobRecordId: "r", topicPackageId: "t", scriptRecordId: "s", storyboardRecordId: "b", assetManifestRecordId: "m", packageJson: { title: "v1" }, validationResultJson: null, executionStateJson: { generating: true }, createdAt: now, updatedAt: now } satisfies PublishPackageRecord;
      await writer.savePublish(publish); publish.packageJson = { title: "v2" }; await writer.savePublish(publish);
      const job = { id: "job-a", assetManifestRecordId: "m", assetRunId: "run", executionId: "exec", taskId: "task", providerType: "image", providerName: "provider", providerJobId: null, status: "prepared", attemptCount: 0, rawRequestJson: {}, rawResponseJson: null, errorCode: null, errorMessage: null, submittedAt: null, lastPolledAt: null, completedAt: null, createdAt: now, updatedAt: now } satisfies AssetProviderJobRecord;
      const first = await writer.saveProviderJob(job); const retry = await writer.saveProviderJob({ ...job, id: "job-b", status: "running", providerJobId: "remote" });

      expect(first.id).toBe("job-a"); expect(retry.id).toBe("job-a");
      await expect(client.assetProviderJobRecord.count()).resolves.toBe(1);
      await expect(client.renderJobRecord.findUnique({ where: { id: "r" } })).resolves.toMatchObject({ status: "completed" });
      await expect(client.publishPackageRecord.findUnique({ where: { id: "pub" } })).resolves.toMatchObject({ packageJson: { title: "v2" } });
      await expect(client.project.findUnique({ where: { id: "p" } })).resolves.toMatchObject({ activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null });
      const project = { id: "p", status: "asset_plan_ready", latestAssetsRunTraceJson: { run: "assets" }, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null } as ProjectRecord;
      await expect(writer.activateAssetManifest(project, manifest)).rejects.toThrow("asset_manifest_activation_stale_source");
      await client.project.update({ where: { id: "p" }, data: { activeAssetPlanRecordId: "ap" } });
      project.status = "assets_ready"; await writer.activateAssetManifest(project, manifest);
      project.status = "compose_ready"; project.latestComposeRunTraceJson = { run: "compose" }; await writer.activateCompose(project, compose);
      project.status = "render_ready"; project.latestRenderRunTraceJson = { run: "render" }; await writer.activateRender(project, render);
      project.status = "publish_ready"; await writer.activatePublish(project, publish);
      await expect(client.project.findUnique({ where: { id: "p" } })).resolves.toMatchObject({ activeAssetManifestRecordId: "m", activeComposeRecordId: "c", activeRenderJobRecordId: "r", activePublishPackageRecordId: "pub", status: "publish_ready" });
      const foreignWriter = new PrismaThirdAggregateWriter(client, "other-owner");
      await expect(foreignWriter.saveCompose({ ...compose, id: "foreign-compose" })).rejects.toThrow("project_scope_denied");
      await expect(foreignWriter.saveProviderJob({ ...job, id: "foreign-job", attemptCount: 2 })).rejects.toThrow("asset_manifest_scope_denied");
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });
});
