import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";


describe("first aggregate Prisma hydration parity", () => {
  it("reconstructs project, event, topic, cache, recommendation memory, and runtime storage fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-first-aggregate-"));
    const path = join(root, "test.db"); const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      const user = await client.user.create({ data: { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "ADMIN" } });
      const project = await client.project.create({ data: { id: "project", ownerId: user.id, createdById: user.id, name: "Project", status: "topic_candidates_ready", storageKey: "stable-project-key", storageDisplayName: "Project" } });
      const event = await client.eventRegistryEntry.create({ data: { id: "event", canonicalName: "晏子使楚", aliasesJson: ["晏婴使楚"], canonicalQuotesJson: ["橘生淮南"], canonicalQuoteIntentsJson: [{ quote: "橘生淮南", intent: "反击" }], sourceType: "provisional", isProvisional: true } });
      await client.topicPackage.create({ data: { id: "topic", projectId: project.id, eventRegistryEntryId: event.id, title: "晏子使楚", selectedAngle: "外交反击", familyLabel: "外交", scopeLabel: "单事件", coreConflict: "羞辱与反击", strongScene: "朝堂", stakes: "国格", packagingSeed: "seed", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: { band: "medium" }, narrativeTensionMapJson: {}, mustIncludeBeatsJson: ["入楚"], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
      await client.recommendationCandidateCache.create({ data: { id: "cache", projectId: project.id, eventRegistryEntryId: event.id, eventIdentity: "晏子使楚", fingerprint: "fp", oneLineAngle: "外交反击", familyLabel: "外交", scopeLabel: "单事件", viralRubricJson: { hook: "羞辱" }, estimatedDurationBandJson: "medium", strongScene: "朝堂", coreConflict: "羞辱与反击", mustCoverPreviewJson: ["入楚"], sourceHint: "史记", recentUsageHint: "近期未使用", whyThisNow: "冲突鲜明", riskHintsJson: ["勿夸张"] } });
      await client.recommendationRound.create({ data: { projectId: project.id, roundIndex: 1, exposures: { create: [{ eventRegistryEntryId: event.id, eventIdentity: "晏子使楚", title: "晏子使楚", fingerprint: "fp", selectedAt: new Date() }] } } });
      const db = createDbClient(); const candidateState = new Map();
      await hydrateFirstAggregates(db, candidateState, client, { storageRoot: root });
      expect(db.projects.get(project.id)).toMatchObject({ name: "Project", storageRootDir: join(root, "storage", "projects", "stable-project-key") });
      expect(db.events.get(event.id)).toMatchObject({ canonicalName: "晏子使楚", aliases: ["晏婴使楚"] });
      expect(db.topicPackages.get("topic")).toMatchObject({ selectedAngle: "外交反击", mustIncludeBeatsJson: ["入楚"] });
      expect(db.candidateCache.get("cache")).toMatchObject({ fingerprint: "fp", viralRubricJson: { hook: "羞辱" } });
      expect(db.recommendationRounds.get(project.id)?.[0]?.candidates[0]).toMatchObject({ eventIdentity: "晏子使楚", fingerprint: "fp" });
      expect(db.topicRunCounts.get(project.id)).toBe(1);
      expect(candidateState.get(project.id)?.rounds[0]?.candidates[0]).toMatchObject({
        candidateId: expect.any(String), oneLineAngle: "外交反击", sourceHint: "史记",
        recentUsageHint: "近期未使用", whyThisNow: "冲突鲜明", riskHints: ["勿夸张"],
      });
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });
});
