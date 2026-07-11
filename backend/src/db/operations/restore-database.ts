import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { backupDatabase, validateOperationalDatabase, type DatabaseBackupResult } from "./backup-database.js";

export interface DatabaseRestoreResult {
  restored: true;
  targetPath: string;
  safetyBackup: DatabaseBackupResult | null;
}

export async function restoreDatabase(options: {
  backupPath: string;
  targetPath: string;
  safetyBackupDirectory?: string;
  confirm: boolean;
  serviceStopped: boolean;
}): Promise<DatabaseRestoreResult> {
  if (!options.confirm) throw new Error("restore_confirmation_required");
  if (!options.serviceStopped) throw new Error("restore_requires_stopped_service");
  const backupPath = resolve(options.backupPath);
  const targetPath = resolve(options.targetPath);
  if (!existsSync(backupPath)) throw new Error("restore_backup_missing");
  if (backupPath === targetPath) throw new Error("restore_source_equals_target");
  const checksumPrefix = /_([a-f0-9]{16})_.+\.db$/i.exec(backupPath)?.[1]?.toLowerCase();
  if (!checksumPrefix) throw new Error("restore_backup_checksum_missing");
  const actualChecksum = createHash("sha256").update(readFileSync(backupPath)).digest("hex");
  if (!actualChecksum.startsWith(checksumPrefix)) throw new Error("restore_backup_checksum_mismatch");
  const temporaryPath = join(dirname(targetPath), `.restore-${process.pid}-${Date.now()}.tmp.db`);
  const displacedPath = join(dirname(targetPath), `.restore-${process.pid}-${Date.now()}.previous.db`);
  copyFileSync(backupPath, temporaryPath);
  try {
    await validateOperationalDatabase(temporaryPath);
    const safetyBackup = existsSync(targetPath)
      ? await backupDatabase({
          sourcePath: targetPath,
          destinationDirectory: options.safetyBackupDirectory ?? join(dirname(targetPath), "backups"),
          validate: false,
        })
      : null;
    let displaced = false;
    try {
      if (existsSync(targetPath)) {
        renameSync(targetPath, displacedPath);
        displaced = true;
      }
      renameSync(temporaryPath, targetPath);
      if (displaced) {
        try { rmSync(displacedPath, { force: true }); } catch { /* safety backup already exists; stale displaced file is recoverable */ }
      }
      return { restored: true, targetPath, safetyBackup };
    } catch (error) {
      if (!existsSync(targetPath) && displaced && existsSync(displacedPath)) renameSync(displacedPath, targetPath);
      throw error;
    }
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    if (existsSync(displacedPath) && existsSync(targetPath)) {
      try { rmSync(displacedPath, { force: true }); } catch { /* leave recoverable previous file for manual cleanup */ }
    }
  }
}
