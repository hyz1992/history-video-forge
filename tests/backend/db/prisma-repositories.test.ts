import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaProjectStore } from "../../../backend/src/db/repositories/prisma-project-store.js";
import { PrismaRecommendationStore } from "../../../backend/src/db/repositories/prisma-recommendation-store.js";

const migrationSql = [
  readFileSync(join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"), "utf8"),
  readFileSync(join(process.cwd(), "backend/prisma/migrations/20260719090219_0002_event_library/migration.sql"), "utf8"),
  readFileSync(join(process.cwd(), "backend/prisma/migrations/20260808155000_topic_recommendation_filter/migration.sql"), "utf8"),
].join("\n");
const tempDirectories: string[] = [];

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "story-forge-repository-"));
  tempDirectories.push(directory);
  const databasePath = join(directory, "test.db");
  const database = new Database(databasePath);
  try {
    database.exec(migrationSql);
  } finally {
    database.close();
  }
  return databasePath;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Prisma repository boundaries", () => {
  it("isolates project reads by owner and persists project updates across restart", async () => {
    const databasePath = createMigratedDatabase();
    const firstClient = await createPrismaClient(databasePath);
    let projectId = "";
    let ownerId = "";
    try {
      const owner = await firstClient.user.create({
        data: { username: "owner", displayName: "Owner", passwordHash: "hash", role: "USER" },
      });
      const other = await firstClient.user.create({
        data: { username: "other", displayName: "Other", passwordHash: "hash", role: "USER" },
      });
      ownerId = owner.id;
      const store = new PrismaProjectStore(firstClient);
      const project = await store.create({
        ownerId: owner.id,
        createdById: owner.id,
        name: "Persistent project",
        storageKey: "persistent-project",
        storageDisplayName: "Persistent project",
      });
      projectId = project.id;

      await expect(store.findByIdForOwner(project.id, owner.id)).resolves.toMatchObject({ id: project.id });
      await expect(store.findByIdForOwner(project.id, other.id)).resolves.toBeNull();
      await expect(store.findByIdForSystem(project.id)).resolves.toMatchObject({ id: project.id });
      await expect(store.listByOwner(owner.id)).resolves.toHaveLength(1);
      await expect(store.updateStatusForOwner(project.id, owner.id, "topic_candidates_ready")).resolves.toMatchObject({
        status: "topic_candidates_ready",
      });
    } finally {
      await firstClient.$disconnect();
    }

    const restartedClient = await createPrismaClient(databasePath);
    try {
      await expect(new PrismaProjectStore(restartedClient).findByIdForOwner(projectId, ownerId))
        .resolves.toMatchObject({ id: projectId, status: "topic_candidates_ready" });
    } finally {
      await restartedClient.$disconnect();
    }
  });

  it("persists recommendation exposures and returns recent event identities across restart", async () => {
    const databasePath = createMigratedDatabase();
    const firstClient = await createPrismaClient(databasePath);
    let projectId = "";
    try {
      const owner = await firstClient.user.create({
        data: { username: "recommendation-owner", displayName: "Recommendation owner", passwordHash: "hash", role: "USER" },
      });
      const project = await new PrismaProjectStore(firstClient).create({
        ownerId: owner.id,
        createdById: owner.id,
        name: "Recommendation project",
        storageKey: "recommendation-project",
        storageDisplayName: "Recommendation project",
      });
      projectId = project.id;
      const store = new PrismaRecommendationStore(firstClient);
      await store.recordRound({
        projectId,
        ownerId: owner.id,
        candidates: [
          { eventRegistryEntryId: null, eventIdentity: "晏子使楚", title: "晏子使楚", fingerprint: "fp-1" },
          { eventRegistryEntryId: null, eventIdentity: "淝水之战", title: "淝水之战", fingerprint: "fp-2" },
        ],
      });
    } finally {
      await firstClient.$disconnect();
    }

    const restartedClient = await createPrismaClient(databasePath);
    try {
      const store = new PrismaRecommendationStore(restartedClient);
      const project = await restartedClient.project.findUniqueOrThrow({ where: { id: projectId } });
      await expect(store.listRecentEventIdentities(projectId, project.ownerId, 10)).resolves.toEqual([
        "晏子使楚",
        "淝水之战",
      ]);
    } finally {
      await restartedClient.$disconnect();
    }
  });

  it("rejects cross-project active records before updating the project", async () => {
    const databasePath = createMigratedDatabase();
    const client = await createPrismaClient(databasePath);
    try {
      const owner = await client.user.create({
        data: { username: "integrity-owner", displayName: "Integrity owner", passwordHash: "hash", role: "USER" },
      });
      const store = new PrismaProjectStore(client);
      const first = await store.create({
        ownerId: owner.id,
        createdById: owner.id,
        name: "First project",
        storageKey: "integrity-first",
        storageDisplayName: "First project",
      });
      const second = await store.create({
        ownerId: owner.id,
        createdById: owner.id,
        name: "Second project",
        storageKey: "integrity-second",
        storageDisplayName: "Second project",
      });
      const topic = await client.topicPackage.create({
        data: {
          projectId: second.id,
          title: "Second topic",
          selectedAngle: "angle",
          familyLabel: "family",
          scopeLabel: "scope",
          coreConflict: "conflict",
          strongScene: "scene",
          packagingSeed: "seed",
          canonicalQuotesJson: [],
          canonicalQuoteIntentsJson: [],
          durationBandJson: {},
          narrativeTensionMapJson: {},
          mustIncludeBeatsJson: [],
          forbiddenExpansionsJson: [],
          riskHintsJson: [],
          sourceAnchorRefsJson: [],
          ambiguityNotesJson: [],
        },
      });

      await expect(store.updateActiveRecordsForOwner(first.id, owner.id, { activeTopicPackageId: topic.id }))
        .rejects.toThrow("project_active_record_mismatch:activeTopicPackageId");
      await expect(store.findByIdForOwner(first.id, owner.id))
        .resolves.toMatchObject({ activeTopicPackageId: null });
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects cross-owner project mutations and recommendation access", async () => {
    const client = await createPrismaClient(createMigratedDatabase());
    try {
      const owner = await client.user.create({ data: { username: "scope-owner", displayName: "Owner", passwordHash: "hash", role: "USER" } });
      const other = await client.user.create({ data: { username: "scope-other", displayName: "Other", passwordHash: "hash", role: "USER" } });
      const projectStore = new PrismaProjectStore(client);
      const project = await projectStore.create({ ownerId: owner.id, createdById: owner.id, name: "Scoped", storageKey: "scoped", storageDisplayName: "Scoped" });
      await expect(projectStore.updateStatusForOwner(project.id, other.id, "archived")).rejects.toThrow("project_scope_denied");
      await expect(projectStore.archiveForOwner(project.id, other.id)).rejects.toThrow("project_scope_denied");
      await expect(projectStore.updateActiveRecordsForOwner(project.id, other.id, {})).rejects.toThrow("project_scope_denied");
      const recommendationStore = new PrismaRecommendationStore(client);
      await expect(recommendationStore.recordRound({ projectId: project.id, ownerId: other.id, candidates: [] })).rejects.toThrow("project_scope_denied");
      await expect(recommendationStore.listRecentEventIdentities(project.id, other.id, 10)).rejects.toThrow("project_scope_denied");
      await expect(recommendationStore.listRecentEventIdentities(project.id, other.id, 0)).rejects.toThrow("project_scope_denied");
      await expect(projectStore.findByIdForOwner(project.id, owner.id)).resolves.toMatchObject({ status: "topic_pending" });
    } finally { await client.$disconnect(); }
  });

  it("serializes concurrent recommendation rounds across two clients", async () => {
    const databasePath = createMigratedDatabase();
    const first = await createPrismaClient(databasePath);
    const second = await createPrismaClient(databasePath);
    try {
      const owner = await first.user.create({ data: { username: "concurrent-owner", displayName: "Owner", passwordHash: "hash", role: "USER" } });
      const project = await new PrismaProjectStore(first).create({ ownerId: owner.id, createdById: owner.id, name: "Concurrent", storageKey: "concurrent", storageDisplayName: "Concurrent" });
      const input = (fingerprint: string) => ({ projectId: project.id, ownerId: owner.id, candidates: [{ eventRegistryEntryId: null, eventIdentity: fingerprint, title: fingerprint, fingerprint }] });
      const rounds = await Promise.all([
        new PrismaRecommendationStore(first).recordRound(input("fp-a")),
        new PrismaRecommendationStore(second).recordRound(input("fp-b")),
      ]);
      expect(rounds.map((round) => round.roundIndex).sort()).toEqual([1, 2]);
      await expect(first.recommendationRound.count({ where: { projectId: project.id } })).resolves.toBe(2);
    } finally { await first.$disconnect(); await second.$disconnect(); }
  });
});
