import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { syncEventLibraryFromFiles } from "../../../backend/src/modules/event-library/event-library-sync.service.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

function makeEventJson(overrides: Record<string, unknown> = {}) {
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
    angles: [
      {
        angleLabel: "从魏征的立场看这场政变",
        familyLabel: "朝堂博弈型",
        scopeLabel: "standard",
      },
    ],
    ...overrides,
  });
}

describe("event-library sync", () => {
  it("creates entries from files, updates on hash change, archives removed files, and is idempotent", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-sync-"));

    // Create event-library directory structure
    const libDir = join(root, "storage", "event-library");
    mkdirSync(join(libDir, "tang"), { recursive: true });
    mkdirSync(join(libDir, "song"), { recursive: true });

    // File 1: 玄武门之变
    const file1 = join(libDir, "tang", "xuanwumen.json");
    writeFileSync(file1, makeEventJson(), "utf8");

    // File 2: 贞观之治
    const file2 = join(libDir, "tang", "zhenguan.json");
    writeFileSync(
      file2,
      makeEventJson({
        canonicalTitle: "贞观之治",
        summary: "唐太宗李世民开创贞观盛世。",
        eventRegistryCanonicalName: "贞观之治",
        aliases: ["贞观之治"],
        dynasty: "唐",
        era: "初唐",
        characterTags: ["李世民", "魏征", "房玄龄"],
        eventTypeTags: ["治国理政"],
        conflictTypeTags: [],
        themeMotifs: ["君臣相得"],
        timeRange: { start: "627", end: "649", display: "唐贞观年间" },
        angles: [],
      }),
      "utf8",
    );

    // File 3: 王安石变法
    const file3 = join(libDir, "song", "wanganshi.json");
    writeFileSync(
      file3,
      makeEventJson({
        canonicalTitle: "王安石变法",
        summary: "宋神宗时期王安石推行新法，引发新旧党争。",
        eventRegistryCanonicalName: "王安石变法",
        aliases: ["王安石变法", "熙宁变法"],
        dynasty: "宋",
        era: "北宋",
        characterTags: ["王安石", "宋神宗", "司马光"],
        eventTypeTags: ["改革变法"],
        conflictTypeTags: ["党争"],
        themeMotifs: ["改革代价"],
        timeRange: { start: "1069", end: "1085", display: "宋熙宁年间" },
        angles: [],
        origin: "admin",
      }),
      "utf8",
    );

    // Setup DB
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      // --- First sync: creates 3 entries ---
      const r1 = await syncEventLibraryFromFiles(client, root);
      expect(r1.created).toBe(3);
      expect(r1.updated).toBe(0);
      expect(r1.skipped).toBe(0);
      expect(r1.archived).toBe(0);
      expect(r1.errors).toHaveLength(0);

      // Verify entries in DB
      const entries1 = await client.eventLibraryEntry.findMany({
        orderBy: { canonicalTitle: "asc" },
      });
      expect(entries1).toHaveLength(3);
      const titles = entries1.map((e) => e.canonicalTitle);
      expect(titles).toEqual(expect.arrayContaining([
        "王安石变法",
        "玄武门之变",
        "贞观之治",
      ]));
      expect(entries1.every((e) => e.status === "curated")).toBe(true);
      const xuanwumen = entries1.find((e) => e.canonicalTitle === "玄武门之变");
      const wanganshi = entries1.find((e) => e.canonicalTitle === "王安石变法");
      expect(xuanwumen?.originKind).toBe("builtin");
      expect(wanganshi?.originKind).toBe("admin");

      // Verify angles
      const angles1 = await client.eventLibraryAngle.findMany();
      expect(angles1).toHaveLength(1); // Only 玄武门之变 has an angle

      // Verify EventRegistryEntry
      const events = await client.eventRegistryEntry.findMany({
        orderBy: { canonicalName: "asc" },
      });
      expect(events).toHaveLength(3);
      const wanganshiEvent = events.find((e) => e.canonicalName === "王安石变法");
      expect(wanganshiEvent?.aliasesJson).toEqual(["王安石变法", "熙宁变法"]);

      // --- Second sync (no changes): all skipped ---
      const r2 = await syncEventLibraryFromFiles(client, root);
      expect(r2.created).toBe(0);
      expect(r2.updated).toBe(0);
      expect(r2.skipped).toBe(3);
      expect(r2.archived).toBe(0);
      expect(r2.errors).toHaveLength(0);

      // --- Modify file 1: should trigger update ---
      writeFileSync(
        file1,
        makeEventJson({
          summary: "更新后的摘要：李世民在玄武门发动政变，杀死太子建成和齐王元吉。",
        }),
        "utf8",
      );

      const r3 = await syncEventLibraryFromFiles(client, root);
      expect(r3.created).toBe(0);
      expect(r3.updated).toBe(1);
      expect(r3.skipped).toBe(2);
      expect(r3.errors).toHaveLength(0);

      // Verify summary updated
      const entryAfterUpdate = await client.eventLibraryEntry.findFirst({
        where: { canonicalTitle: "玄武门之变" },
      });
      expect(entryAfterUpdate?.summary).toBe(
        "更新后的摘要：李世民在玄武门发动政变，杀死太子建成和齐王元吉。",
      );

      // --- Delete file 3: should archive ---
      rmSync(file3);

      const r4 = await syncEventLibraryFromFiles(client, root);
      expect(r4.created).toBe(0);
      expect(r4.updated).toBe(0);
      expect(r4.skipped).toBe(2);
      expect(r4.archived).toBe(1);
      expect(r4.errors).toHaveLength(0);

      // Verify archived
      const archivedEntry = await client.eventLibraryEntry.findFirst({
        where: { canonicalTitle: "王安石变法" },
      });
      expect(archivedEntry?.status).toBe("archived");

      // Verify not-yet-archived entries are still curated
      const curatedEntries = await client.eventLibraryEntry.findMany({
        where: { status: "curated" },
      });
      expect(curatedEntries).toHaveLength(2);

      // --- Re-run sync with no changes again: all skipped ---
      const r5 = await syncEventLibraryFromFiles(client, root);
      expect(r5.created).toBe(0);
      expect(r5.updated).toBe(0);
      expect(r5.skipped).toBe(2);
      expect(r5.archived).toBe(0); // already archived, no new changes
      expect(r5.errors).toHaveLength(0);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles invalid JSON gracefully", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-invalid-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    writeFileSync(
      join(libDir, "bad.json"),
      JSON.stringify({ schemaVersion: 1, canonicalTitle: "无摘要" }),
      "utf8",
    );

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const r = await syncEventLibraryFromFiles(client, root);
      expect(r.created).toBe(0);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0]).toContain("schema 校验失败");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
