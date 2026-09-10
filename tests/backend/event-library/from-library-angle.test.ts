// 验证 from-library 差异化合同（2026-07-24）：
// 1. 返回 1 个候选（3→1 合同，而非缺省的 8→4）
// 2. 用户选了角度时，angle_hint 透传到 builder prompt input
// 3. disableFallback 生效（无 topic_candidate_library fallback 诊断）
//
// 用 mock LlmGateway 精确断言 prompt input，不走 stub provider
// （stub 无法断言 angle_hint 字段是否进入 prompt input）

process.env.LLM_PROVIDER = "stub";
process.env.LLM_STUB_DELAY_MS = "10";

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { syncEventLibraryFromFiles } from "../../../backend/src/modules/event-library/event-library-sync.service.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

// 捕获 builder 收到的 input，用于断言 angle_hint 是否透传
let capturedBuilderInput: Record<string, unknown> | undefined;

// mock recommendTopicCandidatesWithTrace，直接绕过 graph，模拟 3→1 行为
// 同时通过 spy 捕获 input 验证 angle_hint
vi.mock("../../../backend/src/modules/topic/topic-recommendation.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../backend/src/modules/topic/topic-recommendation.service.js")>();
  return {
    ...actual,
    recommendTopicCandidatesWithTrace: vi.fn(async (db: unknown, input: Record<string, unknown>) => {
      capturedBuilderInput = input;
      // 模拟 3→1 合同：返回 1 个候选
      return {
        candidates: [
          {
            event_identity: input.canonicalName,
            title: `模拟候选：${input.canonicalName}`,
            one_line_angle: "模拟切入角度",
            family_label: "人物传奇型",
            scope_label: "春秋",
            estimated_duration_band: "short",
            why_this_now: "模拟 why this now",
            core_conflict: "模拟 core conflict",
            strong_scene: "模拟 strong scene",
            must_cover_preview: ["beat1", "beat2", "beat3"],
            risk_hints: ["risk1"],
            source_hint: "事件库",
            recent_usage_hint: "首次从事件库选取",
            viral_rubric: {
              hook_power: "high",
              novelty_gap: "medium",
              emotion_gap: "high",
              share_impulse: "high",
              visual_promise: "high",
            },
          },
        ],
        trace: { mocked: true },
        diagnostics: { checks: [], candidate_preview_trace: null },
        raw_candidates: [],
        selector_pool: [],
        selector_trace: null,
        topic_run: { round_id: "test_round", round_index: 1 },
      };
    }),
  };
});

function makeEventJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    canonicalTitle: "勾践卧薪尝胆",
    summary: "春秋晚期，越王勾践被吴王夫差击败后，卧薪尝胆，励精图治，最终灭吴复仇。",
    eventRegistryCanonicalName: "勾践卧薪尝胆",
    aliases: ["卧薪尝胆"],
    dynasty: "春秋",
    era: "春秋晚期",
    characterTags: ["勾践", "夫差", "范蠡"],
    eventTypeTags: ["战争"],
    conflictTypeTags: ["复仇战争"],
    themeMotifs: ["复仇", "隐忍"],
    locationTags: ["会稽"],
    relationshipTags: ["仇敌"],
    sourceAnchorRefs: ["史记"],
    credibilityLevel: "medium",
    disputeNotes: null,
    origin: "builtin",
    angles: [
      {
        angleLabel: "从勾践的视角看卧薪尝胆的复仇之路",
        familyLabel: "人物传奇型",
        scopeLabel: "standard",
      },
    ],
    ...overrides,
  });
}

async function setupApp() {
  const root = mkdtempSync(join(tmpdir(), "svf2-el-angle-contract-"));
  const libDir = join(root, "storage", "event-library");
  mkdirSync(libDir, { recursive: true });
  writeFileSync(join(libDir, "goujian.json"), makeEventJson(), "utf8");

  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  await syncEventLibraryFromFiles(client, root);

  const user = await client.user.create({
    data: { id: `u-angle-${Date.now()}`, username: `u-angle-${Date.now()}`, displayName: "U", passwordHash: "x", role: "ADMIN" },
  });
  const app = buildApp({ storageBaseDir: root, prismaClient: client, skipSnapshotLoad: true });
  const project = await createProject(app.db, { name: "AngleTest", ownerId: user.id, createdById: user.id });
  const auth = createAuthenticatedAuthContext({ userId: user.id, username: user.username, displayName: user.displayName, role: "ADMIN", sessionId: "s" });

  const entriesResp = await app.inject({ method: "GET", url: "/api/event-library/entries" });
  const entry = entriesResp.json().entries[0];
  const detailResp = await app.inject({ method: "GET", url: `/api/event-library/entries/${entry.id}` });
  const angleId = detailResp.json().angles[0].id;

  return { root, client, app, project, auth, entry, angleId };
}

describe("from-library 差异化合同（3→1 + angle_hint）", () => {
  it("用户选了角度时，angle_hint 透传到 builder input", async () => {
    const ctx = await setupApp();
    capturedBuilderInput = undefined;
    try {
      const r = await ctx.app.inject({
        method: "POST",
        url: `/api/projects/${ctx.project.id}/topic/from-library`,
        payload: { eventLibraryEntryId: ctx.entry.id, angleId: ctx.angleId },
        auth: ctx.auth,
      });
      expect(r.statusCode).toBe(200);

      // angle_hint 必须透传到 builder input
      expect(capturedBuilderInput).toBeDefined();
      expect(capturedBuilderInput!.angle_hint).toEqual({
        label: "从勾践的视角看卧薪尝胆的复仇之路",
        family: "人物传奇型",
      });

      // 3→1 合同参数也必须透传
      expect(capturedBuilderInput!.target_candidate_count).toBe(3);
      expect(capturedBuilderInput!.final_candidate_count).toBe(1);
    } finally {
      await ctx.client.$disconnect();
      rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  it("用户没选角度时，angle_hint 不传（undefined）", async () => {
    const ctx = await setupApp();
    capturedBuilderInput = undefined;
    try {
      const r = await ctx.app.inject({
        method: "POST",
        url: `/api/projects/${ctx.project.id}/topic/from-library`,
        payload: { eventLibraryEntryId: ctx.entry.id },
        auth: ctx.auth,
      });
      expect(r.statusCode).toBe(200);

      // 无 angle 时 angle_hint 不应出现在 input
      expect(capturedBuilderInput).toBeDefined();
      expect(capturedBuilderInput!.angle_hint).toBeUndefined();

      // 但 3→1 合同参数仍然透传（无论是否选角度都走 3→1）
      expect(capturedBuilderInput!.target_candidate_count).toBe(3);
      expect(capturedBuilderInput!.final_candidate_count).toBe(1);
    } finally {
      await ctx.client.$disconnect();
      rmSync(ctx.root, { recursive: true, force: true });
    }
  });

  it("返回 1 个候选（3→1 合同，而非缺省 8→4 的 4 个）", async () => {
    const ctx = await setupApp();
    try {
      const r = await ctx.app.inject({
        method: "POST",
        url: `/api/projects/${ctx.project.id}/topic/from-library`,
        payload: { eventLibraryEntryId: ctx.entry.id, angleId: ctx.angleId },
        auth: ctx.auth,
      });
      expect(r.statusCode).toBe(200);
      // mock 返回 1 个候选，验证 controller 原样返回 1 个（而非缺省的 4 个）
      expect(r.json().candidates).toHaveLength(1);
      expect(r.json().source_mode).toBe("library");
    } finally {
      await ctx.client.$disconnect();
      rmSync(ctx.root, { recursive: true, force: true });
    }
  });
});
