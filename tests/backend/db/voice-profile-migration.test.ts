import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

/**
 * S2-2B 任务 3：VoiceProfile 迁移 SQL 行为（详细设计 §6.4）。
 * 外部审查 P1-4：数据库权威 + 可见性/归属在 SQL 层有硬约束。
 */
describe("S2-2B VoiceProfile migration", () => {
  function createMigrated(): Database.Database {
    const db = new Database(":memory:");
    applyAllDatabaseMigrations(db);
    return db;
  }

  const BASE_COLUMNS =
    "id, kind, ownerId, visibility, providerName, providerStatus, targetModel, usageCount, metadataJson, createdAt, updatedAt";

  function insertProfile(db: Database.Database, values: Record<string, unknown>) {
    const columns = BASE_COLUMNS.split(", ").filter((c) => values[c] !== undefined);
    const sql = `INSERT INTO VoiceProfile (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`;
    db.prepare(sql).run(values);
  }

  it("applies S2-2B migration creating the VoiceProfile table", () => {
    const db = createMigrated();
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).toContain("VoiceProfile");
    } finally {
      db.close();
    }
  });

  it("enforces kind CHECK (preset|generated|system)", () => {
    const db = createMigrated();
    try {
      insertProfile(db, {
        id: "v1",
        kind: "preset",
        providerName: "dashscope",
        providerStatus: "ready",
        targetModel: "m",
        usageCount: 0,
        metadataJson: "{}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      expect(() =>
        insertProfile(db, {
          id: "v2",
          kind: "custom",
          providerName: "dashscope",
          providerStatus: "ready",
          targetModel: "m",
          usageCount: 0,
          metadataJson: "{}",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("enforces visibility CHECK (public|private) with default public", () => {
    const db = createMigrated();
    try {
      insertProfile(db, {
        id: "v1",
        kind: "system",
        providerName: "dashscope",
        providerStatus: "ready",
        targetModel: "m",
        usageCount: 0,
        metadataJson: "{}",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const row = db.prepare("SELECT visibility FROM VoiceProfile WHERE id = 'v1'").get() as {
        visibility: string;
      };
      expect(row.visibility).toBe("public");
      expect(() =>
        insertProfile(db, {
          id: "v2",
          kind: "generated",
          visibility: "secret",
          providerName: "dashscope",
          providerStatus: "ready",
          targetModel: "m",
          usageCount: 0,
          metadataJson: "{}",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it("enforces providerStatus CHECK and indexes (ownerId, visibility)", () => {
    const db = createMigrated();
    try {
      expect(() =>
        insertProfile(db, {
          id: "v2",
          kind: "generated",
          visibility: "private",
          providerName: "dashscope",
          providerStatus: "unknown",
          targetModel: "m",
          usageCount: 0,
          metadataJson: "{}",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ).toThrow();
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'VoiceProfile'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(indexes.some((name) => name.includes("ownerId") && name.includes("visibility"))).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });
});
