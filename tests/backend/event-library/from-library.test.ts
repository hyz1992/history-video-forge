// 必须在所有 import 之前设置 LLM stub 模式
process.env.LLM_PROVIDER = "stub";
process.env.LLM_STUB_DELAY_MS = "10";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
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
    angles: [{ angleLabel: "从魏征的立场看", familyLabel: "朝堂博弈型", scopeLabel: "standard" }],
    ...overrides,
  });
}

describe("event-library from-library API", () => {
  it("generates candidates from event library entry and stores with sourceMode=library", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-fromlib-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    writeFileSync(join(libDir, "xuanwumen.json"), makeEventJson(), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      // Sync to populate DB
      await syncEventLibraryFromFiles(client, root);

      // Create user and project
      const user = await client.user.create({
        data: { id: "u1", username: "u1", displayName: "U1", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      const project = await createProject(app.db, { name: "Test", ownerId: user.id, createdById: user.id });
      const auth = createAuthenticatedAuthContext({ userId: user.id, username: user.username, displayName: user.displayName, role: "ADMIN", sessionId: "s" });

      // Find the entry
      const entriesResp = await app.inject({ method: "GET", url: "/api/event-library/entries" });
      const entry = entriesResp.json().entries[0];

      // Generate from library (正式 camelCase)
      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/from-library`,
        payload: { eventLibraryEntryId: entry.id },
        auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.source_mode).toBe("library");
      expect(body.source_ref.eventLibraryEntryId).toBe(entry.id);
      expect(body.candidates.length).toBeGreaterThan(0);

      // 无 angle 时，候选标题不包含 angle 标签
      for (const c of body.candidates as Array<{ title: string }>) {
        expect(c.title).not.toContain("从魏征的立场看");
        expect(c.title).toContain("玄武门之变");
      }

      // Verify candidates in topicCandidateStore
      const store = app.topicCandidateStore.get(project.id);
      expect(store).toBeDefined();
      expect(store!.rounds).toHaveLength(1);
      const storedCandidate = store!.rounds[0].candidates[0];
      expect(storedCandidate.sourceMode).toBe("library");
      expect(storedCandidate.sourceRef).toEqual({ eventLibraryEntryId: entry.id });
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("generates candidates with specific angle", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-angle-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    writeFileSync(join(libDir, "xuanwumen.json"), makeEventJson(), "utf8");

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      await syncEventLibraryFromFiles(client, root);

      const user = await client.user.create({
        data: { id: "u2", username: "u2", displayName: "U2", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      const project = await createProject(app.db, { name: "Test2", ownerId: user.id, createdById: user.id });
      const auth = createAuthenticatedAuthContext({ userId: user.id, username: user.username, displayName: user.displayName, role: "ADMIN", sessionId: "s" });

      const entriesResp = await app.inject({ method: "GET", url: "/api/event-library/entries" });
      const entry = entriesResp.json().entries[0];

      // Get detail to know the angle id
      const detailResp = await app.inject({ method: "GET", url: `/api/event-library/entries/${entry.id}` });
      const angleId = detailResp.json().angles[0].id;

      // Generate with angle (camelCase)
      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/from-library`,
        payload: { eventLibraryEntryId: entry.id, angleId: angleId },
        auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.source_ref.angleId).toBe(angleId);
      expect(body.candidates.length).toBeGreaterThan(0);

      // angle 标签应反映在候选标题中（可观察差异）
      for (const c of body.candidates as Array<{ title: string }>) {
        expect(c.title).toContain("从魏征的立场看");
      }

      const store = app.topicCandidateStore.get(project.id);
      const storedCandidate = store!.rounds[0].candidates[0];
      expect(storedCandidate.sourceRef).toEqual({ eventLibraryEntryId: entry.id, angleId });
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 404 for non-existent entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-el-404-"));

    const libDir = join(root, "storage", "event-library");
    mkdirSync(libDir, { recursive: true });

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u3", username: "u3", displayName: "U3", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      const project = await createProject(app.db, { name: "Test3", ownerId: user.id, createdById: user.id });
      const auth = createAuthenticatedAuthContext({ userId: user.id, username: user.username, displayName: user.displayName, role: "ADMIN", sessionId: "s" });

      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/from-library`,
        payload: { eventLibraryEntryId: "nonexistent-id" },
        auth,
      });
      expect(r.statusCode).toBe(404);
      expect(r.json().error).toBe("event_library_entry_not_found");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
