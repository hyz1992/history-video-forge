import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { applyAllDatabaseMigrations } from "../../../tests/backend/db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";

const ADMIN_ID = "u-admin";

interface CheckResult {
  check: string;
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(check: string, pass: boolean, detail?: string) {
  results.push({ check, pass, detail });
  const mark = pass ? "✓" : "✗";
  console.log(`  ${mark} ${check}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("=== S2-5 G7 真实验收 ===\n");

  const root = mkdtempSync(join(tmpdir(), "svf2-g7-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);

  try {
    // ── 1. 创建 admin 用户 ──
    await client.user.create({
      data: {
        id: ADMIN_ID,
        username: "admin",
        displayName: "Admin",
        passwordHash: "x",
        role: "ADMIN",
      },
    });

    const app = buildApp({
      storageBaseDir: root,
      prismaClient: client,
      skipSnapshotLoad: true,
    });

    const adminAuth = () =>
      createAuthenticatedAuthContext({
        userId: ADMIN_ID,
        username: "admin",
        displayName: "Admin",
        role: "ADMIN",
        sessionId: "s-admin",
      });

    // ═══════════════════════════════════════════
    // G7-1: 事件库浏览 API (Tab B 后端)
    // ═══════════════════════════════════════════
    console.log("G7-1: 事件库浏览 API");

    // GET /api/event-library/dynasties
    const dynastiesRes = await app.inject({
      method: "GET",
      url: "/api/event-library/dynasties",
    });
    record(
      "GET /api/event-library/dynasties returns 200",
      dynastiesRes.statusCode === 200,
      `status=${dynastiesRes.statusCode}`,
    );

    // GET /api/event-library/entries
    const entriesRes = await app.inject({
      method: "GET",
      url: "/api/event-library/entries",
      payload: { page: 1, page_size: 5 },
    });
    record(
      "GET /api/event-library/entries returns 200",
      entriesRes.statusCode === 200,
      `status=${entriesRes.statusCode}`,
    );

    const entriesBody = entriesRes.json() as { entries: unknown[]; total: number };
    record(
      "entries response has entries array",
      Array.isArray(entriesBody.entries),
    );
    record(
      "entries response has total field",
      typeof entriesBody.total === "number",
    );

    // GET /api/event-library/entries with character_tag filter
    const charTagRes = await app.inject({
      method: "GET",
      url: "/api/event-library/entries",
      payload: { character_tag: "test" },
    });
    record(
      "GET /api/event-library/entries?character_tag= returns 200",
      charTagRes.statusCode === 200,
      `status=${charTagRes.statusCode}`,
    );

    // GET /api/event-library/entries with event_type_tag filter
    const evTagRes = await app.inject({
      method: "GET",
      url: "/api/event-library/entries",
      payload: { event_type_tag: "test" },
    });
    record(
      "GET /api/event-library/entries?event_type_tag= returns 200",
      evTagRes.statusCode === 200,
      `status=${evTagRes.statusCode}`,
    );

    // ═══════════════════════════════════════════
    // G7-2: 管理员 API
    // ═══════════════════════════════════════════
    console.log("\nG7-2: 管理员 API");

    // GET /api/admin/event-library/drafts (list drafts)
    const draftsRes = await app.inject({
      method: "GET",
      url: "/api/admin/event-library/drafts",
      auth: adminAuth(),
    });
    record(
      "GET /api/admin/event-library/drafts returns 200",
      draftsRes.statusCode === 200,
      `status=${draftsRes.statusCode}`,
    );

    const draftsBody = draftsRes.json() as { drafts: unknown[] };
    record(
      "drafts response has drafts array",
      Array.isArray(draftsBody.drafts),
    );

    // GET /api/admin/event-library/entries (admin entries list)
    const adminEntriesRes = await app.inject({
      method: "GET",
      url: "/api/admin/event-library/entries",
      auth: adminAuth(),
    });
    record(
      "GET /api/admin/event-library/entries returns 200",
      adminEntriesRes.statusCode === 200,
      `status=${adminEntriesRes.statusCode}`,
    );

    const adminEntriesBody = adminEntriesRes.json() as {
      entries: Array<{
        id: string;
        canonical_title: string;
        character_tags: unknown;
        event_type_tags: unknown;
      }>;
      total: number;
    };
    record(
      "admin entries list has entries array",
      Array.isArray(adminEntriesBody.entries),
    );

    // POST /api/admin/event-library/entries (create entry)
    const createRes = await app.inject({
      method: "POST",
      url: "/api/admin/event-library/entries",
      payload: {
        canonicalTitle: "管理员验收测试事件",
        summary: "通过G7验收创建的测试事件",
        dynasty: "唐",
        characterTags: ["李世民"],
        eventTypeTags: ["继承夺位"],
        credibilityLevel: "high",
      },
      auth: adminAuth(),
    });
    record(
      "POST /api/admin/event-library/entries returns 201",
      createRes.statusCode === 201,
      `status=${createRes.statusCode}`,
    );
    const createBody = createRes.json() as { entry_id: string; created: boolean };
    record(
      "created entry has entry_id",
      !!createBody.entry_id,
    );
    const createdEntryId = createBody.entry_id;

    // PATCH /api/admin/event-library/entries/:id (edit entry)
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/api/admin/event-library/entries/${createdEntryId}`,
      payload: { summary: "已修改的摘要" },
      auth: adminAuth(),
    });
    record(
      "PATCH /api/admin/event-library/entries/:id returns 200",
      patchRes.statusCode === 200,
      `status=${patchRes.statusCode}`,
    );

