import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { recordProjectRecommendationRound, saveCachedCandidate } from "../../../backend/src/modules/cache/candidate-cache.repository.js";
import { createProvisionalEvent } from "../../../backend/src/modules/events/event-registry.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { confirmTopicCandidate } from "../../../backend/src/modules/topic/topic-confirm.service.js";
import { normalizeEventInput } from "../../../backend/src/modules/topic/event-normalizer.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

describe("Prisma first aggregate writer", () => {
  it("persists the first aggregate, disables JSON writes, and hydrates after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-first-writer-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try {
      const owner = await client.user.create({ data: { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "ADMIN" } });
      const writer = await PrismaFirstAggregateWriter.create(client, owner.id);
      const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true, firstAggregateWriter: writer });
      const httpCreated = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "HTTP project" } });
      expect(httpCreated.statusCode).toBe(201);
      await expect(client.project.count({ where: { ownerId: owner.id } })).resolves.toBe(1);
      const project = await createProject(app.db, { name: "Draft" });
      const event = await createProvisionalEvent(app.db, { canonicalName: "晏子使楚", canonicalQuotes: ["橘生淮南"], sourceType: "system_recommendation" });
      await normalizeEventInput(app.db, { rawInput: "晏子使楚", canonicalQuotes: ["不辱使命"], canonicalQuoteIntents: [{ quote: "不辱使命", intent: "补充锚点" }] });
      await saveCachedCandidate(app.db, { projectId: project.id, eventRegistryEntryId: event.id, eventIdentity: event.canonicalName, fingerprint: "fp", oneLineAngle: "外交反击", familyLabel: "外交", scopeLabel: "单事件", viralRubricJson: { hook: "羞辱" }, estimatedDurationBandJson: "medium", strongScene: "朝堂", coreConflict: "羞辱与反击", mustCoverPreviewJson: ["入楚", "设局", "反击"], sourceHint: "史记", recentUsageHint: "未使用", whyThisNow: "冲突鲜明", riskHintsJson: ["勿夸张"] });
      await recordProjectRecommendationRound(app.db, { projectId: project.id, candidates: [{ eventRegistryEntryId: event.id, eventIdentity: event.canonicalName, title: event.canonicalName, fingerprint: "fp" }] });
      const candidate = { candidateId: "candidate", projectId: project.id, event, title: "晏子使楚", oneLineAngle: "外交反击", familyLabel: "外交", scopeLabel: "单事件", coreConflict: "羞辱与反击", strongScene: "朝堂", mustCoverPreview: ["入楚", "设局", "反击"], sourceHint: "史记", recentUsageHint: "未使用", whyThisNow: "冲突鲜明", riskHints: ["勿夸张"], viralRubric: { hook: "羞辱" } };
      await confirmTopicCandidate({ projectDb: app.db, project, candidate });
      expect(app.persist()).toEqual({ ok: true, error: null });
      expect(existsSync(join(root, "storage", "db-snapshot.json"))).toBe(false);

      const restartedDb = createDbClient(); const candidateState = new Map();
      await hydrateFirstAggregates(restartedDb, candidateState, client, { storageRoot: root, ownerId: owner.id });
      expect(restartedDb.projects.get(project.id)).toMatchObject({ status: "script_ready", activeTopicPackageId: expect.any(String) });
      expect(restartedDb.topicPackages.size).toBe(1);
      expect(restartedDb.candidateCache.get([...restartedDb.candidateCache.keys()][0]!)).toMatchObject({ sourceHint: "史记", whyThisNow: "冲突鲜明" });
      expect(restartedDb.events.get(event.id)).toMatchObject({ canonicalQuotesJson: ["橘生淮南", "不辱使命"] });
      expect(candidateState.get(project.id)?.rounds[0]?.candidates[0]).toMatchObject({ sourceHint: "史记", riskHints: ["勿夸张"] });
    } finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });

  it("requires an explicit active owner", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-owner-")); const path = join(root, "test.db");
    const sqlite = new Database(path); applyAllDatabaseMigrations(sqlite); sqlite.close();
    const client = await createPrismaClient(path);
    try { await expect(PrismaFirstAggregateWriter.create(client, "missing")).rejects.toThrow("local_project_owner_not_active"); }
    finally { await client.$disconnect(); rmSync(root, { recursive: true, force: true }); }
  });
});
