// 必须在所有 import 之前设置 LLM stub 模式
process.env.LLM_PROVIDER = "stub";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

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
});
