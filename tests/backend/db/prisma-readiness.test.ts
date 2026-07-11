import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { expectedMigrations } from "../../../backend/src/db/migration-manifest.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { checkPrismaReadiness } from "../../../backend/src/db/prisma-readiness.js";

const migrationSql = readFileSync(join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"), "utf8");
const tempDirectories: string[] = [];

function databasePath(options: { migrated?: boolean; checksum?: string; failed?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "story-forge-readiness-"));
  tempDirectories.push(root);
  const path = join(root, "test.db");
  const db = new Database(path);
  if (options.migrated !== false) {
    const expected = expectedMigrations()[0]!;
    db.exec(migrationSql);
    db.exec(`CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY NOT NULL,"checksum" TEXT NOT NULL,"finished_at" DATETIME,"migration_name" TEXT NOT NULL,"logs" TEXT,"rolled_back_at" DATETIME,"started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0)`);
    db.prepare(`INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","rolled_back_at","migration_name","applied_steps_count") VALUES (?,?,?,?,?,1)`)
      .run("migration-1", options.checksum ?? expected.checksum, options.failed ? null : new Date().toISOString(), options.failed ? new Date().toISOString() : null, expected.name);
  }
  db.close();
  return path;
}

async function verifiedLegacy(client: Awaited<ReturnType<typeof createPrismaClient>>): Promise<string> {
  const sourceSha256 = "verified-source";
  await client.dataMigrationRun.create({ data: {
    sourceSha256, sourceVersion: "db_snapshot_v2", status: "verified",
    reportJson: { verification: { ok: true } }, completedAt: new Date(),
  } });
  return sourceSha256;
}

afterEach(() => { for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("Prisma readiness", () => {
  it("accepts an explicitly activated fresh database without a fake legacy run", async () => {
    const client = await createPrismaClient(databasePath());
    try {
      await activateDatabase(client, { mode: "fresh" });
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: true, error: null });
      await expect(client.dataMigrationRun.count()).resolves.toBe(0);
    } finally { await client.$disconnect(); }
  });

  it("accepts a legacy database only after the matching verified run is activated", async () => {
    const client = await createPrismaClient(databasePath());
    try {
      const sourceSha256 = await verifiedLegacy(client);
      await activateDatabase(client, { mode: "legacy_import", sourceSha256 });
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: true });
      await expect(client.dataMigrationRun.findUnique({ where: { sourceSha256 } })).resolves.toMatchObject({ status: "activated" });
    } finally { await client.$disconnect(); }
  });

  it("refuses legacy activation without the matching verified migration run", async () => {
    const client = await createPrismaClient(databasePath());
    try {
      await expect(activateDatabase(client, { mode: "legacy_import", sourceSha256: "missing" }))
        .rejects.toThrow("activation_legacy_import_not_verified");
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: false, error: "database_not_activated" });
    } finally { await client.$disconnect(); }
  });

  it("rejects missing, failed, and checksum-drifted migrations", async () => {
    for (const [path, error] of [
      [databasePath({ migrated: false }), "database_migration_unavailable"],
      [databasePath({ failed: true }), "database_migration_failed"],
      [databasePath({ checksum: "drifted" }), "database_migration_checksum_mismatch"],
    ] as const) {
      const client = await createPrismaClient(path);
      try { await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: false, error }); }
      finally { await client.$disconnect(); }
    }
  });

  it("rejects an unactivated database and does not leave the main-database write probe", async () => {
    const client = await createPrismaClient(databasePath());
    try {
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: false, error: "database_not_activated" });
      await expect(client.dataMigrationRun.count({ where: { sourceVersion: "readiness_probe" } })).resolves.toBe(0);
    } finally { await client.$disconnect(); }
  });

  it("rejects invalid pragmas, a read-only connection, and foreign-key corruption", async () => {
    const client = await createPrismaClient(databasePath());
    try {
      await activateDatabase(client, { mode: "fresh" });
      await client.$queryRawUnsafe("PRAGMA busy_timeout = 1");
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ error: "sqlite_busy_timeout_invalid" });
      await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
      await client.$queryRawUnsafe("PRAGMA query_only = ON");
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ error: "database_not_writable" });
      await client.$queryRawUnsafe("PRAGMA query_only = OFF");
      await client.$queryRawUnsafe("PRAGMA foreign_keys = OFF");
      await client.$executeRawUnsafe(`INSERT INTO "Project" ("id","ownerId","createdById","name","status","storageKey","storageDisplayName","createdAt","updatedAt") VALUES ('broken','missing','missing','broken','topic_pending','broken','broken',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`);
      await client.$queryRawUnsafe("PRAGMA foreign_keys = ON");
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ error: "database_foreign_key_check_failed" });
    } finally { await client.$disconnect(); }
  });
});
