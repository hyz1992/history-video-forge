import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { initializeFirstAggregateRuntime } from "../../../backend/src/runtime/startup/first-aggregate-startup.js";
import { normalizeEventInput } from "../../../backend/src/modules/topic/event-normalizer.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

function eventLibraryFile() {
  return JSON.stringify({
    schemaVersion: 1,
    canonicalTitle: "玄武门之变",
    summary: "李世民在玄武门伏杀建成元吉，奠定贞观之始。",
    eventRegistryCanonicalName: "玄武门之变",
    aliases: ["玄武门之变"],
    dynasty: "唐",
    era: "初唐",
    characterTags: ["李世民", "李建成"],
    eventTypeTags: ["继承夺位"],
    conflictTypeTags: ["武装政变"],
    themeMotifs: ["权力代价"],
    timeRange: { start: "626", end: "626", display: "唐武德九年六月" },
    locationTags: ["长安"],
    relationshipTags: ["兄弟"],
    sourceAnchorRefs: ["旧唐书"],
    credibilityLevel: "high",
    disputeNotes: null,
    origin: "builtin",
    angles: [],
  });
}

describe("first aggregate startup", () => {
  it("hydrates event-library identities after file sync so recommendations reuse them", async () => {
    const root = mkdtempSync(join(tmpdir(), "hvf-first-startup-"));
    const libraryDir = join(root, "storage", "event-library", "tang");
    mkdirSync(libraryDir, { recursive: true });
    writeFileSync(join(libraryDir, "xuanwumen.json"), eventLibraryFile(), "utf8");

    const databasePath = join(root, "test.db");
    const sqlite = new Database(databasePath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();
    const client = await createPrismaClient(databasePath);

    try {
      const owner = await client.user.create({
        data: {
          id: "owner",
          username: "owner",
          displayName: "Owner",
          passwordHash: "x",
          role: "ADMIN",
        },
      });
      const writer = await PrismaFirstAggregateWriter.create(client, owner.id);
      const app = buildApp({
        storageBaseDir: root,
        skipSnapshotLoad: true,
        firstAggregateWriter: writer,
      });

      await initializeFirstAggregateRuntime({
        db: app.db,
        topicCandidateStore: app.topicCandidateStore,
        prismaClient: client,
        storageRoot: root,
      });

      const persisted = await client.eventRegistryEntry.findUnique({
        where: { canonicalName: "玄武门之变" },
      });
      const normalized = await normalizeEventInput(app.db, {
        rawInput: "玄武门之变",
        sourceType: "system_recommendation",
      });

      expect(persisted).not.toBeNull();
      expect(normalized).toMatchObject({
        created: false,
        event: {
          id: persisted!.id,
          canonicalName: "玄武门之变",
          sourceType: "builtin",
          isProvisional: false,
        },
      });
      await expect(client.eventRegistryEntry.count({
        where: { canonicalName: "玄武门之变" },
      })).resolves.toBe(1);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hydrates existing database events when file sync fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "hvf-first-startup-error-"));
    const databasePath = join(root, "test.db");
    const sqlite = new Database(databasePath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();
    const client = await createPrismaClient(databasePath);

    try {
      await client.eventRegistryEntry.create({
        data: {
          id: "existing-event",
          canonicalName: "王安石变法",
          aliasesJson: [],
          canonicalQuotesJson: [],
          canonicalQuoteIntentsJson: [],
          sourceType: "builtin",
          isProvisional: false,
        },
      });
      const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });
      const onSyncError = vi.fn();

      await initializeFirstAggregateRuntime({
        db: app.db,
        topicCandidateStore: app.topicCandidateStore,
        prismaClient: client,
        storageRoot: root,
        syncEventLibrary: async () => {
          throw new Error("sync unavailable");
        },
        onSyncError,
      });

      expect(onSyncError).toHaveBeenCalledWith("sync unavailable");
      expect(app.db.events.get("existing-event")).toMatchObject({
        canonicalName: "王安石变法",
        sourceType: "builtin",
      });
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
