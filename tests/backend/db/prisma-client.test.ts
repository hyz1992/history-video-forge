import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";

const migrationSql = readFileSync(
  join(process.cwd(), "backend/prisma/migrations/0001_v2_baseline/migration.sql"),
  "utf8",
);
const tempDirectories: string[] = [];

function createMigratedDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "story-forge-prisma-"));
  tempDirectories.push(directory);
  const databasePath = join(directory, "test.db");
  const database = new Database(databasePath);
  try {
    database.pragma("foreign_keys = ON");
    database.exec(migrationSql);
  } finally {
    database.close();
  }
  return databasePath;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Prisma client initialization", () => {
  it("regenerates the ignored Prisma client in standard install and verification workflows", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["prisma:generate"]).toContain("prisma generate");
    expect(packageJson.scripts?.postinstall).toBe("npm run prisma:generate");
    expect(packageJson.scripts?.["pretypecheck:backend"]).toBe("npm run prisma:generate");
    expect(packageJson.scripts?.["prebuild:backend"]).toBe("npm run prisma:generate");
    expect(packageJson.scripts?.pretest).toBe("npm run prisma:generate");
  });

  it("enables foreign keys, WAL, and a 5000ms busy timeout before returning", async () => {
    const client = await createPrismaClient(createMigratedDatabase());
    try {
      const foreignKeys = await client.$queryRaw<Array<{ foreign_keys: bigint }>>`PRAGMA foreign_keys`;
      const journalMode = await client.$queryRaw<Array<{ journal_mode: string }>>`PRAGMA journal_mode`;
      const busyTimeout = await client.$queryRaw<Array<{ timeout: bigint }>>`PRAGMA busy_timeout`;

      expect(Number(foreignKeys[0]?.foreign_keys)).toBe(1);
      expect(journalMode[0]?.journal_mode.toLowerCase()).toBe("wal");
      expect(Number(busyTimeout[0]?.timeout)).toBe(5000);
    } finally {
      await client.$disconnect();
    }
  });

  it("rolls back User, Project, and TopicPackage when a transaction throws", async () => {
    const client = await createPrismaClient(createMigratedDatabase());
    try {
      await expect(client.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            username: "rollback-admin",
            displayName: "Rollback admin",
            passwordHash: "not-a-real-password-hash",
            role: "ADMIN",
          },
        });
        const project = await transaction.project.create({
          data: {
            ownerId: user.id,
            createdById: user.id,
            name: "Rollback project",
            storageKey: "rollback-project",
            storageDisplayName: "Rollback project",
          },
        });
        await transaction.topicPackage.create({
          data: {
            projectId: project.id,
            title: "Rollback topic",
            selectedAngle: "A constrained angle",
            familyLabel: "history",
            scopeLabel: "single_event",
            coreConflict: "A concrete conflict",
            strongScene: "A concrete scene",
            packagingSeed: "A packaging seed",
            canonicalQuotesJson: [],
            canonicalQuoteIntentsJson: [],
            durationBandJson: { label: "medium" },
            narrativeTensionMapJson: {},
            mustIncludeBeatsJson: [],
            forbiddenExpansionsJson: [],
            riskHintsJson: [],
            sourceAnchorRefsJson: [],
            ambiguityNotesJson: [],
          },
        });
        throw new Error("intentional_rollback");
      })).rejects.toThrow("intentional_rollback");

      await expect(Promise.all([
        client.user.count(),
        client.project.count(),
        client.topicPackage.count(),
      ])).resolves.toEqual([0, 0, 0]);
    } finally {
      await client.$disconnect();
    }
  });

  it("serializes concurrent project updates without leaking raw SQLITE_BUSY", async () => {
    const databasePath = createMigratedDatabase();
    const firstClient = await createPrismaClient(databasePath);
    const secondClient = await createPrismaClient(databasePath);
    try {
      const user = await firstClient.user.create({
        data: {
          username: "concurrency-admin",
          displayName: "Concurrency admin",
          passwordHash: "not-a-real-password-hash",
          role: "ADMIN",
        },
      });
      const project = await firstClient.project.create({
        data: {
          ownerId: user.id,
          createdById: user.id,
          name: "Concurrent project",
          storageKey: "concurrent-project",
          storageDisplayName: "Concurrent project",
        },
      });

      const results = await Promise.allSettled([
        firstClient.project.update({ where: { id: project.id }, data: { status: "first" } }),
        secondClient.project.update({ where: { id: project.id }, data: { status: "second" } }),
      ]);
      const rejected = results.filter((result) => result.status === "rejected");

      expect(rejected, rejected.map((result) => String((result as PromiseRejectedResult).reason)).join("\n"))
        .toHaveLength(0);
      expect(["first", "second"]).toContain((await firstClient.project.findUniqueOrThrow({
        where: { id: project.id },
      })).status);
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
  });
});
