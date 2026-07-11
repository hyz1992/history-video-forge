import type { AppPrismaClient } from "./prisma-client.types.js";

export interface PrismaReadinessResult {
  ready: boolean;
  error: string | null;
  checks: {
    queryable: boolean;
    writable: boolean;
    migrationApplied: boolean;
    pragmasValid: boolean;
    legacyImportVerified: boolean;
  };
}

const emptyChecks = () => ({
  queryable: false,
  writable: false,
  migrationApplied: false,
  pragmasValid: false,
  legacyImportVerified: false,
});

export async function checkPrismaReadiness(client: AppPrismaClient): Promise<PrismaReadinessResult> {
  const checks = emptyChecks();
  try {
    await client.$queryRawUnsafe("SELECT 1 AS ok");
    checks.queryable = true;

    const foreignKeys = await client.$queryRawUnsafe<Array<{ foreign_keys: bigint | number }>>("PRAGMA foreign_keys");
    const journalMode = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
    const busyTimeout = await client.$queryRawUnsafe<Array<{ timeout: bigint | number }>>("PRAGMA busy_timeout");
    if (Number(foreignKeys[0]?.foreign_keys) !== 1) return { ready: false, error: "sqlite_foreign_keys_invalid", checks };
    if (journalMode[0]?.journal_mode.toLowerCase() !== "wal") return { ready: false, error: "sqlite_journal_mode_invalid", checks };
    if (Number(busyTimeout[0]?.timeout) !== 5000) return { ready: false, error: "sqlite_busy_timeout_invalid", checks };
    checks.pragmasValid = true;

    try {
      await client.$executeRawUnsafe("CREATE TEMP TABLE IF NOT EXISTS __readiness_probe (id INTEGER PRIMARY KEY)");
      await client.$executeRawUnsafe("INSERT INTO __readiness_probe DEFAULT VALUES");
      await client.$executeRawUnsafe("DELETE FROM __readiness_probe");
      checks.writable = true;
    } catch {
      return { ready: false, error: "database_not_writable", checks };
    }

    try {
      const migrations = await client.$queryRawUnsafe<Array<{ count: bigint | number }>>(
        "SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
      );
      if (Number(migrations[0]?.count) < 1) return { ready: false, error: "database_migration_unavailable", checks };
      checks.migrationApplied = true;
    } catch {
      return { ready: false, error: "database_migration_unavailable", checks };
    }

    const migrationRun = await client.dataMigrationRun.findFirst({
      where: { status: { in: ["verified", "activated"] } },
      orderBy: { completedAt: "desc" },
    });
    const report = migrationRun?.reportJson;
    const verification = report && typeof report === "object" && !Array.isArray(report)
      ? (report as Record<string, unknown>).verification
      : null;
    const verified = verification && typeof verification === "object" && !Array.isArray(verification)
      && (verification as Record<string, unknown>).ok === true;
    if (!verified) return { ready: false, error: "legacy_import_unverified", checks };
    checks.legacyImportVerified = true;

    return { ready: true, error: null, checks };
  } catch {
    return { ready: false, error: "database_unavailable", checks };
  }
}
