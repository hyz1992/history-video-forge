import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import type { AssetPlanRecord, ProjectRecord, ScriptRecord, StoryboardRecord } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

const script = (id: string, projectId: string, topicPackageId: string): ScriptRecord => ({ id, projectId, topicPackageId, scriptText: id, openingSpan: "open", endingSpan: "end", estimatedDurationSec: 80, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass", validationResultJson: { decision: "pass" }, semanticReviewResultJson: null, executionStateJson: { generating: false }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() });
const storyboard = (id: string, projectId: string, topicPackageId: string, scriptRecordId: string): StoryboardRecord => ({ id, projectId, topicPackageId, scriptRecordId, planJson: { segments: [] }, validationResultJson: { decision: "pass" }, executionStateJson: { generating: false }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() });
const assetPlan = (id: string, projectId: string, topicPackageId: string, scriptRecordId: string, storyboardRecordId: string): AssetPlanRecord => ({ id, projectId, topicPackageId, scriptRecordId, storyboardRecordId, planJson: { plan_version: "asset_plan_v1", characters: [], locations: [], tasks: [], visual_rules: {}, audio_rules: {} } as never, validationResultJson: { stage: "asset_planning_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} } as never, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() });

const projectRec = (id: string, status: string, ownerId = "owner"): ProjectRecord => ({ id, ownerId, createdById: ownerId, name: id, status, activeTopicPackageId: null, activeScriptRecordId: null, activeStoryboardRecordId: null, activeAssetPlanRecordId: null, activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestTopicRunTraceJson: null, latestScriptRunTraceJson: null, latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null, latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null, storageDisplayName: "", storageShortId: "", storageRootDir: "", storageRenameLocked: false, createdAt: new Date(), updatedAt: new Date() } as ProjectRecord);

describe("Prisma second aggregate writer", () => {
  it("keeps the previous active record until a valid final record is atomically activated", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-second-writer-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.create({ data: { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "ADMIN" } });
      for (const id of ["p1", "p2"]) await client.project.create({ data: { id, ownerId: "owner", createdById: "owner", name: id, storageKey: id, storageDisplayName: id } });
      for (const [id, projectId] of [["t1", "p1"], ["t2", "p2"]]) await client.topicPackage.create({ data: { id, projectId, title: id, selectedAngle: "a", familyLabel: "f", scopeLabel: "s", coreConflict: "c", strongScene: "s", packagingSeed: "p", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
      const writer = new PrismaSecondAggregateWriter(client, "owner");
      const oldScript = script("old-script", "p1", "t1"); await writer.saveScript(oldScript);
      await client.project.update({ where: { id: "p1" }, data: { activeScriptRecordId: oldScript.id, status: "script_ready" } });
      const generating = script("new-script", "p1", "t1"); generating.executionStateJson = { generating: true };
      await writer.saveScript(generating);
      await expect(client.project.findUnique({ where: { id: "p1" } })).resolves.toMatchObject({ activeScriptRecordId: "old-script" });
      await writer.activateScript(projectRec("p1", "script_ready"), generating);
      await expect(client.project.findUnique({ where: { id: "p1" } })).resolves.toMatchObject({ activeScriptRecordId: "new-script", status: "script_ready" });

      const otherScript = script("other-script", "p2", "t2"); await writer.saveScript(otherScript);
      const badStoryboard = storyboard("bad-storyboard", "p1", "t1", otherScript.id); await writer.saveStoryboard(badStoryboard);
      await expect(writer.activateStoryboard(projectRec("p1", "storyboard_ready"), badStoryboard)).rejects.toThrow("storyboard_activation_project_mismatch");
      await expect(client.project.findUnique({ where: { id: "p1" } })).resolves.toMatchObject({ activeStoryboardRecordId: null, activeScriptRecordId: "new-script" });

      const goodStoryboard = storyboard("storyboard", "p1", "t1", generating.id); await writer.saveStoryboard(goodStoryboard);
      await writer.activateStoryboard(projectRec("p1", "storyboard_ready"), goodStoryboard);
      const plan = assetPlan("plan", "p1", "t1", generating.id, goodStoryboard.id); await writer.saveAssetPlan(plan);
      await writer.activateAssetPlan(projectRec("p1", "asset_plan_ready"), plan);
      await expect(client.project.findUnique({ where: { id: "p1" } })).resolves.toMatchObject({ activeStoryboardRecordId: "storyboard", activeAssetPlanRecordId: "plan", status: "asset_plan_ready" });
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });

  it("activateScript passes with project.ownerId different from writer constructor ownerId", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-second-writer-multi-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.create({ data: { id: "user-a", username: "usera", displayName: "User A", passwordHash: "x", role: "USER" } });
      await client.user.create({ data: { id: "local-owner", username: "local", displayName: "Local Owner", passwordHash: "x", role: "ADMIN" } });
      await client.project.create({ data: { id: "p", ownerId: "user-a", createdById: "user-a", name: "p", storageKey: "p", storageDisplayName: "p" } });
      await client.topicPackage.create({ data: { id: "t", projectId: "p", title: "t", selectedAngle: "a", familyLabel: "f", scopeLabel: "s", coreConflict: "c", strongScene: "s", packagingSeed: "p", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });

      const writer = new PrismaSecondAggregateWriter(client, "local-owner");
      const s = script("s", "p", "t"); await writer.saveScript(s);
      await client.project.update({ where: { id: "p" }, data: { activeScriptRecordId: s.id, status: "script_ready" } });

      await writer.activateScript(projectRec("p", "script_ready", "user-a"), s);
      await expect(client.project.findUnique({ where: { id: "p" } })).resolves.toMatchObject({ activeScriptRecordId: "s", status: "script_ready" });
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });
});
