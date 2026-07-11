import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"),
  "utf8",
);

function migratedDatabase(): Database.Database {
  const database = new Database(":memory:");
  database.pragma("foreign_keys = ON");
  database.exec(migrationSql);
  return database;
}

function insertUser(database: Database.Database, id: string): void {
  database.prepare(`
    INSERT INTO "User" (
      "id", "username", "displayName", "passwordHash", "role", "status",
      "mustChangePassword", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, 'hash', 'USER', 'ACTIVE', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, id, id);
}

function insertProject(database: Database.Database, id: string, userId: string): void {
  database.prepare(`
    INSERT INTO "Project" (
      "id", "ownerId", "createdById", "name", "status", "storageKey",
      "storageDisplayName", "storageRenameLocked", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, 'topic_pending', ?, ?, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(id, userId, userId, id, id, id);
}

function insertTopicPackage(database: Database.Database, id: string, projectId: string): void {
  database.prepare(`
    INSERT INTO "TopicPackage" (
      "id", "projectId", "title", "selectedAngle", "familyLabel", "scopeLabel",
      "coreConflict", "strongScene", "packagingSeed", "canonicalQuotesJson",
      "canonicalQuoteIntentsJson", "durationBandJson", "narrativeTensionMapJson",
      "mustIncludeBeatsJson", "forbiddenExpansionsJson", "riskHintsJson",
      "sourceAnchorRefsJson", "ambiguityNotesJson", "createdAt"
    ) VALUES (?, ?, 'title', 'angle', 'family', 'scope', 'conflict', 'scene', 'seed',
      '[]', '[]', '{}', '{}', '[]', '[]', '[]', '[]', '[]', CURRENT_TIMESTAMP)
  `).run(id, projectId);
}

describe("V2 project database integrity", () => {
  it.each([
    ["INVALID", "ACTIVE"],
    ["USER", "INVALID"],
  ])("rejects invalid user role/status values (%s/%s)", (role, status) => {
    const database = migratedDatabase();
    try {
      expect(() => database.prepare(`
        INSERT INTO "User" (
          "id", "username", "displayName", "passwordHash", "role", "status",
          "mustChangePassword", "createdAt", "updatedAt"
        ) VALUES ('invalid-user', 'invalid-user', 'Invalid', 'hash', ?, ?, true,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(role, status)).toThrow(/CHECK constraint failed/);
    } finally {
      database.close();
    }
  });

  it("rejects an active topic package owned by another project", () => {
    const database = migratedDatabase();
    try {
      insertUser(database, "owner");
      insertProject(database, "project-a", "owner");
      insertProject(database, "project-b", "owner");
      insertTopicPackage(database, "topic-b", "project-b");

      expect(() => database.prepare(`
        UPDATE "Project" SET "activeTopicPackageId" = 'topic-b' WHERE "id" = 'project-a'
      `).run()).toThrow(/project_active_topic_package_mismatch/);
    } finally {
      database.close();
    }
  });

  it("rejects a new project initialized with another project's active record", () => {
    const database = migratedDatabase();
    try {
      insertUser(database, "owner");
      insertProject(database, "project-b", "owner");
      insertTopicPackage(database, "topic-b", "project-b");

      expect(() => database.prepare(`
        INSERT INTO "Project" (
          "id", "ownerId", "createdById", "name", "status", "storageKey",
          "storageDisplayName", "storageRenameLocked", "activeTopicPackageId",
          "createdAt", "updatedAt"
        ) VALUES ('project-c', 'owner', 'owner', 'project-c', 'topic_pending',
          'project-c', 'project-c', false, 'topic-b', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run()).toThrow(/project_active_topic_package_mismatch/);
    } finally {
      database.close();
    }
  });

  it("rejects a project without an explicit creator", () => {
    const database = migratedDatabase();
    try {
      insertUser(database, "owner");
      expect(() => database.prepare(`
        INSERT INTO "Project" (
          "id", "ownerId", "name", "status", "storageKey", "storageDisplayName",
          "storageRenameLocked", "createdAt", "updatedAt"
        ) VALUES ('missing-creator', 'owner', 'Missing creator', 'topic_pending',
          'missing-creator', 'Missing creator', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run()).toThrow(/NOT NULL constraint failed: Project\.createdById/);
    } finally {
      database.close();
    }
  });
});
