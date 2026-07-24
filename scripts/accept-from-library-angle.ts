// 真实 LLM 验收：from-library 角度生效 + 3→1 合同
// 用法：node --import tsx scripts/accept-from-library-angle.ts
//
// 验收点：
// 1. 返回 1 个候选（3→1，而非 4 个）
// 2. 有角度时，候选围绕该角度展开（不发散到夫差/文种/西施）
// 3. 无角度时，候选围绕事件自由生成（对照组）
// 4. trace 里 builder input 包含 angle_hint（仅有角度时）

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

import { buildApp } from "../backend/src/app.js";
import { createPrismaClient } from "../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../tests/backend/db/migration-test-utils.js";

const GOUJIAN_EVENT_JSON = JSON.stringify({
  schemaVersion: 1,
  canonicalTitle: "勾践卧薪尝胆",
  summary: "春秋晚期，越王勾践被吴王夫差击败后，卧薪尝胆，励精图治，最终灭吴复仇，成就霸业。",
  eventRegistryCanonicalName: "勾践卧薪尝胆",
  aliases: ["卧薪尝胆"],
  dynasty: "春秋",
  era: "春秋晚期",
  characterTags: ["勾践", "夫差", "范蠡", "文种"],
  eventTypeTags: ["战争"],
  conflictTypeTags: ["复仇战争"],
  themeMotifs: ["复仇", "隐忍", "励志"],
  locationTags: ["会稽", "姑苏"],
  relationshipTags: ["仇敌", "君臣"],
  sourceAnchorRefs: ["史记", "左传"],
  credibilityLevel: "medium",
  disputeNotes: null,
  origin: "builtin",
  angles: [
    {
      angleLabel: "从勾践的视角看卧薪尝胆的复仇之路——从阶下囚到霸主的蜕变",
      familyLabel: "人物传奇型",
      scopeLabel: "standard",
    },
  ],
});

interface CaseResult {
  name: string;
  withAngle: boolean;
  statusCode: number;
  body: unknown;
  elapsedSec: string;
}

async function runCase(name: string, withAngle: boolean): Promise<CaseResult> {
  const root = mkdtempSync(join(tmpdir(), "svf-accept-angle-"));
  const libDir = join(root, "storage", "event-library", "chunqiu");
  mkdirSync(libDir, { recursive: true });
  writeFileSync(join(libDir, "goujian.json"), GOUJIAN_EVENT_JSON, "utf8");

  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  try {
    const user = await client.user.create({
      data: {
        id: `u-accept-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        username: `u-accept-${Date.now()}`,
        displayName: "Accept",
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
    const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });

    // sync 入库
    const { syncEventLibraryFromFiles } = await import("../backend/src/modules/event-library/event-library-sync.service.js");
    await syncEventLibraryFromFiles(client, root);

    // 创建项目
    const createRes = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: `accept-${name}` },
      auth,
    });
    const projectId = createRes.json().project_id;

    // 取 entry + angle
    const entriesResp = await app.inject({ method: "GET", url: "/api/event-library/entries" });
    const entry = entriesResp.json().entries[0];
    const detailResp = await app.inject({ method: "GET", url: `/api/event-library/entries/${entry.id}` });
    const angleId = detailResp.json().angles[0].id;

    const payload: Record<string, unknown> = { eventLibraryEntryId: entry.id };
    if (withAngle) payload.angleId = angleId;

    const t0 = Date.now();
    const r = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/topic/from-library`,
      payload,
      auth,
    });
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);

    return { name, withAngle, statusCode: r.statusCode, body: r.json(), elapsedSec };
  } finally {
    await client.$disconnect();
    rmSync(root, { recursive: true, force: true });
  }
}

function isAngleAligned(title: string, oneLineAngle: string): boolean {
  // 角度是"从勾践的视角看卧薪尝胆的复仇之路"
  // 合法：勾践视角、复仇、隐忍、卧薪尝胆、会稽之耻、归国、复国、励精图治
  // 非法（偏题）：夫差视角、西施、文种之死、称霸后
  const text = `${title} ${oneLineAngle}`;
  const alignedKeywords = ["勾践", "复仇", "隐忍", "卧薪", "尝胆", "会稽", "归国", "复国", "励精", "忍辱", "图治"];
  const offTopicKeywords = ["夫差视角", "西施", "文种之死", "称霸后", "范蠡泛舟", "兔死狗烹"];

  const hasOffTopic = offTopicKeywords.some((k) => text.includes(k));
  const hasAligned = alignedKeywords.some((k) => text.includes(k));
  return hasAligned && !hasOffTopic;
}

function summarize(r: CaseResult): string {
  const body = r.body as Record<string, unknown>;
  const candidates = (body?.candidates as Array<Record<string, unknown>>) ?? [];
  const lines: string[] = [];
  lines.push(`### [${r.name}] withAngle=${r.withAngle} status=${r.statusCode} 耗时=${r.elapsedSec}s`);

  if (r.statusCode !== 200) {
    lines.push(`error: ${JSON.stringify(body?.error)} | message: ${JSON.stringify(body?.message)}`);
    return lines.join("\n");
  }

  lines.push(`candidates.length: ${candidates.length} (期望 1)`);
  candidates.forEach((c, i) => {
    const title = String(c.title ?? "");
    const angle = String(c.one_line_angle ?? "");
    const aligned = isAngleAligned(title, angle);
    lines.push(`  [${i + 1}]${aligned ? " ✅角度对齐" : " ❌偏题"} title: ${title}`);
    lines.push(`      angle: ${angle}`);
    lines.push(`      core_conflict: ${c.core_conflict}`);
  });
  return lines.join("\n");
}

async function main() {
  console.log("=== 验收 1: 有角度（应围绕勾践视角的复仇之路）===");
  const r1 = await runCase("有角度", true);
  console.log(summarize(r1));

  console.log("\n=== 验收 2: 无角度（对照组，围绕事件自由生成）===");
  const r2 = await runCase("无角度", false);
  console.log(summarize(r2));

  console.log("\n========== 验收要点 ==========");
  console.log("1. 两次都应返回 1 个候选（3→1 合同）");
  console.log("2. 有角度的候选应围绕勾践视角的复仇叙事（不发散到夫差/西施/文种之死）");
  console.log("3. 无角度的候选围绕勾践卧薪尝胆事件自由生成（对照组）");
}

main().catch((e) => {
  console.error("未捕获错误:", e);
  process.exit(1);
});
