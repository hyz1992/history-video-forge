// 短成语/典故验收：验证 4 字成语能通过长度层 + LLM credibility 判定为 high
// 用法：node --import tsx scripts/accept-idiom-cases.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { buildApp } from "../backend/src/app.js";
import { createPrismaClient } from "../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../tests/backend/db/migration-test-utils.js";

interface CaseResult {
  name: string;
  rawDigest: string;
  statusCode: number;
  body: unknown;
  elapsedSec: string;
}

async function setupApp() {
  const root = mkdtempSync(join(tmpdir(), "svf-idiom-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(dbPath);
  const user = await client.user.create({
    data: {
      id: `u-idiom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username: `u-idiom-${Date.now()}`,
      displayName: "Idiom Test",
      passwordHash: "x",
      role: "ADMIN",
    },
  });
  const auth = createAuthenticatedAuthContext({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: "ADMIN",
    sessionId: "s-idiom",
  });
  const app = buildApp({
    storageBaseDir: root,
    prismaClient: client,
    skipSnapshotLoad: true,
  });
  return { root, client, app, auth };
}

async function runCase(name: string, rawDigest: string): Promise<CaseResult> {
  const ctx = await setupApp();
  try {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: `idiom-${name}` },
      auth: ctx.auth,
    });
    const projectId = createRes.json().project_id;
    const t0 = Date.now();
    const r = await ctx.app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/from-custom`,
      payload: { rawDigest },
      auth: ctx.auth,
    });
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    return { name, rawDigest, statusCode: r.statusCode, body: r.json(), elapsedSec };
  } finally {
    await ctx.client.$disconnect();
    rmSync(ctx.root, { recursive: true, force: true });
  }
}

function summarize(r: CaseResult): string {
  const body = r.body as Record<string, unknown>;
  const candidates = (body?.candidates as Array<Record<string, unknown>>) ?? [];
  const refined = body?.refined as Record<string, unknown> | undefined;
  const lines: string[] = [];
  lines.push(`### [${r.name}] status=${r.statusCode} 耗时=${r.elapsedSec}s`);
  lines.push(`rawDigest: "${r.rawDigest}" (字数: ${r.rawDigest.length})`);
  if (r.statusCode !== 200) {
    lines.push(`error: ${JSON.stringify(body?.error)} | message: ${JSON.stringify(body?.message)}`);
    if (refined) {
      lines.push(`refined.credibility: ${JSON.stringify(refined.credibility)}`);
      lines.push(`refined.refinedNote: ${JSON.stringify(refined.refinedNote)}`);
    }
    return lines.join("\n");
  }
  lines.push(`candidates.length: ${candidates.length}`);
  if (refined) {
    lines.push(`refined.canonicalName: ${JSON.stringify(refined.canonicalName)}`);
    lines.push(`refined.summary: ${JSON.stringify(refined.summary)}`);
    lines.push(`refined.dynasty: ${JSON.stringify(refined.dynasty)}`);
    lines.push(`refined.characterTags: ${JSON.stringify(refined.characterTags)}`);
    lines.push(`refined.credibility: ${JSON.stringify(refined.credibility)}`);
    lines.push(`refined.refinedNote: ${JSON.stringify(refined.refinedNote)}`);
  }
  if (typeof body?.warning === "string" && body.warning.trim().length > 0) {
    lines.push(`warning: ${JSON.stringify(body.warning)}`);
  }
  candidates.forEach((c, i) => {
    lines.push(`  [${i + 1}] title: ${c.title}`);
    lines.push(`      core_conflict: ${c.core_conflict}`);
  });
  return lines.join("\n");
}

// 关键验收用例：
// 1. 真实成语（应 200 + credibility=high）
// 2. 4 字随机词（应 422，credibility=invalid）
// 3. 3 字过短（应 400，长度层拒绝）
const CASES: Array<{ name: string; rawDigest: string }> = [
  { name: "成语-晏子使楚", rawDigest: "晏子使楚" },
  { name: "成语-完璧归赵", rawDigest: "完璧归赵" },
  { name: "成语-破釜沉舟", rawDigest: "破釜沉舟" },
  { name: "随机词-风花雪月", rawDigest: "风花雪月" },
  { name: "随机词-金木水火土", rawDigest: "金木水火土" },
  { name: "过短-3字", rawDigest: "一二三" },
];

async function main() {
  const results: CaseResult[] = [];
  for (const c of CASES) {
    process.stdout.write(`[${c.name}] 运行中... `);
    try {
      const r = await runCase(c.name, c.rawDigest);
      results.push(r);
      console.log(`done (status=${r.statusCode})`);
    } catch (e) {
      console.log(`EXCEPTION: ${(e as Error).message}`);
      results.push({
        name: c.name,
        rawDigest: c.rawDigest,
        statusCode: -1,
        body: { error: "exception", message: (e as Error).message },
        elapsedSec: "?",
      });
    }
  }

  console.log("\n========== 成语/短输入验收报告 ==========\n");
  for (const r of results) {
    console.log(summarize(r));
    console.log("");
  }
  console.log("========== 报告结束 ==========");
}

main().catch((e) => {
  console.error("未捕获错误:", e);
  process.exit(1);
});