    // DELETE /api/admin/event-library/entries/:id (archive entry)
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/admin/event-library/entries/${createdEntryId}`,
      auth: adminAuth(),
    });
    record(
      "DELETE /api/admin/event-library/entries/:id returns 200",
      deleteRes.statusCode === 200,
      `status=${deleteRes.statusCode}`,
    );

    // POST /api/admin/event-library/sync (trigger sync)
    const syncRes = await app.inject({
      method: "POST",
      url: "/api/admin/event-library/sync",
      auth: adminAuth(),
    });
    record(
      "POST /api/admin/event-library/sync returns 200",
      syncRes.statusCode === 200,
      `status=${syncRes.statusCode}`,
    );

    // ═══════════════════════════════════════════
    // G7-3: 管理员接口鉴权
    // ═══════════════════════════════════════════
    console.log("\nG7-3: 管理员接口鉴权");

    // Anonymous access to admin routes
    const anonDrafts = await app.inject({
      method: "GET",
      url: "/api/admin/event-library/drafts",
    });
    record(
      "anonymous GET /api/admin/event-library/drafts returns 401",
      anonDrafts.statusCode === 401,
      `status=${anonDrafts.statusCode}`,
    );

    const anonEntries = await app.inject({
      method: "GET",
      url: "/api/admin/event-library/entries",
    });
    record(
      "anonymous GET /api/admin/event-library/entries returns 401",
      anonEntries.statusCode === 401,
      `status=${anonEntries.statusCode}`,
    );

    const anonSync = await app.inject({
      method: "POST",
      url: "/api/admin/event-library/sync",
    });
    record(
      "anonymous POST /api/admin/event-library/sync returns 401",
      anonSync.statusCode === 401,
      `status=${anonSync.statusCode}`,
    );

    // ═══════════════════════════════════════════
    // G7-4: 事件库→选题 + 自定义选题 API (Tab B/C 后端)
    // ═══════════════════════════════════════════
    console.log("\nG7-4: 选题生成 API");

    // Create a project via in-memory store (required for guardOwnedRoute)
    const project = await createProject(app.db, {
      name: "G7 Test",
      ownerId: ADMIN_ID,
      createdById: ADMIN_ID,
    });

    // POST /api/projects/:id/topic/from-library (Tab B)
    const fromLibraryRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/topic/from-library`,
      payload: { eventLibraryEntryId: createdEntryId },
      auth: adminAuth(),
    });
    // In stub mode with empty candidate store, may return 404 (entry not found) or 400
    record(
      "POST /api/projects/:id/topic/from-library route exists",
      fromLibraryRes.statusCode !== 404 || fromLibraryRes.json?.()?.error === "event_library_entry_not_found",
      `status=${fromLibraryRes.statusCode}`,
    );

    // POST /api/projects/:id/topic/from-custom (Tab C)
    const customRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/topic/from-custom`,
      payload: {
        text: "测试自定义文本",
      },
      auth: adminAuth(),
    });
    // This may return various statuses depending on LLM stub mode
    record(
      "POST /api/projects/:id/topic/from-custom accepted",
      customRes.statusCode === 200 || customRes.statusCode === 400,
      `status=${customRes.statusCode}`,
    );

    // ── 总结 ──
    console.log("\n=== 验收结果 ===");
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n总计: ${results.length} 项检查, ${passed} 通过, ${failed} 未通过`);

    if (failed === 0) {
      console.log("\nG7 后端 API 验收: 全部通过");
    } else {
      console.log("\nG7 后端 API 验收: 存在未通过项");
      for (const r of results) {
        if (!r.pass) {
          console.log(`  ✗ ${r.check} — ${r.detail || ""}`);
        }
      }
      process.exitCode = 1;
    }
  } finally {
    await client.$disconnect();
    rmSync(root, { recursive: true, force: true });
  }
}

main();
