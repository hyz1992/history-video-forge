import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { syncEventLibraryFromFiles } from "../../../backend/src/modules/event-library/event-library-sync.service.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

function makeEventJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    canonicalTitle: "测试事件",
    summary: "测试摘要。",
    eventRegistryCanonicalName: "测试事件",
    aliases: [],
    dynasty: "唐",
    era: "初唐",
    characterTags: ["人物A"],
    eventTypeTags: ["类型A"],
    conflictTypeTags: ["冲突A"],
    themeMotifs: ["母题A"],
    timeRange: { start: "600", end: "700", display: "七世纪" },
    locationTags: ["长安"],
    relationshipTags: ["君臣"],
    sourceAnchorRefs: ["史料A"],
    credibilityLevel: "high",
    disputeNotes: null,
    origin: "builtin",
    angles: [],
    ...overrides,
  });
}

describe("event-library browse API", () => {
  it("lists curated public entries with pagination and dynasty filter", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-browse-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(join(libDir, "tang"), { recursive: true });
    mkdirSync(join(libDir, "song"), { recursive: true });

    writeFileSync(join(libDir, "tang", "e1.json"), makeEventJson({ canonicalTitle: "玄武门之变", eventRegistryCanonicalName: "玄武门之变", dynasty: "唐" }), "utf8");
    writeFileSync(join(libDir, "tang", "e2.json"), makeEventJson({ canonicalTitle: "贞观之治", eventRegistryCanonicalName: "贞观之治", dynasty: "唐", characterTags: ["李世民"] }), "utf8");
    writeFileSync(join(libDir, "song", "e3.json"), makeEventJson({ canonicalTitle: "王安石变法", eventRegistryCanonicalName: "王安石变法", dynasty: "宋", era: "北宋" }), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      await syncEventLibraryFromFiles(client, root);

      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });

      // List all
      const r1 = await app.inject({ method: "POST", url: "/api/event-library/entries", payload: {} });
      expect(r1.statusCode).toBe(200);
      const body1 = r1.json();
      expect(body1.total).toBe(3);
      expect(body1.entries).toHaveLength(3);
      expect(body1.entries.every((e: { credibility_level: string }) => e.credibility_level === "high")).toBe(true);

      // Filter by dynasty
      const r2 = await app.inject({ method: "POST", url: "/api/event-library/entries", payload: { dynasty: "唐" } });
      const body2 = r2.json();
      expect(body2.total).toBe(2);
      expect(body2.entries.map((e: { canonical_title: string }) => e.canonical_title)).toEqual(
        expect.arrayContaining(["玄武门之变", "贞观之治"]),
      );

      // Pagination
      const r3 = await app.inject({ method: "POST", url: "/api/event-library/entries", payload: { page: 1, pageSize: 1 } });
      const body3 = r3.json();
      expect(body3.total).toBe(3);
      expect(body3.entries).toHaveLength(1);
      expect(body3.page).toBe(1);
      expect(body3.page_size).toBe(1);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns entry detail with angles", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-detail-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    writeFileSync(
      join(libDir, "e1.json"),
      makeEventJson({
        canonicalTitle: "玄武门之变",
        eventRegistryCanonicalName: "玄武门之变",
        angles: [{ angleLabel: "从魏征的立场看", familyLabel: "朝堂博弈型", scopeLabel: "standard" }],
      }),
      "utf8",
    );

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      await syncEventLibraryFromFiles(client, root);

      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });

      // Find the entry id
      const entries = await app.inject({ method: "POST", url: "/api/event-library/entries", payload: {} });
      const entryId = entries.json().entries[0].id;

      // Get detail
      const r = await app.inject({ method: "GET", url: `/api/event-library/entries/${entryId}` });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.canonical_title).toBe("玄武门之变");
      expect(body.angles).toHaveLength(1);
      expect(body.angles[0].angle_label).toBe("从魏征的立场看");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns distinct dynasties from curated entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-dyn-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(join(libDir, "tang"), { recursive: true });
    mkdirSync(join(libDir, "song"), { recursive: true });

    writeFileSync(join(libDir, "tang", "e1.json"), makeEventJson({ canonicalTitle: "事件A", eventRegistryCanonicalName: "事件A", dynasty: "唐" }), "utf8");
    writeFileSync(join(libDir, "tang", "e2.json"), makeEventJson({ canonicalTitle: "事件B", eventRegistryCanonicalName: "事件B", dynasty: "唐" }), "utf8");
    writeFileSync(join(libDir, "song", "e3.json"), makeEventJson({ canonicalTitle: "事件C", eventRegistryCanonicalName: "事件C", dynasty: "宋" }), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      await syncEventLibraryFromFiles(client, root);

      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });

      const r = await app.inject({ method: "GET", url: "/api/event-library/dynasties" });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.dynasties).toEqual(expect.arrayContaining(["唐", "宋"]));
      expect(body.dynasties).toHaveLength(2);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes non-curated entries from browse", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-exclude-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    writeFileSync(join(libDir, "e1.json"), makeEventJson({ canonicalTitle: "公开事件", eventRegistryCanonicalName: "公开事件" }), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      await syncEventLibraryFromFiles(client, root);

      // Manually archive one entry
      const entry = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "公开事件" } });
      await client.eventLibraryEntry.update({ where: { id: entry!.id }, data: { status: "archived" } });

      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });

      const r = await app.inject({ method: "POST", url: "/api/event-library/entries", payload: {} });
      expect(r.json().total).toBe(0);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
