import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaProjectStore } from "../../../backend/src/db/repositories/prisma-project-store.js";
import { PrismaRecommendationStore } from "../../../backend/src/db/repositories/prisma-recommendation-store.js";

const migrationSql = readFileSync(
  join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"),
  "utf8",
);
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

      await expect(store.findAccessibleById(project.id, owner.id)).resolves.toMatchObject({ id: project.id });
      await expect(store.findAccessibleById(project.id, other.id)).resolves.toBeNull();
      await expect(store.listByOwner(owner.id)).resolves.toHaveLength(1);
      await expect(store.updateStatus(project.id, "topic_candidates_ready")).resolves.toMatchObject({
        status: "topic_candidates_ready",
      });
    } finally {
      await firstClient.$disconnect();
    }

    const restartedClient = await createPrismaClient(databasePath);
    try {
      await expect(new PrismaProjectStore(restartedClient).findAccessibleById(projectId, ownerId))
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
      await expect(store.listRecentEventIdentities(projectId, 10)).resolves.toEqual([
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

      await expect(store.updateActiveRecords(first.id, { activeTopicPackageId: topic.id }))
        .rejects.toThrow("project_active_record_mismatch:activeTopicPackageId");
      await expect(store.findAccessibleById(first.id, owner.id))
        .resolves.toMatchObject({ activeTopicPackageId: null });
    } finally {
      await client.$disconnect();
    }
  });
});
