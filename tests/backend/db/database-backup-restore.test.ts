import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { expectedMigrations } from "../../../backend/src/db/migration-manifest.js";
import { backupDatabase } from "../../../backend/src/db/operations/backup-database.js";
import { restoreDatabase } from "../../../backend/src/db/operations/restore-database.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { checkPrismaReadiness } from "../../../backend/src/db/prisma-readiness.js";

const migrationSql = readFileSync(join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"), "utf8");
const roots: string[] = [];

function createOperationalDatabase(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "story-forge-backup-")); roots.push(root);
  const path = join(root, "primary.db");
  const db = new Database(path);
  const migration = expectedMigrations()[0]!;
  db.exec(migrationSql);
  db.exec(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL,"checksum" TEXT NOT NULL,"finished_at" DATETIME,"migration_name" TEXT NOT NULL,"logs" TEXT,"rolled_back_at" DATETIME,"started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES (?,?,?,?,1)`).run("migration-1", migration.checksum, new Date().toISOString(), migration.name);
  db.close();
  return { root, path };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("SQLite backup and restore operations", () => {
  it("backs up and restores an activated database with its project active chain", async () => {
    const fixture = createOperationalDatabase();
    const client = await createPrismaClient(fixture.path);
    let projectId = "";
    try {
      const owner = await client.user.create({ data: { username: "backup-owner", displayName: "Owner", passwordHash: "hash", role: "ADMIN" } });
      const project = await client.project.create({ data: { ownerId: owner.id, createdById: owner.id, name: "Before backup", storageKey: "backup-project", storageDisplayName: "Backup project" } });
      projectId = project.id;
      const topic = await client.topicPackage.create({ data: {
        projectId, title: "Active topic", selectedAngle: "angle", familyLabel: "family", scopeLabel: "scope",
        coreConflict: "conflict", strongScene: "scene", packagingSeed: "seed", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [],
        durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
      } });
      await client.project.update({ where: { id: projectId }, data: { activeTopicPackageId: topic.id } });
      await activateDatabase(client, { mode: "fresh" });
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: true });
    } finally { await client.$disconnect(); }

    const backup = await backupDatabase({ sourcePath: fixture.path, destinationDirectory: join(fixture.root, "backups"), timestamp: new Date("2026-07-11T12:00:00.000Z") });
    expect(existsSync(backup.path)).toBe(true);
    expect(backup.path).toContain(backup.checksum.slice(0, 16));
    expect(backup.path).toContain(expectedMigrations()[0]!.name);
    expect(backup.validated).toBe(true);

    const mutated = await createPrismaClient(fixture.path);
    try { await mutated.project.update({ where: { id: projectId }, data: { name: "After backup", activeTopicPackageId: null } }); }
    finally { await mutated.$disconnect(); }

    await expect(restoreDatabase({ backupPath: backup.path, targetPath: fixture.path, confirm: false, serviceStopped: true })).rejects.toThrow("restore_confirmation_required");
    const restored = await restoreDatabase({ backupPath: backup.path, targetPath: fixture.path, confirm: true, serviceStopped: true, safetyBackupDirectory: join(fixture.root, "safety") });
    expect(restored.safetyBackup?.path).toBeTruthy();
    expect(restored.safetyBackup?.validated).toBe(false);
    const verified = await createPrismaClient(fixture.path);
    try {
      await expect(checkPrismaReadiness(verified)).resolves.toMatchObject({ ready: true });
      const project = await verified.project.findUniqueOrThrow({ where: { id: projectId }, include: { activeTopicPackage: true } });
      expect(project).toMatchObject({ name: "Before backup", activeTopicPackage: { title: "Active topic" } });
      await expect(Promise.all([verified.user.count(), verified.project.count(), verified.topicPackage.count()]))
        .resolves.toEqual([1, 1, 1]);
    } finally { await verified.$disconnect(); }
    appendFileSync(backup.path, "tampered");
    await expect(restoreDatabase({ backupPath: backup.path, targetPath: fixture.path, confirm: true, serviceStopped: true }))
      .rejects.toThrow("restore_backup_checksum_mismatch");
  });

  it("requires a stopped service before restore", async () => {
    const fixture = createOperationalDatabase();
    await expect(restoreDatabase({ backupPath: fixture.path, targetPath: join(fixture.root, "other.db"), confirm: true, serviceStopped: false }))
      .rejects.toThrow("restore_requires_stopped_service");
  });
});
