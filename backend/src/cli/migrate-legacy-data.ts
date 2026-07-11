import { createPrismaClient } from "../db/prisma-client.js";
import { importLegacySnapshot, type LegacyImportRepairPolicy } from "../db/migration/import-legacy-snapshot.js";
import { verifyLegacyImport } from "../db/migration/verify-legacy-import.js";

async function main(): Promise<void> {
  const [sourcePath, defaultOwnerId, repairFlag] = process.argv.slice(2);
  if (!sourcePath || !defaultOwnerId) {
    throw new Error("usage: migrate-legacy-data <snapshot-path> <default-owner-id> [--repair-known-safe]");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const repairPolicy: LegacyImportRepairPolicy | undefined = repairFlag === "--repair-known-safe"
    ? "repair_known_safe_cache_and_active_publish"
    : undefined;
  const client = await createPrismaClient(databaseUrl);
  try {
    const result = await importLegacySnapshot(client, { sourcePath, defaultOwnerId, repairPolicy });
    const verification = await verifyLegacyImport(client, sourcePath);
    process.stdout.write(`${JSON.stringify({ result, verification }, null, 2)}\n`);
    if (!verification.ok) process.exitCode = 1;
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
