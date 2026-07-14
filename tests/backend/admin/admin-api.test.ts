import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
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
