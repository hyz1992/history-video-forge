import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp, type AppInstance } from "../../../backend/src/app.js";
import { createHttpServer } from "../../../backend/src/server.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { PrismaSessionStore } from "../../../backend/src/auth/session-store.js";
import { generateSessionToken, hashSessionToken } from "../../../backend/src/auth/session-store.js";

interface Setup {
  root: string;
  client: Awaited<ReturnType<typeof createPrismaClient>>;
  app: AppInstance;
  server: Server;
  port: number;
  adminId: string;
  userId: string;
  disabledId: string;
  migrationOwnerId: string;
}

const ADMIN_PASSWORD = "a-strong-admin-password-99";
const USER_PASSWORD = "a-strong-user-password-99";

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

async function setup(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "svf2-auth-api-"));
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
  const disabled = await client.user.create({
    data: {
      username: "disabled-user",
      displayName: "Disabled",
      passwordHash: await hashPassword(USER_PASSWORD),
      role: "USER",
      status: "DISABLED",
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

  const app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
  const sessionStore = new PrismaSessionStore(client);
  const server = createHttpServer(app, { sessionStore });
  const port = await listen(server);

  return {
    root, client, app, server, port,
    adminId: admin.id,
    userId: user.id,
    disabledId: disabled.id,
    migrationOwnerId: migrationOwner.id,
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

function extractSessionToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/session=([^;]+)/);
  if (!match) return null;
  return decodeURIComponent(match[1]!);
}

describe("auth API (S1-6 prerequisite) via real HTTP", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("login with valid credentials sets cookie, returns safe user, DB stores tokenHash not token", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");

    const token = extractSessionToken(setCookie);
    expect(token).toBeTruthy();

    const body = await res.json() as { user: Record<string, unknown> };
    expect(body.user.username).toBe("alice");
    expect(body.user.role).toBe("USER");
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain(USER_PASSWORD);
    expect(bodyText).not.toContain("passwordHash");
    expect(bodyText).not.toContain(token);

    const tokenHash = hashSessionToken(token!);
    const session = await ctx.client.session.findUnique({ where: { tokenHash } });
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(ctx.userId);

    const allSessions = await ctx.client.session.findMany({ where: { userId: ctx.userId } });
    const anyStoredRawToken = allSessions.some((s) => JSON.stringify(s).includes(token!));
    expect(anyStoredRawToken).toBe(false);
  });

  it("login with wrong password returns 401 auth_failed without leaking detail", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "wrong-password-99" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("auth_failed");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("login with non-existent username returns same 401 auth_failed", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "ghost", password: "whatever-password" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("auth_failed");
  });

  it("login with DISABLED user returns 401 auth_failed", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "disabled-user", password: USER_PASSWORD }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("auth_failed");
  });

  it("login with migration-owner marker cannot login (auth_failed)", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "migration-owner", password: "anything-here-99" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("auth_failed");
  });

  it("GET /api/auth/me without cookie returns 401 unauthorized", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/me`);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string; anonymous?: boolean };
    expect(body.error).toBe("unauthorized");
    expect(body.anonymous).toBe(true);
  });

  it("GET /api/auth/me with valid cookie returns authenticated safe user", async () => {
    ctx = await setup();
    const loginRes = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD }),
    });
    const setCookie = loginRes.headers.get("set-cookie")!;
    const cookie = setCookie.split(";")[0]!;

    const meRes = await fetch(`${baseUrl(ctx)}/api/auth/me`, {
      headers: { cookie },
    });
    expect(meRes.status).toBe(200);
    const body = await meRes.json() as { user: Record<string, unknown> };
    expect(body.user.username).toBe("admin");
    expect(body.user.role).toBe("ADMIN");
    expect(body.user.status).toBe("ACTIVE");
    expect(body.user.mustChangePassword).toBe(false);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("passwordHash");
  });

  it("logout revokes current session, clears cookie, and me becomes unauthenticated", async () => {
    ctx = await setup();
    const loginRes = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: USER_PASSWORD }),
    });
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;
    const token = extractSessionToken(loginRes.headers.get("set-cookie"))!;

    const logoutRes = await fetch(`${baseUrl(ctx)}/api/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    expect(logoutRes.status).toBe(200);
    const logoutSetCookie = logoutRes.headers.get("set-cookie")!;
    expect(logoutSetCookie).toContain("session=;");
    expect(logoutSetCookie).toContain("Max-Age=0");

    const tokenHash = hashSessionToken(token);
    const session = await ctx.client.session.findUnique({ where: { tokenHash } });
    expect(session?.revokedAt).not.toBeNull();

    const meRes = await fetch(`${baseUrl(ctx)}/api/auth/me`, {
      headers: { cookie },
    });
    expect(meRes.status).toBe(401);
  });

  it("logout without cookie (anonymous) returns 200 idempotently with clear cookie", async () => {
    ctx = await setup();
    const res = await fetch(`${baseUrl(ctx)}/api/auth/logout`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { anonymous?: boolean };
    expect(body.anonymous).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("session resolves through real auth middleware after login (DB-backed session works end to end)", async () => {
    ctx = await setup();
    const loginRes = await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: USER_PASSWORD }),
    });
    const cookie = loginRes.headers.get("set-cookie")!.split(";")[0]!;

    const meRes = await fetch(`${baseUrl(ctx)}/api/auth/me`, { headers: { cookie } });
    expect(meRes.status).toBe(200);
    expect((await meRes.json() as { user: { username: string } }).user.username).toBe("alice");
  });

  it("login updates lastLoginAt", async () => {
    ctx = await setup();
    const before = await ctx.client.user.findUnique({ where: { id: ctx.userId } });
    expect(before?.lastLoginAt).toBeNull();
    await fetch(`${baseUrl(ctx)}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: USER_PASSWORD }),
    });
    const after = await ctx.client.user.findUnique({ where: { id: ctx.userId } });
    expect(after?.lastLoginAt).not.toBeNull();
  });

  it("a revoked/expired session token is rejected at me", async () => {
    ctx = await setup();
    const expiredToken = generateSessionToken();
    await ctx.client.session.create({
      data: {
        userId: ctx.userId,
        tokenHash: hashSessionToken(expiredToken),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const meRes = await fetch(`${baseUrl(ctx)}/api/auth/me`, {
      headers: { cookie: `session=${expiredToken}` },
    });
    expect(meRes.status).toBe(401);
  });
});
