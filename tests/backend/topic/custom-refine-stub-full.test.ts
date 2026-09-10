// 覆盖 from-custom controller 链路（FK 同步、source_mode、topicCandidateStore 写入）。
// 注意：此测试 mock refineCustomTopic，**不**验证 LLM 内容质量；
// LLM 真假由真实 LLM live check（harness）覆盖，不在本文件职责内。
//
// 历史背景：曾存在 stub 分支在本地糊弄 refine 结果，已按 AGENTS.md 删除。
// 本测试沿用 mock，仅断言 controller 对 refine 输出的处理是否正确。

process.env.LLM_PROVIDER = "stub";
process.env.LLM_STUB_DELAY_MS = "10";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createLegacyProject } from "../projects/legacy-project.fixture.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

// Mock refineCustomTopic：返回合法结构，避免真实 LLM 调用
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

describe("custom refine controller chain (real /api/projects)", () => {
  it("returns 200 with candidates via POST /api/projects → /topic/from-custom", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-custom-api-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
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

      // 口播前置定版后创建入口要求口播资格选择；经 legacy 夹具直造
      const project = await createLegacyProject(app.db, { name: "FullStubApiTest", ownerId: user.id, createdById: user.id });
      const projectId = project.id;

      // 通过 POST /topic/from-custom 生成候选
      const r = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/topic/from-custom`,
        payload: {
          rawDigest: "玄武门之变，李世民在长安太极宫玄武门伏杀太子李建成和齐王李元吉。",
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
      // 自定义入口差异化合同：3 → selector → 1
      expect(body.candidates.length).toBe(1);
      expect(body.source_ref.customDraftId).toBeDefined();
      expect(body.source_ref.customDraftId).not.toBeNull();

      // candidate 已写入 topicCandidateStore
      const store = app.topicCandidateStore.get(projectId);
      expect(store).toBeDefined();
      expect(store!.rounds.length).toBeGreaterThanOrEqual(1);
      expect(store!.rounds[0].candidates[0].sourceMode).toBe("custom");

      // createProjectController 已自动创建 Prisma Project
      const prismaProject = await client.project.findUnique({ where: { id: projectId } });
      expect(prismaProject).not.toBeNull();
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
