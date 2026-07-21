// 必须在所有 import 之前设置 LLM stub 模式
process.env.LLM_PROVIDER = "stub";
process.env.LLM_STUB_DELAY_MS = "10";

// 不 mock refineCustomTopic：使用真实 stub 分支，且通过 POST /api/projects 创建项目
// （模拟真实 UI 路径，不手工插入 Prisma Project 行）

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

describe("custom refine stub full chain (real /api/projects)", () => {
  it("returns 200 with candidates via POST /api/projects → /topic/from-custom", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-custom-api-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      // 1. 创建用户（模拟登录态）
      const user = await client.user.create({
        data: {
          id: `u-custom-api-${Date.now()}`,
          username: `u-custom-api-${Date.now()}`,
          displayName: "API Path Test",
          passwordHash: "x",
          role: "ADMIN",
        },
      });

      const auth = createAuthenticatedAuthContext({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: "ADMIN",
        sessionId: "s",
      });

      const app = buildApp({
        storageBaseDir: root,
        prismaClient: client,
        skipSnapshotLoad: true,
      });

      // 2. 通过 POST /api/projects 创建项目（真实 UI 路径）
      const createRes = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "FullStubApiTest" },
        auth,
      });

      expect(createRes.statusCode).toBe(201);
      const createBody = createRes.json();
      const projectId = createBody.project_id;
      expect(projectId).toBeDefined();

      // 3. 通过 POST /api/projects/:id/topic/from-custom 生成候选（真实 UI 路径）
      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/topic/from-custom`,
        payload: {
          rawDigest: "玄武门之变，李世民在长安太极宫玄武门伏杀太子李建成和齐王李元吉，随后逼迫唐高祖李渊退位，自己登基称帝。",
        },
        auth,
      });

      if (r.statusCode !== 200) {
        console.error("FAIL BODY:", JSON.stringify(r.json(), null, 2));
      }

      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.source_mode).toBe("custom");
      expect(body.candidates).toBeDefined();
      expect(body.candidates.length).toBeGreaterThan(0);
      expect(body.refined).toBeDefined();
      expect(body.refined.canonicalName).toBeTruthy();
      expect(body.source_ref.customDraftId).toBeDefined();
      expect(body.source_ref.customDraftId).not.toBeNull();

      // 验证 candidate 已写入 topicCandidateStore
      const store = app.topicCandidateStore.get(projectId);
      expect(store).toBeDefined();
      expect(store!.rounds.length).toBeGreaterThanOrEqual(1);
      const storedCandidate = store!.rounds[0].candidates[0];
      expect(storedCandidate.sourceMode).toBe("custom");

      // 验证 Prisma Project 已由 createProjectController 自动创建
      const prismaProject = await client.project.findUnique({ where: { id: projectId } });
      expect(prismaProject).not.toBeNull();
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
