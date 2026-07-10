import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";

import type { AppPrismaClient, SqliteRuntimePragmas } from "./prisma-client.types.js";

const REQUIRED_BUSY_TIMEOUT_MS = 5000;

type ForeignKeysRow = { foreign_keys: bigint | number };
type JournalModeRow = { journal_mode: string };
type BusyTimeoutRow = { timeout: bigint | number };

async function initializeSqliteRuntime(client: AppPrismaClient): Promise<SqliteRuntimePragmas> {
  await client.$queryRawUnsafe("PRAGMA foreign_keys = ON");
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$queryRawUnsafe(`PRAGMA busy_timeout = ${REQUIRED_BUSY_TIMEOUT_MS}`);

  const foreignKeys = await client.$queryRawUnsafe<ForeignKeysRow[]>("PRAGMA foreign_keys");
  const journalMode = await client.$queryRawUnsafe<JournalModeRow[]>("PRAGMA journal_mode");
  const busyTimeout = await client.$queryRawUnsafe<BusyTimeoutRow[]>("PRAGMA busy_timeout");
  const actualForeignKeys = Number(foreignKeys[0]?.foreign_keys);
  const actualJournalMode = journalMode[0]?.journal_mode.toLowerCase();
  const actualBusyTimeout = Number(busyTimeout[0]?.timeout);

  if (actualForeignKeys !== 1) throw new Error("sqlite_foreign_keys_not_enabled");
  if (actualJournalMode !== "wal") throw new Error(`sqlite_journal_mode_invalid:${actualJournalMode ?? "missing"}`);
  if (actualBusyTimeout !== REQUIRED_BUSY_TIMEOUT_MS) {
    throw new Error(`sqlite_busy_timeout_invalid:${actualBusyTimeout}`);
  }

  return {
    foreignKeys: 1,
    journalMode: "wal",
    busyTimeoutMs: REQUIRED_BUSY_TIMEOUT_MS,
  };
}

export async function createPrismaClient(databaseUrl: string): Promise<AppPrismaClient> {
  if (!databaseUrl.trim()) throw new Error("database_url_required");

  const adapter = new PrismaBetterSqlite3({
    url: databaseUrl,
    timeout: REQUIRED_BUSY_TIMEOUT_MS,
  });
  const client = new PrismaClient({ adapter });

  try {
    await initializeSqliteRuntime(client);
    return client;
  } catch (error) {
    await client.$disconnect();
    throw error;
  }
}
