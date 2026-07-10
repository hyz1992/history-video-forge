import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export type AppPrismaClient = PrismaClient;
export type AppPrismaTransactionClient = Prisma.TransactionClient;

export interface SqliteRuntimePragmas {
  foreignKeys: 1;
  journalMode: "wal";
  busyTimeoutMs: 5000;
}
