import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { syncEventLibraryFromFiles } from "../../../backend/src/modules/event-library/event-library-sync.service.js";
import { generateLibraryFingerprint, computeFileContentHash } from "../../../backend/src/modules/event-library/event-library.codec.js";
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

  it("restores archived entry to curated when same-content file reappears", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-restore-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    const file1 = join(libDir, "test.json");
    writeFileSync(file1, makeEventJson({ canonicalTitle: "恢复测试" }), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      // First sync: creates entry
      const r1 = await syncEventLibraryFromFiles(client, root);
      expect(r1.created).toBe(1);

      const e1 = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "恢复测试" } });
      expect(e1?.status).toBe("curated");
      expect(e1?.filePath).toBe("storage/event-library/test.json");

      // Delete file -> archive
      rmSync(file1);
      const r2 = await syncEventLibraryFromFiles(client, root);
      expect(r2.archived).toBe(1);

      const e2 = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "恢复测试" } });
      expect(e2?.status).toBe("archived");

      // Restore same file
      writeFileSync(file1, makeEventJson({ canonicalTitle: "恢复测试" }), "utf8");
      const r3 = await syncEventLibraryFromFiles(client, root);
      expect(r3.updated).toBe(1); // restored, not skipped

      const e3 = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "恢复测试" } });
      expect(e3?.status).toBe("curated");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores relative filePath, not absolute path", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-relpath-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(join(libDir, "qin"), { recursive: true });

    const file1 = join(libDir, "qin", "dazexiang.json");
    writeFileSync(
      file1,
      makeEventJson({
        canonicalTitle: "大泽乡起义",
        summary: "陈胜吴广在大泽乡揭竿而起。",
        eventRegistryCanonicalName: "大泽乡起义",
        dynasty: "秦",
        angles: [],
      }),
      "utf8",
    );

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const r = await syncEventLibraryFromFiles(client, root);
      expect(r.created).toBe(1);

      const entry = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "大泽乡起义" } });
      expect(entry?.filePath).toBe("storage/event-library/qin/dazexiang.json");
      // 不应包含任何绝对路径特征
      expect(entry?.filePath).not.toContain(":");
      expect(entry?.filePath).not.toContain(root);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("updates originKind and eventRegistryEntryId when file metadata changes", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-identity-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    const file1 = join(libDir, "test.json");
    writeFileSync(
      file1,
      makeEventJson({
        canonicalTitle: "身份测试",
        eventRegistryCanonicalName: "旧事件名",
        origin: "builtin",
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

      const e1 = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "身份测试" } });
      expect(e1?.originKind).toBe("builtin");
      const oldEventId = e1?.eventRegistryEntryId;

      // Modify: change origin AND canonnicalName
      writeFileSync(
        file1,
        makeEventJson({
          canonicalTitle: "身份测试",
          summary: "摘要已改，触发 hash 变化。",
          eventRegistryCanonicalName: "新事件名",
          origin: "admin",
        }),
        "utf8",
      );

      await syncEventLibraryFromFiles(client, root);

      const e2 = await client.eventLibraryEntry.findFirst({ where: { canonicalTitle: "身份测试" } });
      expect(e2?.originKind).toBe("admin");
      expect(e2?.eventRegistryEntryId).not.toBe(oldEventId);

      // 新 EventRegistryEntry 已创建
      const newEvent = await client.eventRegistryEntry.findFirst({ where: { canonicalName: "新事件名" } });
      expect(newEvent).not.toBeNull();
      expect(e2?.eventRegistryEntryId).toBe(newEvent?.id);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates old entries with absolute filePath to relative path via fingerprint fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-migrate-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    const file1 = join(libDir, "migrate-test.json");
    writeFileSync(
      file1,
      makeEventJson({
        canonicalTitle: "迁移测试事件",
        summary: "此条目之前被写入时 filePath 是绝对路径。",
        eventRegistryCanonicalName: "迁移测试事件",
        angles: [],
      }),
      "utf8",
    );

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      // 模拟旧版 P2：直接用 Prisma 写入一条绝对路径 entry
      const oldAbsolutePath = join(libDir, "migrate-test.json").replace(/\\/g, "/");

      // 计算 fingerprint（与新版 codec 一致）
      const oldFingerprint = generateLibraryFingerprint("迁移测试事件", "唐", "初唐");

      // 先确保 EventRegistryEntry 存在（旧版也会写）
      await client.eventRegistryEntry.create({
        data: {
          id: "ev-migrate",
          canonicalName: "迁移测试事件",
          aliasesJson: [] as never,
          canonicalQuotesJson: [] as never,
          canonicalQuoteIntentsJson: [] as never,
          sourceType: "builtin",
          isProvisional: false,
        },
      });

      // 写入旧版绝对路径 entry
      await client.eventLibraryEntry.create({
        data: {
          id: "old-entry-id",
          eventRegistryEntryId: "ev-migrate",
          canonicalTitle: "迁移测试事件",
          summary: "旧摘要。",
          dynasty: "唐",
          era: "初唐",
          characterTagsJson: [] as never,
          eventTypeTagsJson: [] as never,
          conflictTypeTagsJson: [] as never,
          themeMotifsJson: [] as never,
          locationTagsJson: [] as never,
          relationshipTagsJson: [] as never,
          sourceAnchorRefsJson: [] as never,
          credibilityLevel: "medium",
          visibility: "public",
          status: "curated",
          originKind: "builtin",
          libraryFingerprint: oldFingerprint,
          filePath: oldAbsolutePath,
          fileContentHash: "old-hash",
        },
      });

      // 运行新版同步
      const r = await syncEventLibraryFromFiles(client, root);
      expect(r.created).toBe(0);
      expect(r.updated).toBe(1);
      expect(r.errors).toHaveLength(0);

      // 验证：filePath 已升级为相对路径，内容已按文件更新
      const entry = await client.eventLibraryEntry.findUnique({ where: { id: "old-entry-id" } });
      expect(entry?.filePath).toBe("storage/event-library/migrate-test.json");
      expect(entry?.summary).toBe("此条目之前被写入时 filePath 是绝对路径。");
      expect(entry?.status).toBe("curated");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("migrates old absolute filePath with same hash instead of archiving it", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-samehash-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    const file1 = join(libDir, "samehash-test.json");
    const fileContent = makeEventJson({
      canonicalTitle: "同 hash 测试",
      summary: "内容不变，但旧 entry 的 filePath 是绝对路径。",
      eventRegistryCanonicalName: "同 hash 测试",
      angles: [],
    });
    writeFileSync(file1, fileContent, "utf8");

    // 计算真实 hash（与同步用的相同）
    const realHash = computeFileContentHash(fileContent);

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const oldAbsolutePath = join(libDir, "samehash-test.json").replace(/\\/g, "/");
      const fingerprint = generateLibraryFingerprint("同 hash 测试", "唐", "初唐");

      await client.eventRegistryEntry.create({
        data: {
          id: "ev-samehash",
          canonicalName: "同 hash 测试",
          aliasesJson: [] as never,
          canonicalQuotesJson: [] as never,
          canonicalQuoteIntentsJson: [] as never,
          sourceType: "builtin",
          isProvisional: false,
        },
      });

      // 写入旧版：绝对路径 + 真实 hash（内容未变）
      await client.eventLibraryEntry.create({
        data: {
          id: "samehash-old-id",
          eventRegistryEntryId: "ev-samehash",
          canonicalTitle: "同 hash 测试",
          summary: "内容不变，但旧 entry 的 filePath 是绝对路径。",
          dynasty: "唐",
          era: "初唐",
          characterTagsJson: [] as never,
          eventTypeTagsJson: [] as never,
          conflictTypeTagsJson: [] as never,
          themeMotifsJson: [] as never,
          locationTagsJson: [] as never,
          relationshipTagsJson: [] as never,
          sourceAnchorRefsJson: [] as never,
          credibilityLevel: "medium",
          visibility: "public",
          status: "curated",
          originKind: "builtin",
          libraryFingerprint: fingerprint,
          filePath: oldAbsolutePath,
          fileContentHash: realHash,  // 与当前文件内容相同
        },
      });

      // 运行同步
      const r = await syncEventLibraryFromFiles(client, root);
      expect(r.skipped).toBe(0);  // 不应 skip
      expect(r.updated).toBe(1);  // 应更新路径
      expect(r.archived).toBe(0); // 不应归档
      expect(r.created).toBe(0);  // 不应新建

      const entry = await client.eventLibraryEntry.findUnique({ where: { id: "samehash-old-id" } });
      expect(entry?.filePath).toBe("storage/event-library/samehash-test.json");
      expect(entry?.status).toBe("curated");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
