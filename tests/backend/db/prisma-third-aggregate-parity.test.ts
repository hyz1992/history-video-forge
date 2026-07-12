import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { hydrateSecondAggregates } from "../../../backend/src/db/repositories/prisma-second-aggregate-hydrator.js";
import { hydrateThirdAggregates } from "../../../backend/src/db/repositories/prisma-third-aggregate-hydrator.js";
import type { AppPrismaClient } from "../../../backend/src/db/prisma-client.types.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

async function seedChain(client: AppPrismaClient, prefix: string, ownerId: string) {
  const ids = Object.fromEntries(["project", "topic", "script", "storyboard", "plan", "manifest", "compose", "render", "publish", "job"].map((name) => [name, `${prefix}-${name}`]));
  await client.project.create({ data: { id: ids.project, ownerId, createdById: ownerId, name: prefix, storageKey: ids.project, storageDisplayName: prefix } });
  await client.topicPackage.create({ data: { id: ids.topic, projectId: ids.project, title: prefix, selectedAngle: "a", familyLabel: "f", scopeLabel: "s", coreConflict: "c", strongScene: "s", packagingSeed: "p", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
  await client.scriptRecord.create({ data: { id: ids.script, projectId: ids.project, topicPackageId: ids.topic, scriptText: "script", openingSpan: "open", endingSpan: "end", estimatedDurationSec: 10, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass" } });
  await client.storyboardRecord.create({ data: { id: ids.storyboard, projectId: ids.project, topicPackageId: ids.topic, scriptRecordId: ids.script, planJson: { segments: [] }, validationResultJson: { decision: "pass" } } });
  await client.assetPlanRecord.create({ data: { id: ids.plan, projectId: ids.project, topicPackageId: ids.topic, scriptRecordId: ids.script, storyboardRecordId: ids.storyboard, planJson: { tasks: [] }, validationResultJson: { decision: "pass" }, executionStateJson: {} } });
  await client.assetManifestRecord.create({ data: { id: ids.manifest, projectId: ids.project, topicPackageId: ids.topic, scriptRecordId: ids.script, storyboardRecordId: ids.storyboard, assetPlanRecordId: ids.plan, manifestJson: { artifacts: [{ id: "a1", created_at: "2026-07-12T00:00:00.000Z" }] }, validationResultJson: { decision: "ready_for_compose" }, executionStateJson: { generating: false }, runtimeDiagnosticsJson: { checks: [{ code: "ok" }] } } });
  await client.composeRecord.create({ data: { id: ids.compose, projectId: ids.project, assetManifestRecordId: ids.manifest, timelineJson: { tracks: [{ id: "visual" }] }, validationResultJson: { decision: "ready_for_render" }, executionStateJson: { activated: true } } });
  await client.renderJobRecord.create({ data: { id: ids.render, projectId: ids.project, composeRecordId: ids.compose, assetManifestRecordId: ids.manifest, status: "completed", profileJson: { width: 1080 }, outputArtifactJson: { artifact_id: "video", file_uri: "renders/output.mp4", mime_type: "video/mp4", duration_sec: 10, width: 1080, height: 1920, fps: 30, file_size_bytes: 1 }, validationResultJson: { stage: "render_local_validation", decision: "ready_for_render", errors: [], warnings: [], metrics: {} }, executionStateJson: { activated: true } } });
  await client.publishPackageRecord.create({ data: { id: ids.publish, projectId: ids.project, renderJobRecordId: ids.render, topicPackageId: ids.topic, scriptRecordId: ids.script, storyboardRecordId: ids.storyboard, assetManifestRecordId: ids.manifest, packageJson: { title: "package" }, validationResultJson: { decision: "ready" }, executionStateJson: { generating: false } } });
  const submittedAt = new Date("2026-07-12T01:02:03.000Z");
  await client.assetProviderJobRecord.create({ data: { id: ids.job, assetManifestRecordId: ids.manifest, assetRunId: `${prefix}-run`, executionId: "exec", taskId: "task", providerType: "image", providerName: "provider", providerJobId: "remote-1", status: "running", attemptCount: 1, rawRequestJson: { prompt: "x" }, rawResponseJson: { state: "queued" }, submittedAt, lastPolledAt: submittedAt } });
  await client.project.update({ where: { id: ids.project }, data: { status: "publish_ready", activeTopicPackageId: ids.topic, activeScriptRecordId: ids.script, activeStoryboardRecordId: ids.storyboard, activeAssetPlanRecordId: ids.plan, activeAssetManifestRecordId: ids.manifest, activeComposeRecordId: ids.compose, activeRenderJobRecordId: ids.render, activePublishPackageRecordId: ids.publish } });
  return ids;
}

describe("third aggregate Prisma hydration parity", () => {
  it("restores downstream records and provider jobs only for the selected owner", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-third-aggregate-"));
    const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.createMany({ data: [
        { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "ADMIN" },
        { id: "other", username: "other", displayName: "Other", passwordHash: "x", role: "USER" },
      ] });
      const owned = await seedChain(client, "owned", "owner");
      const foreign = await seedChain(client, "foreign", "other");
      const db = createDbClient();
      await hydrateFirstAggregates(db, new Map(), client, { storageRoot: root, ownerId: "owner" });
      await hydrateSecondAggregates(db, client);
      await hydrateThirdAggregates(db, client);

      expect(db.assetManifestRecords.get(owned.manifest)).toMatchObject({ manifestJson: { artifacts: [{ id: "a1", created_at: "2026-07-12T00:00:00.000Z" }] } });
      expect(db.composeRecords.get(owned.compose)).toMatchObject({ timelineJson: { tracks: [{ id: "visual" }] } });
      expect(db.renderJobRecords.get(owned.render)).toMatchObject({ status: "completed", outputArtifactJson: { file_uri: "renders/output.mp4" } });
      expect(db.publishPackageRecords.get(owned.publish)).toMatchObject({ packageJson: { title: "package" } });
      expect(db.assetProviderJobRecords.get(owned.job)).toMatchObject({ status: "running", rawRequestJson: { prompt: "x" }, submittedAt: new Date("2026-07-12T01:02:03.000Z") });
      expect(db.assetManifestRecords.has(foreign.manifest)).toBe(false);
      expect(db.assetProviderJobRecords.has(foreign.job)).toBe(false);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
