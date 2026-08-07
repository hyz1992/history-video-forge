import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import type { ProjectRecord } from "../../../backend/src/db/client.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

interface Setup {
  root: string;
  client: Awaited<ReturnType<typeof createPrismaClient>>;
  app: AppInstance;
  adminId: string;
  userId: string;
  projectId: string;
}

async function seedProject(client: Awaited<ReturnType<typeof createPrismaClient>>, ownerId: string): Promise<string> {
  const projectId = `proj-${Math.random().toString(36).slice(2, 10)}`;
  await client.project.create({
    data: {
      id: projectId,
      ownerId,
      createdById: ownerId,
      name: "Admin View Project",
      status: "topic_pending",
      storageKey: `storage-${projectId}`,
      storageDisplayName: "Admin View Project",
    },
  });
  return projectId;
}

function mirrorProjectToMemory(app: AppInstance, projectId: string, ownerId: string): void {
  const now = new Date();
  const record: ProjectRecord = {
    id: projectId,
    name: "Admin View Project",
    ownerId,
    createdById: ownerId,
    status: "topic_pending",
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
  const root = mkdtempSync(join(tmpdir(), "svf2-admin-api-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(dbPath);
  await activateDatabase(client, { mode: "fresh" });

  const adminPasswordHash = await hashPassword("a-strong-admin-password-99");
  const admin = await client.user.create({
    data: {
      username: "admin",
      displayName: "Admin",
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  const userPasswordHash = await hashPassword("a-strong-user-password-99");
  const user = await client.user.create({
    data: {
      username: "alice",
      displayName: "Alice",
      passwordHash: userPasswordHash,
      role: "USER",
      status: "ACTIVE",
      mustChangePassword: false,
    },
  });
  const projectId = await seedProject(client, user.id);

  await client.auditLog.create({
    data: {
      actorUserId: admin.id,
      projectId,
      action: "admin_bootstrap",
      targetType: "User",
      targetId: admin.id,
      metadataJson: { source: "test" },
    },
  });
  await client.auditLog.create({
    data: {
      actorUserId: null,
      action: "owner_transfer",
      targetType: "Project",
      targetId: projectId,
      metadataJson: { from: "old", to: "new" },
    },
  });

  const app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
  return { root, client, app, adminId: admin.id, userId: user.id, projectId };
}

function teardown(ctx: Setup): Promise<void> {
  return ctx.client.$disconnect().finally(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });
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
    sessionId: "sess-user",
  });
}

describe("admin API (S1-5a read-only)", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("GET /api/admin/users as admin returns all users without passwordHash", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users",
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(item).not.toHaveProperty("passwordHash");
    }
    const usernames = body.items.map((u) => u.username).sort();
    expect(usernames).toEqual(["admin", "alice"]);
  });

  it("GET /api/admin/users as USER returns 403 admin_required", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users",
      auth: userAuth(ctx.userId),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "admin_required" });
  });

  it("GET /api/admin/users without auth returns 401 unauthorized", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "unauthorized" });
  });

  it("GET /api/admin/projects as admin returns all projects across users", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/projects",
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ id: string; ownerId: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(ctx.projectId);
    expect(body.items[0]!.ownerId).toBe(ctx.userId);
  });

  it("GET /api/admin/projects as USER returns 403", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/projects",
      auth: userAuth(ctx.userId),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/admin/audit-logs/query as admin returns filtered audit logs", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/audit-logs/query",
      payload: { action: "owner_transfer" },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ action: string; targetType: string }>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.action).toBe("owner_transfer");
    expect(body.items[0]!.targetType).toBe("Project");
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
  });

  it("POST /api/admin/audit-logs/query filters by actorUserId", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/audit-logs/query",
      payload: { actorUserId: ctx.adminId },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ actorUserId: string | null }>; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.actorUserId).toBe(ctx.adminId);
    expect(body.total).toBe(1);
  });

  it("POST /api/admin/audit-logs/query returns all logs when no filter", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/audit-logs/query",
      payload: {},
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number };
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
  });

  it("POST /api/admin/audit-logs/query as USER returns 403", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/audit-logs/query",
      payload: {},
      auth: userAuth(ctx.userId),
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin user summary marks migration owner correctly", async () => {
    ctx = await setup();
    await ctx.client.user.create({
      data: {
        username: "migration-owner",
        displayName: "migration-owner",
        passwordHash: "!migration-owner-no-login",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users",
      auth: adminAuth(ctx.adminId),
    });
    const body = res.json() as { items: Array<{ username: string; isMigrationOwner: boolean }> };
    const migrationOwner = body.items.find((u) => u.username === "migration-owner");
    expect(migrationOwner?.isMigrationOwner).toBe(true);
    const realAdmin = body.items.find((u) => u.username === "admin");
    expect(realAdmin?.isMigrationOwner).toBe(false);
  });

  it("GET /api/admin/users returns pagination metadata (total/limit/offset)", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users?limit=1&offset=0",
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: unknown[]; total: number; limit: number; offset: number };
    expect(body.total).toBe(2);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(1);
  });

  it("GET /api/admin/users?search=ali filters by username/displayName", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users?search=ali",
      auth: adminAuth(ctx.adminId),
    });
    const body = res.json() as { items: Array<{ username: string }>; total: number };
    expect(body.items.every((u) => u.username === "alice")).toBe(true);
    expect(body.total).toBe(1);
  });

  it("GET /api/admin/users?role=USER filters by role", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/users?role=USER",
      auth: adminAuth(ctx.adminId),
    });
    const body = res.json() as { items: Array<{ role: string }>; total: number };
    expect(body.items.every((u) => u.role === "USER")).toBe(true);
    expect(body.total).toBe(1);
  });

  it("GET /api/admin/projects returns ownerUsername and ownerDisplayName", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/projects",
      auth: adminAuth(ctx.adminId),
    });
    const body = res.json() as {
      items: Array<{ ownerId: string; ownerUsername: string; ownerDisplayName: string }>;
    };
    expect(body.items[0]!.ownerId).toBe(ctx.userId);
    expect(body.items[0]!.ownerUsername).toBe("alice");
    expect(body.items[0]!.ownerDisplayName).toBe("Alice");
  });

  it("GET /api/admin/projects?owner_id=<uid> filters by owner", async () => {
    ctx = await setup();
    const otherProjectId = await seedProject(ctx.client, ctx.adminId);
    mirrorProjectToMemory(ctx.app, otherProjectId, ctx.adminId);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/projects?owner_id=${ctx.userId}`,
      auth: adminAuth(ctx.adminId),
    });
    const body = res.json() as { items: Array<{ ownerId: string }>; total: number };
    expect(body.items.every((p) => p.ownerId === ctx.userId)).toBe(true);
    expect(body.total).toBe(1);
  });

  it("GET /api/admin/projects?search=Admin filters by project name", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/projects?search=Admin",
      auth: adminAuth(ctx.adminId),
    });
    const body = res.json() as { items: Array<{ name: string }>; total: number };
    expect(body.items.every((p) => p.name.includes("Admin"))).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });
});

describe("admin API without prismaClient", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("returns 503 admin_store_unavailable when prismaClient is not injected", async () => {
    ctx = await setup();
    const appWithoutPrisma = buildApp({ skipSnapshotLoad: true });
    const res = await appWithoutPrisma.inject({
      method: "GET",
      url: "/api/admin/users",
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "admin_store_unavailable" });
  });
});

const STRONG_PASSWORD = "a-strong-create-password-99";

describe("admin API (S1-5b write operations)", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("POST /api/admin/users as admin creates a user and writes user_create audit", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: {
        username: "bob",
        displayName: "Bob",
        password: STRONG_PASSWORD,
        role: "USER",
      },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: { id: string; username: string; role: string } };
    expect(body.user.username).toBe("bob");
    expect(body.user.role).toBe("USER");

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "user_create", targetId: body.user.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(ctx.adminId);
    expect(audit?.targetType).toBe("User");
  });

  it("POST /api/admin/users response never leaks password or passwordHash", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { username: "carol", password: STRONG_PASSWORD },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(201);
    const bodyText = JSON.stringify(res.json());
    expect(bodyText).not.toContain(STRONG_PASSWORD);
    expect(bodyText).not.toContain("passwordHash");
    expect(bodyText).not.toContain("$argon2");

    const created = await ctx.client.user.findUnique({ where: { username: "carol" } });
    expect(created?.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("POST /api/admin/users as USER returns 403", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { username: "bob", password: STRONG_PASSWORD },
      auth: userAuth(ctx.userId),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "admin_required" });
  });

  it("POST /api/admin/users without auth returns 401", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { username: "bob", password: STRONG_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/admin/users with duplicate username returns 409 username_taken (no 500)", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { username: "alice", password: STRONG_PASSWORD },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "username_taken" });
  });

  it("POST /api/admin/users with short password returns 400 password_too_short", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users",
      payload: { username: "short", password: "short" },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "password_too_short:12" });
  });

  it("disable a regular USER succeeds and revokes their sessions + writes user_disable audit", async () => {
    ctx = await setup();
    await ctx.client.session.create({
      data: {
        userId: ctx.userId,
        tokenHash: "hash-user-active-1",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${ctx.userId}/disable`,
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: ctx.userId, status: "DISABLED" });

    const user = await ctx.client.user.findUnique({ where: { id: ctx.userId } });
    expect(user?.status).toBe("DISABLED");

    const sessions = await ctx.client.session.findMany({ where: { userId: ctx.userId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "user_disable", targetId: ctx.userId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBe(ctx.adminId);
  });

  it("disable the last ACTIVE ADMIN is rejected with cannot_disable_last_admin", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${ctx.adminId}/disable`,
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "cannot_disable_last_admin" });

    const admin = await ctx.client.user.findUnique({ where: { id: ctx.adminId } });
    expect(admin?.status).toBe("ACTIVE");

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "user_disable", targetId: ctx.adminId },
    });
    expect(audit).toBeNull();
  });

  it("disable a second ADMIN succeeds when another ACTIVE ADMIN remains", async () => {
    ctx = await setup();
    const secondAdmin = await ctx.client.user.create({
      data: {
        username: "admin2",
        displayName: "Admin2",
        passwordHash: await hashPassword(STRONG_PASSWORD),
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: false,
      },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${secondAdmin.id}/disable`,
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
  });

  it("enable a DISABLED user writes user_enable audit", async () => {
    ctx = await setup();
    await ctx.client.user.update({ where: { id: ctx.userId }, data: { status: "DISABLED" } });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${ctx.userId}/enable`,
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: ctx.userId, status: "ACTIVE" });

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "user_enable", targetId: ctx.userId },
    });
    expect(audit?.actorUserId).toBe(ctx.adminId);
  });

  it("reset-password sets mustChangePassword=true, revokes sessions, writes audit, never returns hash", async () => {
    ctx = await setup();
    await ctx.client.session.create({
      data: {
        userId: ctx.userId,
        tokenHash: "hash-user-active-2",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${ctx.userId}/reset-password`,
      payload: { password: "a-brand-new-password-99" },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const bodyText = JSON.stringify(res.json());
    expect(bodyText).not.toContain("a-brand-new-password-99");
    expect(bodyText).not.toContain("passwordHash");

    const user = await ctx.client.user.findUnique({ where: { id: ctx.userId } });
    expect(user?.mustChangePassword).toBe(true);
    expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true);

    const sessions = await ctx.client.session.findMany({ where: { userId: ctx.userId } });
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "user_password_reset", targetId: ctx.userId },
    });
    expect(audit?.actorUserId).toBe(ctx.adminId);
  });

  it("revoke sessions returns revokedCount and writes session_revoke audit with count", async () => {
    ctx = await setup();
    await ctx.client.session.create({
      data: {
        userId: ctx.userId,
        tokenHash: "hash-rev-1",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await ctx.client.session.create({
      data: {
        userId: ctx.userId,
        tokenHash: "hash-rev-2",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/users/${ctx.userId}/sessions/revoke`,
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: ctx.userId, revokedCount: 2 });

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "session_revoke", targetId: ctx.userId },
    });
    expect(audit?.metadataJson).toMatchObject({ revokedCount: 2 });
  });

  it("revoke sessions on non-existent user returns 404 user_not_found", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/admin/users/no-such-user/sessions/revoke",
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "user_not_found" });
  });

  it("transfer-owner updates ownerId (not createdById), writes owner_transfer audit, and syncs memory state so the access matrix flips immediately", async () => {
    ctx = await setup();
    mirrorProjectToMemory(ctx.app, ctx.projectId, ctx.userId);

    const before = await ctx.client.project.findUnique({ where: { id: ctx.projectId } });
    expect(ctx.app.db.projects.get(ctx.projectId)?.ownerId).toBe(ctx.userId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/projects/${ctx.projectId}/transfer-owner`,
      payload: { targetUserId: ctx.adminId, reason: "handoff" },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projectId: string; ownerId: string; createdById: string };
    expect(body.ownerId).toBe(ctx.adminId);
    expect(body.createdById).toBe(before!.createdById);

    const after = await ctx.client.project.findUnique({ where: { id: ctx.projectId } });
    expect(after?.ownerId).toBe(ctx.adminId);
    expect(after?.createdById).toBe(before!.createdById);

    expect(ctx.app.db.projects.get(ctx.projectId)?.ownerId).toBe(ctx.adminId);

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "owner_transfer", targetId: ctx.projectId, actorUserId: ctx.adminId },
    });
    expect(audit?.actorUserId).toBe(ctx.adminId);
    expect(audit?.metadataJson).toMatchObject({
      fromOwnerId: ctx.userId,
      toOwnerId: ctx.adminId,
      reason: "handoff",
    });

    const oldOwnerAccess = await ctx.app.inject({
      method: "GET",
      url: `/api/projects/${ctx.projectId}`,
      auth: userAuth(ctx.userId),
    });
    expect(oldOwnerAccess.statusCode).toBe(404);

    const newOwnerAccess = await ctx.app.inject({
      method: "GET",
      url: `/api/projects/${ctx.projectId}`,
      auth: adminAuth(ctx.adminId),
    });
    expect(newOwnerAccess.statusCode).toBe(200);

    const adminAccess = await ctx.app.inject({
      method: "GET",
      url: `/api/projects/${ctx.projectId}`,
      auth: adminAuth(ctx.adminId),
    });
    expect(adminAccess.statusCode).toBe(200);
  });

  it("transfer-owner to a DISABLED user is rejected with target_user_not_active", async () => {
    ctx = await setup();
    await ctx.client.user.update({ where: { id: ctx.userId }, data: { status: "DISABLED" } });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/projects/${ctx.projectId}/transfer-owner`,
      payload: { targetUserId: ctx.userId },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "target_user_not_active" });

    const project = await ctx.client.project.findUnique({ where: { id: ctx.projectId } });
    expect(project?.ownerId).toBe(ctx.userId);
  });

  it("transfer-owner to non-existent target returns 404 target_user_not_found", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/projects/${ctx.projectId}/transfer-owner`,
      payload: { targetUserId: "no-such-user" },
      auth: adminAuth(ctx.adminId),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: "target_user_not_found" });
  });

  it("transfer-owner as USER returns 403", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/projects/${ctx.projectId}/transfer-owner`,
      payload: { targetUserId: ctx.adminId },
      auth: userAuth(ctx.userId),
    });
    expect(res.statusCode).toBe(403);
  });

  it("disable/enable/reset/revoke on non-existent user returns 404 user_not_found", async () => {
    ctx = await setup();
    const cases = [
      { url: "/api/admin/users/no-user/disable" },
      { url: "/api/admin/users/no-user/enable" },
      { url: "/api/admin/users/no-user/reset-password", payload: { password: STRONG_PASSWORD } },
    ];
    for (const c of cases) {
      const res = await ctx.app.inject({
        method: "POST",
        url: c.url,
        payload: c.payload ?? {},
        auth: adminAuth(ctx.adminId),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "user_not_found" });
    }
  });

  it("revoke sessions is atomic: if audit write fails (FK violation on actor), sessions are NOT revoked and no half-state remains", async () => {
    ctx = await setup();
    await ctx.client.session.create({
      data: {
        userId: ctx.userId,
        tokenHash: "hash-atomic-1",
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const { adminRevokeUserSessions } = await import("../../../backend/src/modules/admin/admin.service.js");

    await expect(
      adminRevokeUserSessions(ctx.client, { userId: "non-existent-actor-for-fk-failure" }, ctx.userId),
    ).rejects.toThrow();

    const sessions = await ctx.client.session.findMany({ where: { userId: ctx.userId } });
    expect(sessions.every((s) => s.revokedAt === null)).toBe(true);

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: "session_revoke", targetId: ctx.userId },
    });
    expect(audit).toBeNull();
  });
});
