import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { checkPrismaReadiness } from "../../../backend/src/db/prisma-readiness.js";

const migrationSql = readFileSync(join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"), "utf8");
const tempDirectories: string[] = [];

function databasePath(migrated: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "story-forge-readiness-"));
  tempDirectories.push(root);
  const path = join(root, "test.db");
  const db = new Database(path);
  if (migrated) {
    db.exec(migrationSql);
    db.exec(`
      CREATE TABLE "_prisma_migrations" (
        "id" TEXT PRIMARY KEY NOT NULL,
        "checksum" TEXT NOT NULL,
        "finished_at" DATETIME,
        "migration_name" TEXT NOT NULL,
        "logs" TEXT,
        "rolled_back_at" DATETIME,
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
      );
      INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
      VALUES ('migration-1', 'test-checksum', CURRENT_TIMESTAMP, '0001_v2_baseline', 1);
    `);
  }
  db.close();
  return path;
}

async function markVerified(client: Awaited<ReturnType<typeof createPrismaClient>>): Promise<void> {
  await client.dataMigrationRun.create({ data: {
    sourceSha256: "verified-source",
    sourceVersion: "db_snapshot_v2",
    status: "verified",
    reportJson: { verification: { ok: true, countMismatches: [], danglingActiveReferences: [] } },
    completedAt: new Date(),
  } });
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Prisma readiness", () => {
  it("is ready only when migration, pragmas, writes, and legacy verification pass", async () => {
    const client = await createPrismaClient(databasePath(true));
    try {
      await markVerified(client);
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: true, error: null });
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects a database without applied migrations", async () => {
    const client = await createPrismaClient(databasePath(false));
    try {
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({
        ready: false,
        error: "database_migration_unavailable",
      });
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects an unverified legacy import", async () => {
    const client = await createPrismaClient(databasePath(true));
    try {
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({
        ready: false,
        error: "legacy_import_unverified",
      });
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects invalid pragmas and a non-writable connection", async () => {
    const client = await createPrismaClient(databasePath(true));
    try {
      await markVerified(client);
      await client.$queryRawUnsafe("PRAGMA busy_timeout = 1");
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: false, error: "sqlite_busy_timeout_invalid" });
      await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
      await client.$queryRawUnsafe("PRAGMA query_only = ON");
      await expect(checkPrismaReadiness(client)).resolves.toMatchObject({ ready: false, error: "database_not_writable" });
    } finally {
      await client.$disconnect();
    }
  });
});
