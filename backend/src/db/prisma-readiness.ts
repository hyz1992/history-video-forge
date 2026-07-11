import type { AppPrismaClient } from "./prisma-client.types.js";
import { expectedMigrations } from "./migration-manifest.js";

export interface PrismaReadinessResult {
  ready: boolean;
  error: string | null;
  checks: {
    queryable: boolean;
    writable: boolean;
    migrationsValid: boolean;
    pragmasValid: boolean;
    integrityValid: boolean;
    activated: boolean;
  };
}

export const emptyPrismaReadinessChecks = () => ({
  queryable: false, writable: false, migrationsValid: false,
  pragmasValid: false, integrityValid: false, activated: false,
});

type MigrationRow = { migration_name: string; checksum: string; finished_at: string | null; rolled_back_at: string | null };
type ActivationRow = { mode: string; migrationName: string; migrationChecksum: string; sourceSha256: string | null };

export async function checkPrismaReadiness(client: AppPrismaClient): Promise<PrismaReadinessResult> {
  const checks = emptyPrismaReadinessChecks();
  const fail = (error: string): PrismaReadinessResult => ({ ready: false, error, checks });
  try {
    await client.$queryRawUnsafe("SELECT 1 AS ok");
    checks.queryable = true;
    const foreignKeys = await client.$queryRawUnsafe<Array<{ foreign_keys: number }>>("PRAGMA foreign_keys");
    const journalMode = await client.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode");
    const busyTimeout = await client.$queryRawUnsafe<Array<{ timeout: number }>>("PRAGMA busy_timeout");
    if (Number(foreignKeys[0]?.foreign_keys) !== 1) return fail("sqlite_foreign_keys_invalid");
    if (journalMode[0]?.journal_mode.toLowerCase() !== "wal") return fail("sqlite_journal_mode_invalid");
    if (Number(busyTimeout[0]?.timeout) !== 5000) return fail("sqlite_busy_timeout_invalid");
    checks.pragmasValid = true;

    const quick = await client.$queryRawUnsafe<Array<{ quick_check: string }>>("PRAGMA quick_check");
    const foreignKeyIssues = await client.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check");
    if (quick.length !== 1 || quick[0]?.quick_check !== "ok") return fail("database_quick_check_failed");
    if (foreignKeyIssues.length > 0) return fail("database_foreign_key_check_failed");
    checks.integrityValid = true;

    const actual = await client.$queryRawUnsafe<MigrationRow[]>(
      `SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`,
    ).catch(() => null);
    if (!actual) return fail("database_migration_unavailable");
    const expected = expectedMigrations();
    if (actual.some((row) => !row.finished_at || row.rolled_back_at)) return fail("database_migration_failed");
    if (actual.length !== expected.length || expected.some((item, index) => actual[index]?.migration_name !== item.name)) {
      return fail("database_migration_set_mismatch");
    }
    if (expected.some((item, index) => actual[index]?.checksum !== item.checksum)) return fail("database_migration_checksum_mismatch");
    checks.migrationsValid = true;

    try {
      await client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
          `INSERT INTO "DataMigrationRun" ("id", "sourceSha256", "sourceVersion", "status", "reportJson", "startedAt", "createdAt", "updatedAt") VALUES (?, ?, 'readiness_probe', 'importing', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          `readiness-${crypto.randomUUID()}`, `readiness-${crypto.randomUUID()}`,
        );
        throw new Error("readiness_probe_rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "readiness_probe_rollback") return fail("database_not_writable");
    }
    checks.writable = true;

    const activation = (await client.$queryRawUnsafe<ActivationRow[]>(
      `SELECT "mode", "migrationName", "migrationChecksum", "sourceSha256" FROM "DatabaseActivation" WHERE "id"='primary'`,
    ))[0];
    if (!activation) return fail("database_not_activated");
    const latest = expected.at(-1)!;
    if (activation.migrationName !== latest.name || activation.migrationChecksum !== latest.checksum) {
      return fail("database_activation_stale");
    }
    if (activation.mode === "legacy_import") {
      if (!activation.sourceSha256) return fail("legacy_import_unverified");
      const run = await client.dataMigrationRun.findUnique({ where: { sourceSha256: activation.sourceSha256 } });
      const report = run?.reportJson as Record<string, any> | null;
      if (!run || run.status !== "activated" || report?.verification?.ok !== true) return fail("legacy_import_unverified");
    } else if (activation.mode !== "fresh" || activation.sourceSha256) {
      return fail("database_activation_invalid");
    }
    checks.activated = true;
    return { ready: true, error: null, checks };
  } catch {
    return fail("database_unavailable");
  }
}
