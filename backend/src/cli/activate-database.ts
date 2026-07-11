import { activateDatabase, type DatabaseActivationMode } from "../db/database-activation.js";
import { normalizedDatabaseUrl } from "../db/database-url.js";
import { createPrismaClient } from "../db/prisma-client.js";

async function main(): Promise<void> {
  const mode = process.argv[2] as DatabaseActivationMode | undefined;
  if (mode !== "fresh" && mode !== "legacy_import") {
    throw new Error("usage: activate-database <fresh|legacy_import> [sourceSha256]");
  }
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) throw new Error("DATABASE_URL is required");
  const client = await createPrismaClient(normalizedDatabaseUrl(configured));
  try {
    await activateDatabase(client, { mode, sourceSha256: process.argv[3] });
    console.log(JSON.stringify({ status: "activated", mode, sourceSha256: process.argv[3] ?? null }));
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: "activation_failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
