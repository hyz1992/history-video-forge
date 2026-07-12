import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { activateDatabase } from "../db/database-activation.js";
import { normalizedDatabaseUrl, resolveDatabasePath } from "../db/database-url.js";
import { importLegacySnapshot } from "../db/migration/import-legacy-snapshot.js";
import { verifyLegacyImport } from "../db/migration/verify-legacy-import.js";
import { backupDatabase } from "../db/operations/backup-database.js";
import { restoreDatabase } from "../db/operations/restore-database.js";
import { createPrismaClient } from "../db/prisma-client.js";
import { checkPrismaReadiness } from "../db/prisma-readiness.js";

function has(flag: string): boolean { return process.argv.includes(flag); }
function value(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function withClient<T>(databaseUrl: string, work: (client: Awaited<ReturnType<typeof createPrismaClient>>) => Promise<T>): Promise<T> {
  const client = await createPrismaClient(databaseUrl);
  try { return await work(client); } finally { await client.$disconnect(); }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) throw new Error("DATABASE_URL is required");
  const databasePath = resolveDatabasePath(configured);
  const databaseUrl = normalizedDatabaseUrl(configured);

  if (command === "status") {
    if (!existsSync(databasePath)) return void console.log(JSON.stringify({ ready: false, error: "database_not_initialized", databasePath }, null, 2));
    return void console.log(JSON.stringify(await withClient(databaseUrl, checkPrismaReadiness), null, 2));
  }
  if (command === "init") {
    if (!has("--confirm")) throw new Error("init_confirmation_required");
    if (existsSync(databasePath)) throw new Error("init_target_exists");
    const result = spawnSync("npm", ["exec", "--workspace", "backend", "--", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, encoding: "utf8", shell: process.platform === "win32",
    });
    if (result.status !== 0) throw new Error(`database_init_failed:${result.error?.message || result.stderr || result.stdout || "unknown"}`);
    return void console.log(JSON.stringify({ status: "initialized", databasePath }));
  }
  if (!existsSync(databasePath)) throw new Error("database_not_initialized");
  if (command === "owner-init") {
    const id = value("--id"); const username = value("--username");
    if (!id || !username || !has("--confirm")) throw new Error("usage: owner-init --id <stable-id> --username <name> --confirm");
    await withClient(databaseUrl, async (client) => {
      const activeUsers = await client.user.count({ where: { status: "ACTIVE" } });
      if (activeUsers > 0) throw new Error("migration_owner_already_exists");
      await client.user.create({ data: { id, username, displayName: username, passwordHash: "!migration-owner-no-login", role: "ADMIN", status: "ACTIVE" } });
    });
    return void console.log(JSON.stringify({ status: "migration_owner_created", id, username }));
  }
  if (command === "import") {
    const sourcePath = value("--source"); const ownerId = value("--owner");
    if (!sourcePath || !ownerId || !has("--confirm")) throw new Error("usage: import --source <path> --owner <id> --confirm");
    const result = await withClient(databaseUrl, (client) => importLegacySnapshot(client, { sourcePath, defaultOwnerId: ownerId }));
    return void console.log(JSON.stringify(result, null, 2));
  }
  if (command === "verify") {
    const sourcePath = value("--source"); if (!sourcePath) throw new Error("verify_source_required");
    const result = await withClient(databaseUrl, (client) => verifyLegacyImport(client, sourcePath));
    console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return;
  }
  if (command === "activate") {
    const mode = value("--mode");
    if ((mode !== "fresh" && mode !== "legacy_import") || !has("--confirm")) throw new Error("usage: activate --mode <fresh|legacy_import> [--source-sha256 <sha>] --confirm");
    await withClient(databaseUrl, (client) => activateDatabase(client, { mode, sourceSha256: value("--source-sha256") }));
    return void console.log(JSON.stringify({ status: "activated", mode }));
  }
  if (command === "backup") {
    const destination = value("--destination") ?? resolve(process.cwd(), "storage", "backups");
    return void console.log(JSON.stringify(await backupDatabase({ sourcePath: databasePath, destinationDirectory: destination }), null, 2));
  }
  if (command === "restore") {
    const backupPath = value("--backup"); if (!backupPath) throw new Error("restore_backup_required");
    const result = await restoreDatabase({ backupPath, targetPath: databasePath, confirm: has("--confirm"), serviceStopped: has("--service-stopped") });
    return void console.log(JSON.stringify(result, null, 2));
  }
  throw new Error("usage: database-operations <status|init|owner-init|import|verify|activate|backup|restore>");
}

void main().catch((error) => {
  console.error(JSON.stringify({ status: "database_operation_failed", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
