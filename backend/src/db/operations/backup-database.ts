import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import Database from "better-sqlite3";

import { createPrismaClient } from "../prisma-client.js";
import { checkPrismaReadiness } from "../prisma-readiness.js";
import { expectedMigrations } from "../migration-manifest.js";

export interface DatabaseBackupResult {
  path: string;
  checksum: string;
  schemaVersion: string;
  sizeBytes: number;
  validated: boolean;
}

export async function validateOperationalDatabase(path: string): Promise<void> {
  const client = await createPrismaClient(path);
  try {
    const readiness = await checkPrismaReadiness(client);
    if (!readiness.ready) throw new Error(`database_validation_failed:${readiness.error}`);
  } finally {
    await client.$disconnect();
  }
}

export async function backupDatabase(options: {
  sourcePath: string;
  destinationDirectory: string;
  timestamp?: Date;
  validate?: boolean;
}): Promise<DatabaseBackupResult> {
  const sourcePath = resolve(options.sourcePath);
  if (!existsSync(sourcePath)) throw new Error("backup_source_missing");
  const destinationDirectory = resolve(options.destinationDirectory);
  mkdirSync(destinationDirectory, { recursive: true });
  const schemaVersion = expectedMigrations().at(-1)?.name;
  if (!schemaVersion) throw new Error("database_migration_manifest_empty");
  const stamp = (options.timestamp ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const temporaryPath = join(destinationDirectory, `.backup-${process.pid}-${Date.now()}.tmp.db`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(temporaryPath);
  } finally {
    source.close();
  }
  try {
    const shouldValidate = options.validate !== false;
    if (shouldValidate) await validateOperationalDatabase(temporaryPath);
    const bytes = readFileSync(temporaryPath);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const finalPath = join(destinationDirectory, `${stamp}_${schemaVersion}_${checksum.slice(0, 16)}_${basename(sourcePath)}`);
    if (existsSync(finalPath)) throw new Error("backup_destination_exists");
    renameSync(temporaryPath, finalPath);
    return { path: finalPath, checksum, schemaVersion, sizeBytes: bytes.byteLength, validated: shouldValidate };
  } catch (error) {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    throw error;
  }
}
