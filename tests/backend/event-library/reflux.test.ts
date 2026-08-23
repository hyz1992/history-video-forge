// 必须在所有 import 之前设置 LLM stub 模式
process.env.LLM_PROVIDER = "stub";
process.env.LLM_STUB_DELAY_MS = "10";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

const createDraftMock = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/modules/event-library/event-library-draft.repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../backend/src/modules/event-library/event-library-draft.repository.js")>();
  // 默认透传真实实现；用例内用 mockRejectedValueOnce/mockImplementationOnce 覆盖
  createDraftMock.mockImplementation((...args: Parameters<typeof actual.createDraft>) =>
    actual.createDraft(...args),
  );
  return {
    ...actual,
    createDraft: createDraftMock,
  };
});

import { buildApp } from "../../../backend/src/app.js";
import { seedQuotableCatalog } from "../cost/quote-test-context.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

/** 等待 setImmediate 异步 draft 写入完成 */
async function waitForAsyncDrafts(ms = 200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("event-library recommendation reflux", () => {
  it("writes EventLibraryDraft(recommendation_reflux) after /topic/recommendations", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-reflux-"));

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u-reflux", username: "u-reflux", displayName: "U Reflux", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      await seedQuotableCatalog(app);
    await seedQuotableCatalog(app);
      const project = await createProject(app.db, { name: "RefluxTest", ownerId: user.id, createdById: user.id });

      // 在 Prisma DB 中创建 project（EventLibraryDraft 有 FK 到 Project）
      await client.project.create({
        data: {
          id: project.id,
          ownerId: user.id,
          createdById: user.id,
          name: "RefluxTest",
          status: "topic_pending",
          storageKey: project.id,
          storageDisplayName: "RefluxTest",
        },
      });
      const auth = createAuthenticatedAuthContext({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: "ADMIN",
        sessionId: "s",
      });

      // 调用推荐接口
      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/recommendations`,
        payload: {
          canonical_name: "玄武门之变",
          summary: "李世民在玄武门伏杀建成元吉",
          core_conflict: "兄弟夺位",
          strong_scene: "玄武门伏杀",
          source_hint: "测试",
          recent_usage_hint: "无",
          tags: ["唐朝", "政变"],
        },
        auth,
      });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.candidates.length).toBeGreaterThan(0);

      // 等待 setImmediate 异步 draft 写入完成
      await waitForAsyncDrafts();

      // 验证 draft 已写入
      const drafts = await client.eventLibraryDraft.findMany({
        where: { draftKind: "recommendation_reflux", projectId: project.id },
      });
      expect(drafts.length).toBe(body.candidates.length);
      for (const draft of drafts) {
        expect(draft.draftKind).toBe("recommendation_reflux");
        expect(draft.ownerId).toBe(user.id);
        expect(draft.status).toBe("draft");
        expect(draft.candidateFingerprint).toBeTruthy();
        expect(draft.proposedTitle).toBeTruthy();
      }
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips duplicate drafts on second recommendation with same candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-reflux-dup-"));

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u-reflux-dup", username: "u-reflux-dup", displayName: "U Dup", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      await seedQuotableCatalog(app);
    await seedQuotableCatalog(app);
      const project = await createProject(app.db, { name: "RefluxDupTest", ownerId: user.id, createdById: user.id });

      // 在 Prisma DB 中创建 project
      await client.project.create({
        data: {
          id: project.id,
          ownerId: user.id,
          createdById: user.id,
          name: "RefluxDupTest",
          status: "topic_pending",
          storageKey: project.id,
          storageDisplayName: "RefluxDupTest",
        },
      });
      const auth = createAuthenticatedAuthContext({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: "ADMIN",
        sessionId: "s",
      });

      const payload = {
        canonical_name: "玄武门之变",
        summary: "李世民在玄武门伏杀建成元吉",
        core_conflict: "兄弟夺位",
        strong_scene: "玄武门伏杀",
        source_hint: "测试",
        recent_usage_hint: "无",
        tags: ["唐朝", "政变"],
      };

      // 第一次调用
      await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/recommendations`,
        payload,
        auth,
      });
      await waitForAsyncDrafts();
      const firstDrafts = await client.eventLibraryDraft.findMany({
        where: { draftKind: "recommendation_reflux", projectId: project.id },
      });
      const firstCount = firstDrafts.length;
      expect(firstCount).toBeGreaterThan(0);

      // 第二次调用（同输入）
      await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/recommendations`,
        payload,
        auth,
      });
      await waitForAsyncDrafts();
      const secondDrafts = await client.eventLibraryDraft.findMany({
        where: { draftKind: "recommendation_reflux", projectId: project.id },
      });
      // 不应重复写入，数量不变
      expect(secondDrafts.length).toBe(firstCount);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recommendation response is unaffected when draft write fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-reflux-fail-"));

    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: { id: "u-reflux-fail", username: "u-reflux-fail", displayName: "U Fail", passwordHash: "x", role: "ADMIN" },
      });
      const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
      await seedQuotableCatalog(app);

      // draft 写入失败（mock createDraft 抛错），但推荐响应不应受影响
      createDraftMock.mockRejectedValueOnce(new Error("db write failed"));
      const project = await createProject(app.db, { name: "RefluxFail", ownerId: user.id, createdById: user.id });
      await client.project.create({
        data: {
          id: project.id,
          ownerId: user.id,
          createdById: user.id,
          name: "RefluxFail",
          status: "topic_pending",
          storageKey: project.id,
          storageDisplayName: "RefluxFail",
        },
      });

      const auth = createAuthenticatedAuthContext({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: "ADMIN",
        sessionId: "s",
      });

      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/topic/recommendations`,
        payload: {
          canonical_name: "玄武门之变",
          summary: "李世民在玄武门伏杀建成元吉",
          core_conflict: "兄弟夺位",
          strong_scene: "玄武门伏杀",
          source_hint: "测试",
          recent_usage_hint: "无",
          tags: ["唐朝", "政变"],
        },
        auth,
      });

      // draft 写入失败（mock），但推荐响应仍为 200（写入失败不阻塞推荐主链路）
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.candidates.length).toBeGreaterThan(0);

      // draft 写入失败被吞掉，不影响响应；不要求 draft 数量（mock 覆盖按调用消耗）
      await waitForAsyncDrafts();
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
