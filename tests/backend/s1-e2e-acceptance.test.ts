import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type AppInstance } from "../../backend/src/app.js";
import { createHttpServer } from "../../backend/src/server.js";
import { createPrismaClient } from "../../backend/src/db/prisma-client.js";
import { activateDatabase } from "../../backend/src/db/database-activation.js";
import { applyAllDatabaseMigrations } from "./db/migration-test-utils.js";
import { hashPassword } from "../../backend/src/auth/password-hash.js";
import { isMigrationOwnerPlaintextMarker } from "../../backend/src/auth/password-hash.js";
import { PrismaSessionStore, hashSessionToken, generateSessionToken } from "../../backend/src/auth/session-store.js";
import { createAuthenticatedAuthContext } from "../../backend/src/auth/auth-context.js";
import type { AuthenticatedAuthContext } from "../../backend/src/auth/auth-context.js";
import type { ProjectRecord } from "../../backend/src/db/client.js";

interface Setup {
  root: string;
  client: Awaited<ReturnType<typeof createPrismaClient>>;
  app: AppInstance;
  server: Server;
  port: number;
  adminId: string;
  userId: string;
  otherUserId: string;
  migrationOwnerId: string;
  migrationProjectId: string;
}

const ADMIN_PASSWORD = "a-strong-admin-password-99";
const USER_PASSWORD = "a-strong-user-password-99";
const OTHER_PASSWORD = "a-strong-other-password-99";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) { reject(error); return; }
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server_address_unavailable");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) { reject(error); return; } resolve(); });
  });
}

async function seedProject(
  client: Awaited<ReturnType<typeof createPrismaClient>>,
  ownerId: string,
  projectId: string,
  name: string = "Migration Legacy Project",
): Promise<string> {
  await client.project.create({
    data: {
      id: projectId,
      ownerId,
      createdById: ownerId,
      name,
      status: "script_ready",
      storageKey: `storage-${projectId}`,
      storageDisplayName: name,
    },
  });
  return projectId;
}

function mirrorProjectToMemory(app: AppInstance, projectId: string, ownerId: string, name: string = "Migration Legacy Project"): void {
  const now = new Date();
  const record: ProjectRecord = {
    id: projectId,
    name,
    ownerId,
    createdById: ownerId,
    status: "script_ready",
    activeTopicPackageId: null,
    activeScriptRecordId: null,
    activeStoryboardRecordId: null,
    activeAssetPlanRecordId: null,
    activeAssetManifestRecordId: null,
    activeComposeRecordId: null,
    activeRenderJobRecordId: null,
    activePublishPackageRecordId: null,
    latestTopicRunTraceJson: null,
    latestScriptRunTraceJson: null,
    latestStoryboardRunTraceJson: null,
    latestAssetPlanRunTraceJson: null,
    latestAssetsRunTraceJson: null,
    latestComposeRunTraceJson: null,
    latestRenderRunTraceJson: null,
    storageDisplayName: "",
    storageShortId: "",
    storageRootDir: "",
    storageRenameLocked: false,
    createdAt: now,
    updatedAt: now,
  };
  app.db.projects.set(projectId, record);
}

