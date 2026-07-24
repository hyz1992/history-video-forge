// 三 tab 验收脚本（plan v4 §5.5）
// 不走 vitest（vitest 会隔离 .env），直接 node + tsx 跑，让 env.ts 正常读 .env
// 用法：node --import tsx scripts/accept-three-tab.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { buildApp } from "../backend/src/app.js";
import { createPrismaClient } from "../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../tests/backend/db/migration-test-utils.js";

async function setupApp() {
  const root = mkdtempSync(join(tmpdir(), "svf-accept-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(dbPath);

  const user = await client.user.create({
    data: {
      id: `u-accept-${Date.now()}`,
      username: `u-accept-${Date.now()}`,
      displayName: "Accept Test",
      passwordHash: "x",
      role: "ADMIN",
    },
  });
  const auth = createAuthenticatedAuthContext({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: "ADMIN",
    sessionId: "s-accept",
  });
  const app = buildApp({
    storageBaseDir: root,
    prismaClient: client,
    skipSnapshotLoad: true,
  });
  return { root, client, app, auth };
}

async function main() {
  console.log("=== 验收 1: 自定义 tab (3 → selector → 1, 真实 LLM) ===");
  const ctx1 = await setupApp();
  try {
    const createRes = await ctx1.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "验收-自定义" },
      auth: ctx1.auth,
    });
    const projectId = createRes.json().project_id;
    console.log(`项目已创建: ${projectId}`);

    console.log("调用 from-custom（真实 LLM，预计 60-120s）...");
    const t0 = Date.now();
    const r = await ctx1.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/from-custom`,
      payload: {
        rawDigest: "玄武门之变，李世民在长安太极宫玄武门伏杀太子李建成和齐王李元吉。",
      },
      auth: ctx1.auth,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`耗时 ${elapsed}s, status=${r.statusCode}`);

    const body = r.json();
    if (r.statusCode !== 200) {
      console.error("✗ 失败:", JSON.stringify(body, null, 2));
      process.exit(1);
    }
    console.log(`source_mode: ${body.source_mode}`);
    console.log(`candidates.length: ${body.candidates.length} (期望 1)`);
    if (body.candidates.length !== 1) {
      console.error(`✗ 期望 1 条，实际 ${body.candidates.length}`);
      process.exit(1);
    }
    console.log(`✓ 候选标题: ${body.candidates[0].title}`);
    console.log(`✓ 切角: ${body.candidates[0].one_line_angle}`);
    console.log(`✓ 自定义 tab 验收通过\n`);
  } finally {
    await ctx1.client.$disconnect();
    rmSync(ctx1.root, { recursive: true, force: true });
  }

  console.log("=== 验收 2: 系统推荐 tab (默认 8→4, 真实 LLM) ===");
  const ctx2 = await setupApp();
  try {
    const createRes = await ctx2.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "验收-系统推荐" },
      auth: ctx2.auth,
    });
    const projectId = createRes.json().project_id;

    console.log("调用 recommendations（真实 LLM，预计 60-120s）...");
    const t0 = Date.now();
    const r = await ctx2.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/recommendations`,
      payload: {
        canonical_name: "安史之乱",
        summary: "唐玄宗天宝年间，范阳节度使安禄山起兵叛唐，攻陷两京，唐朝由盛转衰。",
        core_conflict: "藩镇军阀安禄山以清君侧为名起兵反唐，玄宗朝廷仓促应对。",
        strong_scene: "潼关失守，玄宗携杨贵妃仓皇出逃蜀地，至马嵬驿将士哗变。",
        source_hint: "基于历史共识推定",
        recent_usage_hint: "近期未使用",
        tags: ["战争", "唐朝", "藩镇"],
      },
      auth: ctx2.auth,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`耗时 ${elapsed}s, status=${r.statusCode}`);

    const body = r.json();
    if (r.statusCode !== 200) {
      console.error("✗ 失败:", JSON.stringify(body, null, 2));
      process.exit(1);
    }
    console.log(`candidates.length: ${body.candidates.length} (期望 ≤4，默认目标 4)`);
    if (body.candidates.length > 4) {
      console.error(`✗ 系统推荐回归坏：超过 4 条，实际 ${body.candidates.length}`);
      process.exit(1);
    }
    body.candidates.forEach((c: { title: string; one_line_angle: string }, i: number) =>
      console.log(`  [${i + 1}] ${c.title} | ${c.one_line_angle}`)
    );
    console.log(`✓ 系统推荐 tab 回归通过\n`);
  } finally {
    await ctx2.client.$disconnect();
    rmSync(ctx2.root, { recursive: true, force: true });
  }

  console.log("=== 全部验收通过 ===");
}

main().catch((e) => {
  console.error("未捕获错误:", e);
  process.exit(1);
});
