// 必须在所有 import 之前设置 LLM stub 模式
process.env.LLM_PROVIDER = "stub";
process.env.LLM_STUB_DELAY_MS = "10";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

// Mock refineCustomTopic to return a deterministic result
vi.mock("../../../backend/src/modules/topic/topic-custom-refine.service.js", () => ({
  refineCustomTopic: vi.fn().mockResolvedValue({
    refined: {
      canonicalName: "玄武门之变",
      summary: "李世民在玄武门伏杀建成元吉，奠定贞观之始。",
      dynasty: "唐",
      characterTags: ["李世民", "李建成"],
      eventTypeTags: ["政变", "继承夺位"],
      credibility: "high",
    },
  }),
}));

describe("custom refine API", () => {
  it("returns 200 with candidates for valid custom digest", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-custom-ok-"));

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u-custom", username: "u-custom", displayName: "U Custom", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      const project = await createProject(app.db, { name: "CustomTest", ownerId: user.id, createdById: user.id });

      // Prisma project for FK
      await client.project.create({
        data: {
          id: project.id, ownerId: user.id, createdById: user.id,
          name: "CustomTest", status: "topic_pending",
          storageKey: project.id, storageDisplayName: "CustomTest",
        },
      });

      const auth = createAuthenticatedAuthContext({
        userId: user.id, username: user.username, displayName: user.displayName,
        role: "ADMIN", sessionId: "s",
      });

      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/from-custom`,
        payload: { rawDigest: "玄武门之变，李世民杀兄弟夺位" },
        auth,
      });

      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.source_mode).toBe("custom");
      expect(body.candidates.length).toBeGreaterThan(0);
      expect(body.refined.canonicalName).toBe("玄武门之变");
      // 验证 source_ref.customDraftId 不为 null（draft 先于 candidate 创建）
      expect(body.source_ref.customDraftId).toBeDefined();
      expect(body.source_ref.customDraftId).not.toBeNull();

      // 验证 candidate 已写入 topicCandidateStore
      const store = app.topicCandidateStore.get(project.id);
      expect(store).toBeDefined();
      expect(store!.rounds).toHaveLength(1);
      const storedCandidate = store!.rounds[0].candidates[0];
      expect(storedCandidate.sourceMode).toBe("custom");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 400 for empty/too-short digest", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-custom-short-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u-custom2", username: "u-custom2", displayName: "U2", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      const project = await createProject(app.db, { name: "ShortTest", ownerId: user.id, createdById: user.id });
      await client.project.create({
        data: {
          id: project.id, ownerId: user.id, createdById: user.id,
          name: "ShortTest", status: "topic_pending",
          storageKey: project.id, storageDisplayName: "ShortTest",
        },
      });

      const auth = createAuthenticatedAuthContext({
        userId: user.id, username: user.username, displayName: user.displayName,
        role: "ADMIN", sessionId: "s",
      });

      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/from-custom`,
        payload: { rawDigest: "短" },
        auth,
      });

      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("invalid_custom_digest");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 400 for missing rawDigest", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-custom-missing-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u-custom3", username: "u-custom3", displayName: "U3", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      const project = await createProject(app.db, { name: "MissingTest", ownerId: user.id, createdById: user.id });
      await client.project.create({
        data: {
          id: project.id, ownerId: user.id, createdById: user.id,
          name: "MissingTest", status: "topic_pending",
          storageKey: project.id, storageDisplayName: "MissingTest",
        },
      });

      const auth = createAuthenticatedAuthContext({
        userId: user.id, username: user.username, displayName: user.displayName,
        role: "ADMIN", sessionId: "s",
      });

      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/from-custom`,
        payload: {},
        auth,
      });

      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("invalid_custom_digest");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