async function setup(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "svf2-s1-e2e-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });

  const admin = await client.user.create({
    data: {
      username: "admin",
      displayName: "Admin",
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  const user = await client.user.create({
    data: {
      username: "alice",
      displayName: "Alice",
      passwordHash: await hashPassword(USER_PASSWORD),
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  const otherUser = await client.user.create({
    data: {
      username: "bob",
      displayName: "Bob",
      passwordHash: await hashPassword(OTHER_PASSWORD),
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  const migrationOwner = await client.user.create({
    data: {
      username: "migration-owner",
      displayName: "migration-owner",
      passwordHash: "!migration-owner-no-login",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const migrationProjectId = `mig-proj-${Math.random().toString(36).slice(2, 10)}`;
  await seedProject(client, migrationOwner.id, migrationProjectId);

  const app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
  mirrorProjectToMemory(app, migrationProjectId, migrationOwner.id);

  const sessionStore = new PrismaSessionStore(client);
  const server = createHttpServer(app, { sessionStore });
  const port = await listen(server);

  return {
    root, client, app, server, port,
    adminId: admin.id,
    userId: user.id,
    otherUserId: otherUser.id,
    migrationOwnerId: migrationOwner.id,
    migrationProjectId,
  };
}

function teardown(ctx: Setup): Promise<void> {
  return close(ctx.server).finally(() =>
    ctx.client.$disconnect().finally(() => {
      rmSync(ctx.root, { recursive: true, force: true });
    }),
  );
}

function baseUrl(ctx: Setup): string {
  return `http://127.0.0.1:${ctx.port}`;
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/session=([^;]+)/);
  if (!match) return null;
  return `session=${decodeURIComponent(match[1]!)}`;
}

async function login(baseUrl: string, username: string, password: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) return null;
  return extractSessionCookie(res.headers.get("set-cookie"));
}

function adminAuth(userId: string): AuthenticatedAuthContext {
  return createAuthenticatedAuthContext({
    userId,
    username: "admin",
    displayName: "Admin",
    role: "ADMIN",
    sessionId: "sess-admin",
  });
}

function userAuth(userId: string): AuthenticatedAuthContext {
  return createAuthenticatedAuthContext({
    userId,
    username: "alice",
    displayName: "Alice",
    role: "USER",
    sessionId: "sess-alice",
  });
}

describe("S1-8 端到端验收：migration owner 转换", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  describe("1. migration owner 不能登录", () => {
    it("migration owner login returns 401 auth_failed", async () => {
      ctx = await setup();
      const cookie = await login(baseUrl(ctx), "migration-owner", "any-password-12");
      expect(cookie).toBeNull();

      const res = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "migration-owner", password: "anything-here-99" }),
      });
      expect(res.status).toBe(401);
      expect((await res.json() as { error: string }).error).toBe("auth_failed");
    });

    it("migration owner passwordHash is the no-login marker", async () => {
      ctx = await setup();
      const me = await ctx.client.user.findUnique({ where: { id: ctx.migrationOwnerId } });
      expect(me?.passwordHash).toBe("!migration-owner-no-login");
      expect(isMigrationOwnerPlaintextMarker(me!.passwordHash)).toBe(true);
    });
  });

  describe("2. 真实 admin 可以登录", () => {
    it("admin login returns 200 and sets cookie", async () => {
      ctx = await setup();
      const cookie = await login(baseUrl(ctx), "admin", ADMIN_PASSWORD);
      expect(cookie).not.toBeNull();
      expect(cookie).toContain("session=");
    });
  });

  describe("3. admin 可以在管理页面看到 migration owner 标记", () => {
    it("admin user list shows isMigrationOwner=true for migration owner", async () => {
      ctx = await setup();
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/users",
        auth: adminAuth(ctx.adminId),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ username: string; isMigrationOwner: boolean }> };
      const mo = body.items.find((u) => u.username === "migration-owner");
      expect(mo?.isMigrationOwner).toBe(true);
      const realAdmin = body.items.find((u) => u.username === "admin");
      expect(realAdmin?.isMigrationOwner).toBe(false);
    });
  });

  describe("4. admin 可以查看 migration owner 拥有的项目", () => {
    it("admin project list includes migration owner's project", async () => {
      ctx = await setup();
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/projects",
        auth: adminAuth(ctx.adminId),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: Array<{ id: string; ownerId: string }> };
      const migProject = body.items.find((p) => p.id === ctx.migrationProjectId);
      expect(migProject).not.toBeUndefined();
      expect(migProject!.ownerId).toBe(ctx.migrationOwnerId);
    });
  });

  describe("5. admin 可以把 migration owner 项目转移给真实 USER", () => {
    it("transfer-owner moves project from migration owner to alice", async () => {
      ctx = await setup();
      const before = await ctx.client.project.findUnique({ where: { id: ctx.migrationProjectId } });
      expect(before?.ownerId).toBe(ctx.migrationOwnerId);

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "migration completion" },
        auth: adminAuth(ctx.adminId),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { projectId: string; ownerId: string; createdById: string };
      expect(body.ownerId).toBe(ctx.userId);
      expect(body.createdById).toBe(ctx.migrationOwnerId);

      const after = await ctx.client.project.findUnique({ where: { id: ctx.migrationProjectId } });
      expect(after?.ownerId).toBe(ctx.userId);
    });
  });

  describe("6. owner 转移写入 AuditLog", () => {
    it("transfer writes owner_transfer audit with from/to metadata", async () => {
      ctx = await setup();
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "audit check" },
        auth: adminAuth(ctx.adminId),
      });

      const audit = await ctx.client.auditLog.findFirst({
        where: { action: "owner_transfer", targetId: ctx.migrationProjectId },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(ctx.adminId);
      expect(audit?.metadataJson).toMatchObject({
        fromOwnerId: ctx.migrationOwnerId,
        toOwnerId: ctx.userId,
      });
    });
  });

  describe("7. 转移后 USER 登录后能看到该项目", () => {
    it("alice can see the transferred project via /api/projects", async () => {
      ctx = await setup();
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "alice test" },
        auth: adminAuth(ctx.adminId),
      });
      mirrorProjectToMemory(ctx.app, ctx.migrationProjectId, ctx.userId, "Migration Legacy Project");

      const cookie = await login(baseUrl(ctx), "alice", USER_PASSWORD);
      expect(cookie).not.toBeNull();

      const res = await fetch(`${baseUrl(ctx)}/api/projects`, {
        headers: cookie ? { cookie } : {},
      });
      expect(res.status).toBe(200);
      const projects = (await res.json()) as Array<{ project_id: string }>;
      const hasTransferred = projects.some((p) => p.project_id === ctx.migrationProjectId);
      expect(hasTransferred).toBe(true);
    });
  });

  describe("8. 转移后 USER 能进入项目工作区", () => {
    it("alice can GET project snapshot after transfer", async () => {
      ctx = await setup();
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "workspace test" },
        auth: adminAuth(ctx.adminId),
      });
      mirrorProjectToMemory(ctx.app, ctx.migrationProjectId, ctx.userId, "Migration Legacy Project");

      const cookie = await login(baseUrl(ctx), "alice", USER_PASSWORD);
      expect(cookie).not.toBeNull();

      const res = await fetch(`${baseUrl(ctx)}/api/projects/${ctx.migrationProjectId}`, {
        headers: cookie ? { cookie } : {},
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { project_id: string; owner_id: string };
      expect(body.project_id).toBe(ctx.migrationProjectId);
      expect(body.owner_id).toBe(ctx.userId);
    });
  });

  describe("9. 转移后其他普通用户访问该项目返回 404", () => {
    it("bob cannot access project that was transferred to alice", async () => {
      ctx = await setup();
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "isolation test" },
        auth: adminAuth(ctx.adminId),
      });
      mirrorProjectToMemory(ctx.app, ctx.migrationProjectId, ctx.userId, "Migration Legacy Project");

      const cookie = await login(baseUrl(ctx), "bob", OTHER_PASSWORD);
      expect(cookie).not.toBeNull();

      const res = await fetch(`${baseUrl(ctx)}/api/projects/${ctx.migrationProjectId}`, {
        headers: cookie ? { cookie } : {},
      });
      expect(res.status).toBe(404);
    });

    it("bob's project list does not include alice's transferred project", async () => {
      ctx = await setup();
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "list isolation" },
        auth: adminAuth(ctx.adminId),
      });
      mirrorProjectToMemory(ctx.app, ctx.migrationProjectId, ctx.userId, "Migration Legacy Project");

      const cookie = await login(baseUrl(ctx), "bob", OTHER_PASSWORD);
      expect(cookie).not.toBeNull();

      const res = await fetch(`${baseUrl(ctx)}/api/projects`, {
        headers: cookie ? { cookie } : {},
      });
      expect(res.status).toBe(200);
      const projects = (await res.json()) as Array<{ project_id: string }>;
      const hasTransferred = projects.some((p) => p.project_id === ctx.migrationProjectId);
      expect(hasTransferred).toBe(false);
    });
  });

  describe("10. 转移后其他用户访问文件路由返回 404", () => {
    it("bob cannot access alice's project artifact file", async () => {
      ctx = await setup();
      await ctx.app.inject({
        method: "POST",
        url: `/api/admin/projects/${ctx.migrationProjectId}/transfer-owner`,
        payload: { targetUserId: ctx.userId, reason: "file isolation" },
        auth: adminAuth(ctx.adminId),
      });
      mirrorProjectToMemory(ctx.app, ctx.migrationProjectId, ctx.userId, "Migration Legacy Project");

      const cookie = await login(baseUrl(ctx), "bob", OTHER_PASSWORD);
      expect(cookie).not.toBeNull();

      const res = await fetch(
        `${baseUrl(ctx)}/api/projects/${ctx.migrationProjectId}/artifacts/no-such-artifact/file`,
        { headers: cookie ? { cookie } : {} },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("11. admin 访问他人项目时后端 owner_id 正确传递", () => {
    it("admin GET project snapshot includes owner_id distinct from admin's own userId", async () => {
      ctx = await setup();
      mirrorProjectToMemory(ctx.app, ctx.migrationProjectId, ctx.migrationOwnerId, "Migration Legacy Project");

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/projects/${ctx.migrationProjectId}`,
        auth: adminAuth(ctx.adminId),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { project_id: string; owner_id: string };
      expect(body.project_id).toBe(ctx.migrationProjectId);
      expect(body.owner_id).toBe(ctx.migrationOwnerId);
      expect(body.owner_id).not.toBe(ctx.adminId);
    });
  });

  describe("12. anonymous 访问受保护路由返回 401", () => {
    it("anonymous GET /api/projects returns 401", async () => {
      ctx = await setup();
      const res = await fetch(`${baseUrl(ctx)}/api/projects`);
      expect(res.status).toBe(401);
    });

    it("anonymous GET /api/auth/me returns 401", async () => {
      ctx = await setup();
      const res = await fetch(`${baseUrl(ctx)}/api/auth/me`);
      expect(res.status).toBe(401);
    });
  });

  describe("13. USER 访问 /api/admin 被拒绝", () => {
    it("USER GET /api/admin/users returns 403", async () => {
      ctx = await setup();
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/users",
        auth: userAuth(ctx.userId),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "admin_required" });
    });

    it("USER POST /api/admin/users returns 403", async () => {
      ctx = await setup();
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/admin/users",
        payload: { username: "hack", password: "abcdefghijkl" },
        auth: userAuth(ctx.userId),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("14. session cookie 完整生命周期", () => {
    it("login → me → logout → me → 401", async () => {
      ctx = await setup();
      const base = baseUrl(ctx);
      const cookie = await login(base, "admin", ADMIN_PASSWORD);
      expect(cookie).not.toBeNull();

      const meRes1 = await fetch(`${base}/api/auth/me`, {
        headers: cookie ? { cookie } : {},
      });
      expect(meRes1.status).toBe(200);
      expect((await meRes1.json() as { user: { username: string } }).user.username).toBe("admin");

      await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
      });

      const meRes2 = await fetch(`${base}/api/auth/me`, {
        headers: cookie ? { cookie } : {},
      });
      expect(meRes2.status).toBe(401);
    });

    it("admin bootstrap followed by admin login succeeds", async () => {
      ctx = await setup();
      const cookie = await login(baseUrl(ctx), "admin", ADMIN_PASSWORD);
      expect(cookie).not.toBeNull();
      expect(cookie).toContain("session=");
    });
  });
});
