import { createPrismaClient } from "../db/prisma-client.js";
import { importV1Snapshot, type V1ImportRepairPolicy } from "../db/migration/import-v1-snapshot.js";
import { verifyV1Import } from "../db/migration/verify-v1-import.js";

async function main(): Promise<void> {
  const [sourcePath, defaultOwnerId, repairFlag] = process.argv.slice(2);
  if (!sourcePath || !defaultOwnerId) {
    throw new Error("usage: migrate-v1-data <snapshot-path> <default-owner-id> [--repair-known-safe]");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const repairPolicy: V1ImportRepairPolicy | undefined = repairFlag === "--repair-known-safe"
    ? "repair_known_safe_cache_and_active_publish"
    : undefined;
  const client = await createPrismaClient(databaseUrl);
  try {
    const result = await importV1Snapshot(client, { sourcePath, defaultOwnerId, repairPolicy });
    const verification = await verifyV1Import(client, sourcePath);
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
