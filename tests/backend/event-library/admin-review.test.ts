// 必须在所有 import 之前设置 LLM stub 模式
process.env.LLM_PROVIDER = "stub";

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { syncEventLibraryFromFiles } from "../../../backend/src/modules/event-library/event-library-sync.service.js";

/** 创建一个管理员 auth */
function adminAuth() {
  return createAuthenticatedAuthContext({
    userId: "u-admin",
    username: "admin",
    displayName: "Admin",
    role: "ADMIN",
    sessionId: "s-admin",
  });
}

/** 创建一个普通用户 auth */
function userAuth() {
  return createAuthenticatedAuthContext({
    userId: "u-user",
    username: "user",
    displayName: "User",
    role: "USER",
    sessionId: "s-user",
  });
}

describe("event-library admin review", () => {
  it("admin can list pending drafts", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      // 创建 project 和 draft
      await client.project.create({
        data: {
          id: "proj-1",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-1",
          storageDisplayName: "Test",
        },
      });

      const draft = await client.eventLibraryDraft.create({
        data: {
          id: "draft-1",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-1-fp",
          projectId: "proj-1",
          proposedTitle: "测试事件标题",
          proposedSummary: "这是测试事件的摘要内容",
          proposedAnglesJson: [{ angleLabel: "测试角度", familyLabel: "测试家族", scopeLabel: "standard" }],
          proposedTagsJson: { events: ["测试事件"] },
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts",
        payload: {},
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        drafts: Array<{
          id: string;
          draft_kind: string;
          proposed_title: string;
          status: string;
        }>;
        total: number;
      };
      expect(body.total).toBeGreaterThanOrEqual(1);
      const found = body.drafts.find((d) => d.id === "draft-1");
      expect(found).toBeTruthy();
      expect(found!.proposed_title).toBe("测试事件标题");
      expect(found!.status).toBe("draft");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admin can approve draft and create new entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-2",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-2",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-2",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-2-fp",
          projectId: "proj-2",
          proposedTitle: "全新测试事件",
          proposedSummary: "一个全新的历史事件摘要",
          proposedAnglesJson: [
            { angleLabel: "独家角度", familyLabel: "政治斗争", scopeLabel: "standard" },
          ],
          proposedTagsJson: {
            events: ["全新事件"],
            characterTags: ["人物甲", "人物乙"],
          },
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-2/approve",
        payload: { dynasty: "战国", era: "ancient" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { draft_id: string; entry_id: string; merged: boolean };
      expect(body.draft_id).toBe("draft-2");
      expect(body.merged).toBe(false);
      expect(body.entry_id).toBeTruthy();

      // 验证 draft 状态变为 approved
      const updatedDraft = await client.eventLibraryDraft.findUnique({
        where: { id: "draft-2" },
      });
      expect(updatedDraft!.status).toBe("approved");
      expect(updatedDraft!.reviewerId).toBe("u-admin");
      expect(updatedDraft!.mergedEntryId).toBe(body.entry_id);

      // 验证 entry 已创建
      const entry = await client.eventLibraryEntry.findUnique({
        where: { id: body.entry_id },
        include: { angles: true },
      });
      expect(entry).toBeTruthy();
      expect(entry!.canonicalTitle).toBe("全新测试事件");
      expect(entry!.summary).toBe("一个全新的历史事件摘要");
      expect(entry!.dynasty).toBe("战国");
      expect(entry!.angles.length).toBe(1);
      expect((entry!.angles as Array<{ angleLabel: string }>)[0].angleLabel).toBe("独家角度");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admin can approve draft and merge into existing entry by fingerprint", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-3",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-3",
          storageDisplayName: "Test",
        },
      });

      // 创建 EventRegistryEntry（FK 要求）
      await client.eventRegistryEntry.create({
        data: {
          id: "er-existing",
          canonicalName: "Existing Event",
          aliasesJson: [],
          canonicalQuotesJson: [],
          canonicalQuoteIntentsJson: [],
          sourceType: "builtin",
          isProvisional: false,
        },
      });

      // 先创建一个已有 entry
      const { generateLibraryFingerprint, generateAngleFingerprint } =
        await import(
          "../../../backend/src/modules/event-library/event-library.codec.js"
        );

      const fp = generateLibraryFingerprint("Existing Event", "战国", "ancient");

      const existingEntry = await client.eventLibraryEntry.create({
        data: {
          id: "entry-existing",
          eventRegistryEntryId: "er-existing",
          canonicalTitle: "Existing Event",
          summary: "已有事件摘要",
          dynasty: "战国",
          era: "ancient",
          characterTagsJson: { original: ["tag1"] },
          eventTypeTagsJson: ["existing_event"],
          conflictTypeTagsJson: [],
          themeMotifsJson: [],
          locationTagsJson: [],
          relationshipTagsJson: [],
          sourceAnchorRefsJson: [],
          credibilityLevel: "medium",
          visibility: "public",
          status: "curated",
          originKind: "builtin",
          libraryFingerprint: fp,
          filePath: "",
          fileContentHash: "",
        },
      });

      // 创建已有 angle
      const existingAngleFp = generateAngleFingerprint(fp, "已有角度");
      await client.eventLibraryAngle.create({
        data: {
          id: "angle-existing",
          eventLibraryEntryId: existingEntry.id,
          angleLabel: "已有角度",
          familyLabel: "政治",
          scopeLabel: "standard",
          angleFingerprint: existingAngleFp,
          riskHintsJson: [],
        },
      });

      // 现在创建一个草稿，标题与已有 entry 相同
      await client.eventLibraryDraft.create({
        data: {
          id: "draft-merge",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-merge-fp",
          projectId: "proj-3",
          proposedTitle: "Existing Event", // 相同标题，会生成相同 fingerprint
          proposedSummary: "新补充的摘要",
          proposedAnglesJson: [
            { angleLabel: "已有角度", familyLabel: "政治", scopeLabel: "standard" },
            { angleLabel: "新角度", familyLabel: "军事", scopeLabel: "standard" },
          ],
          proposedTagsJson: {
            events: ["existing_event", "new_event"],
          },
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-merge/approve",
        payload: { dynasty: "战国", era: "ancient" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { draft_id: string; entry_id: string; merged: boolean };
      expect(body.merged).toBe(true);
      expect(body.entry_id).toBe("entry-existing");

      // 验证 draft 状态
      const updatedDraft = await client.eventLibraryDraft.findUnique({
        where: { id: "draft-merge" },
      });
      expect(updatedDraft!.status).toBe("approved");
      expect(updatedDraft!.mergedEntryId).toBe("entry-existing");

      // 验证 entry 的 angles 合并（已有角度不重复，新角度追加）
      const updatedEntry = await client.eventLibraryEntry.findUnique({
        where: { id: "entry-existing" },
        include: { angles: true },
      });
      const angleLabels = (updatedEntry!.angles as Array<{ angleLabel: string }>).map(
        (a) => a.angleLabel,
      );
      expect(angleLabels).toContain("已有角度");
      expect(angleLabels).toContain("新角度");

      // 验证 event_type_tags 合并
      const eventTags = updatedEntry!.eventTypeTagsJson as string[];
      expect(eventTags).toContain("existing_event");
      expect(eventTags).toContain("new_event");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admin can reject a draft", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-4",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-4",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-reject",
          draftKind: "custom",
          projectId: "proj-4",
          proposedTitle: "待拒绝的事件",
          proposedSummary: "这个草稿应该被拒绝",
          proposedAnglesJson: [],
          proposedTagsJson: {},
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-reject/reject",
        payload: { review_notes: "不符合入库标准" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { draft_id: string; status: string };
      expect(body.draft_id).toBe("draft-reject");
      expect(body.status).toBe("rejected");

      // 验证 draft 状态
      const updated = await client.eventLibraryDraft.findUnique({
        where: { id: "draft-reject" },
      });
      expect(updated!.status).toBe("rejected");
      expect(updated!.reviewerId).toBe("u-admin");
      expect(updated!.reviewNotes).toBe("不符合入库标准");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("non-admin cannot access admin routes", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const user = await client.user.create({
        data: {
          id: "u-user",
          username: "user",
          displayName: "User",
          passwordHash: "x",
          role: "USER",
        },
      });

      const app = buildApp({
        storageBaseDir: root,
        prismaClient: client,
        skipSnapshotLoad: true,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts",
        payload: {},
        auth: userAuth(),
      });

      expect(res.statusCode).toBe(403);
      const errBody = res.json() as { error: string };
      expect(errBody.error).toBe("admin_required");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("already-reviewed draft returns 409 on approve", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-5",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-5",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-reviewed",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-reviewed-fp",
          projectId: "proj-5",
          proposedTitle: "已审核的草稿",
          proposedSummary: "已经审核过了",
          proposedAnglesJson: [],
          proposedTagsJson: {},
          ownerId: admin.id,
          status: "approved",
          reviewerId: admin.id,
          reviewedAt: new Date(),
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-reviewed/approve",
        payload: {},
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: string; status: string };
      expect(body.error).toBe("draft_already_reviewed");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("draft not found returns 404 on approve", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      await client.user.create({
        data: {
          id: "u-admin",
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

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/nonexistent/approve",
        payload: {},
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("draft_not_found");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("approve -> sync -> entry still curated (P1 fix: file written on approve)", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-sync",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-sync",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-sync",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-sync-fp",
          projectId: "proj-sync",
          proposedTitle: "同步测试事件",
          proposedSummary: "这个事件应该在同步后仍然保留",
          proposedAnglesJson: [],
          proposedTagsJson: { events: ["sync_event"] },
          ownerId: admin.id,
          status: "draft",
        },
      });

      // 1. Approve
      const approveRes = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-sync/approve",
        payload: { dynasty: "战国" },
        auth: adminAuth(),
      });
      expect(approveRes.statusCode).toBe(200);
      const approveBody = approveRes.json() as { entry_id: string };
      expect(approveBody.entry_id).toBeTruthy();

      // 2. Verify file exists
      const entryBefore = await client.eventLibraryEntry.findUnique({
        where: { id: approveBody.entry_id },
      });
      expect(entryBefore!.status).toBe("curated");
      expect(entryBefore!.filePath).toBeTruthy();
      expect(entryBefore!.filePath).not.toBe("");

      // 3. Trigger sync
      const syncRes = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/sync",
        payload: {},
        auth: adminAuth(),
      });
      expect(syncRes.statusCode).toBe(200);

      // 4. Entry should still be curated, not archived
      const entryAfter = await client.eventLibraryEntry.findUnique({
        where: { id: approveBody.entry_id },
      });
      expect(entryAfter!.status).toBe("curated");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("review endpoint: approve via /review", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-review",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-review",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-review",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-review-fp",
          projectId: "proj-review",
          proposedTitle: "Review 端点测试",
          proposedSummary: "通过统一 review 端点审核",
          proposedAnglesJson: [],
          proposedTagsJson: { events: ["review_event"] },
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-review/review",
        payload: { decision: "approve", dynasty: "战国" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { draft_id: string; entry_id: string; merged: boolean };
      expect(body.draft_id).toBe("draft-review");
      expect(body.entry_id).toBeTruthy();

      // 验证写入了文件
      const entry = await client.eventLibraryEntry.findUnique({
        where: { id: body.entry_id },
      });
      expect(entry!.filePath).toBeTruthy();
      expect(entry!.filePath).not.toBe("");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("review endpoint: reject via /review", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-review2",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-review2",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-review2",
          draftKind: "custom",
          projectId: "proj-review2",
          proposedTitle: "Review 拒绝测试",
          proposedSummary: "测试拒绝",
          proposedAnglesJson: [],
          proposedTagsJson: {},
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-review2/review",
        payload: { decision: "reject", review_notes: "测试拒绝原因" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { draft_id: string; status: string };
      expect(body.draft_id).toBe("draft-review2");
      expect(body.status).toBe("rejected");

      const draft = await client.eventLibraryDraft.findUnique({
        where: { id: "draft-review2" },
      });
      expect(draft!.status).toBe("rejected");
      expect(draft!.reviewNotes).toBe("测试拒绝原因");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("review endpoint: invalid decision returns 400", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
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

      await client.project.create({
        data: {
          id: "proj-review3",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-review3",
          storageDisplayName: "Test",
        },
      });

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-review3",
          draftKind: "custom",
          projectId: "proj-review3",
          proposedTitle: "无效决策测试",
          proposedSummary: "测试",
          proposedAnglesJson: [],
          proposedTagsJson: {},
          ownerId: admin.id,
          status: "draft",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-review3/review",
        payload: { decision: "hold" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toContain("decision");
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merge into file-synced entry: overwrites original file, sync does not lose merged content", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-admin-"));
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    const client = await createPrismaClient(dbPath);

    try {
      const admin = await client.user.create({
        data: {
          id: "u-admin",
          username: "admin",
          displayName: "Admin",
          passwordHash: "x",
          role: "ADMIN",
        },
      });

      // 1. 创建 JSON 文件并 sync 入 DB（模拟文件来源 entry）
      const libDir = join(root, "storage", "event-library", "tang");
      mkdirSync(libDir, { recursive: true });
      const filePath = join(libDir, "xuanwumen.json");

      const originalFile = {
        schemaVersion: 1,
        canonicalTitle: "玄武门之变",
        summary: "李世民在玄武门伏杀建成元吉。",
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
        angles: [
          {
            angleLabel: "已有角度",
            familyLabel: "政治",
            scopeLabel: "standard",
          },
        ],
      };
      writeFileSync(filePath, JSON.stringify(originalFile, null, 2), "utf8");

      // Sync：从文件创建 entry
      const r1 = await syncEventLibraryFromFiles(client, root);
      expect(r1.created).toBe(1);
      expect(r1.errors).toHaveLength(0);

      const entryAfterSync = await client.eventLibraryEntry.findFirst({
        where: { canonicalTitle: "玄武门之变" },
        include: { angles: true },
      });
      expect(entryAfterSync).toBeTruthy();
      expect(entryAfterSync!.status).toBe("curated");
      expect(entryAfterSync!.filePath).toBeTruthy();
      const originalFilePath = entryAfterSync!.filePath;
      expect(entryAfterSync!.characterTagsJson).toEqual(["李世民", "李建成"]);
      expect(entryAfterSync!.eventTypeTagsJson).toEqual(["继承夺位"]);
      const angleLabels1 = (entryAfterSync!.angles as Array<{ angleLabel: string }>)
        .map((a) => a.angleLabel);
      expect(angleLabels1).toContain("已有角度");

      // 2. 构建 app 并创建同 fingerprint 草稿
      const app = buildApp({
        storageBaseDir: root,
        prismaClient: client,
        skipSnapshotLoad: true,
      });

      await client.project.create({
        data: {
          id: "proj-merge-fs",
          ownerId: admin.id,
          createdById: admin.id,
          name: "Test",
          status: "topic_pending",
          storageKey: "proj-merge-fs",
          storageDisplayName: "Test",
        },
      });

      const { generateLibraryFingerprint, generateAngleFingerprint } =
        await import(
          "../../../backend/src/modules/event-library/event-library.codec.js"
        );

      await client.eventLibraryDraft.create({
        data: {
          id: "draft-merge-fs",
          draftKind: "recommendation_reflux",
          candidateFingerprint: "draft-merge-fs-fp",
          projectId: "proj-merge-fs",
          proposedTitle: "玄武门之变",
          proposedSummary: "新补充的角度",
          proposedAnglesJson: [
            { angleLabel: "已有角度", familyLabel: "政治", scopeLabel: "standard" },
            { angleLabel: "新角度", familyLabel: "军事", scopeLabel: "standard" },
          ],
          proposedTagsJson: {
            events: ["继承夺位", "new-event"],
          },
          ownerId: admin.id,
          status: "draft",
        },
      });

      // 3. 审批草稿 → 合并到已有 entry
      const res = await app.inject({
        method: "POST",
        url: "/api/admin/event-library/drafts/draft-merge-fs/approve",
        payload: { dynasty: "唐", era: "初唐" },
        auth: adminAuth(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { draft_id: string; entry_id: string; merged: boolean };
      expect(body.merged).toBe(true);
      expect(body.entry_id).toBe(entryAfterSync!.id);

      // 4. 验证 filePath 未变（写回原文件，而非新建）
      const entryAfterMerge = await client.eventLibraryEntry.findUnique({
        where: { id: entryAfterSync!.id },
        include: { angles: true },
      });
      expect(entryAfterMerge!.filePath).toBe(originalFilePath);

      // 5. 验证磁盘文件包含合并后的内容
      const diskContent = JSON.parse(readFileSync(join(root, originalFilePath!), "utf8"));
      const diskAngles = diskContent.angles.map((a: { angleLabel: string }) => a.angleLabel);
      expect(diskAngles).toContain("已有角度");
      expect(diskAngles).toContain("新角度");
      expect(diskContent.eventTypeTags).toContain("继承夺位");
      expect(diskContent.eventTypeTags).toContain("new-event");
      // characterTags 仍是数组（string[]），不是对象
      expect(Array.isArray(diskContent.characterTags)).toBe(true);
      expect(diskContent.characterTags).toEqual(["李世民", "李建成"]);

      // 6. 验证 DB 中合并后的 angles 和 tags
      const mergedAngles = (entryAfterMerge!.angles as Array<{ angleLabel: string }>)
        .map((a) => a.angleLabel);
      expect(mergedAngles).toContain("已有角度");
      expect(mergedAngles).toContain("新角度");
      const mergedEventTags = entryAfterMerge!.eventTypeTagsJson as string[];
      expect(mergedEventTags).toContain("继承夺位");
      expect(mergedEventTags).toContain("new-event");
      // characterTagsJson 仍为 string[]，没有被错误覆盖
      expect(entryAfterMerge!.characterTagsJson).toEqual(["李世民", "李建成"]);

      // 7. 再次 sync：entry 不能被归档，合并内容不能丢失
      const r2 = await syncEventLibraryFromFiles(client, root);
      expect(r2.archived).toBe(0);

      const entryAfterReSync = await client.eventLibraryEntry.findUnique({
        where: { id: entryAfterSync!.id },
        include: { angles: true },
      });
      expect(entryAfterReSync!.status).toBe("curated");
      const reSyncAngles = (entryAfterReSync!.angles as Array<{ angleLabel: string }>)
        .map((a) => a.angleLabel);
      expect(reSyncAngles).toContain("已有角度");
      expect(reSyncAngles).toContain("新角度");
      const reSyncEventTags = entryAfterReSync!.eventTypeTagsJson as string[];
      expect(reSyncEventTags).toContain("继承夺位");
      expect(reSyncEventTags).toContain("new-event");
      expect(entryAfterReSync!.characterTagsJson).toEqual(["李世民", "李建成"]);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
