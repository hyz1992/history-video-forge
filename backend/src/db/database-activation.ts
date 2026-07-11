import type { AppPrismaClient } from "./prisma-client.types.js";
import { expectedMigrations } from "./migration-manifest.js";

export type DatabaseActivationMode = "fresh" | "legacy_import";

export async function activateDatabase(
  client: AppPrismaClient,
  options: { mode: DatabaseActivationMode; sourceSha256?: string },
): Promise<void> {
  const migrations = expectedMigrations();
  const latest = migrations.at(-1);
  if (!latest) throw new Error("database_migration_manifest_empty");
  if (options.mode === "legacy_import") {
    if (!options.sourceSha256) throw new Error("activation_source_required");
    const run = await client.dataMigrationRun.findUnique({ where: { sourceSha256: options.sourceSha256 } });
    if (!run || run.status !== "verified") throw new Error("activation_legacy_import_not_verified");
  } else if (options.sourceSha256) {
    throw new Error("activation_fresh_source_forbidden");
  }
  await client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(
      `INSERT INTO "DatabaseActivation" ("id", "mode", "schemaVersion", "migrationName", "migrationChecksum", "sourceSha256", "activatedAt", "updatedAt")
       VALUES ('primary', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT("id") DO UPDATE SET "mode"=excluded."mode", "schemaVersion"=excluded."schemaVersion", "migrationName"=excluded."migrationName", "migrationChecksum"=excluded."migrationChecksum", "sourceSha256"=excluded."sourceSha256", "activatedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP`,
      options.mode, latest.name, latest.name, latest.checksum, options.sourceSha256 ?? null,
    );
    if (options.mode === "legacy_import") {
      await transaction.dataMigrationRun.update({
        where: { sourceSha256: options.sourceSha256! },
        data: { status: "activated" },
      });
    }
  });
}
