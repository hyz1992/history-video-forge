import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { hydrateSecondAggregates } from "../../../backend/src/db/repositories/prisma-second-aggregate-hydrator.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

describe("second aggregate Prisma hydration parity", () => {
  it("reconstructs script, storyboard, and asset plan records without changing JSON sidecars", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-second-aggregate-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.create({ data: { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "ADMIN" } });
      await client.project.create({ data: { id: "project", ownerId: "owner", createdById: "owner", name: "Project", storageKey: "project", storageDisplayName: "Project" } });
      await client.topicPackage.create({ data: { id: "topic", projectId: "project", title: "Topic", selectedAngle: "angle", familyLabel: "family", scopeLabel: "scope", coreConflict: "conflict", strongScene: "scene", packagingSeed: "seed", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
      await client.scriptRecord.create({ data: { id: "script", projectId: "project", topicPackageId: "topic", scriptText: "script", openingSpan: "open", endingSpan: "end", estimatedDurationSec: 80, beatTraceJson: [{ beat: 1 }], quoteTraceJson: [], reviewStatus: "passed", validationResultJson: { decision: "pass" }, executionStateJson: { generating: false } } });
      await client.storyboardRecord.create({ data: { id: "storyboard", projectId: "project", topicPackageId: "topic", scriptRecordId: "script", planJson: { segments: [{ id: "s1" }] }, validationResultJson: { decision: "pass" }, executionStateJson: { generating: false } } });
      await client.assetPlanRecord.create({ data: { id: "asset-plan", projectId: "project", topicPackageId: "topic", scriptRecordId: "script", storyboardRecordId: "storyboard", planJson: { asset_tasks: [] }, validationResultJson: { decision: "pass" }, executionStateJson: { generating: false } } });
      const db = createDbClient();
      await hydrateFirstAggregates(db, new Map(), client, { storageRoot: root, ownerId: "owner" });
      await hydrateSecondAggregates(db, client);
      expect(db.scriptRecords.get("script")).toMatchObject({ scriptText: "script", beatTraceJson: [{ beat: 1 }], validationResultJson: { decision: "pass" } });
      expect(db.storyboardRecords.get("storyboard")).toMatchObject({ planJson: { segments: [{ id: "s1" }] }, executionStateJson: { generating: false } });
      expect(db.assetPlanRecords.get("asset-plan")).toMatchObject({ planJson: { asset_tasks: [] }, validationResultJson: { decision: "pass" } });
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });
});
