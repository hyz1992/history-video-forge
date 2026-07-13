import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, afterEach } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { PrismaSessionStore } from "../../../backend/src/auth/session-store.js";
import {
  applyAuthMiddleware,
  extractSessionTokenFromSource,
} from "../../../backend/src/auth/auth-middleware.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import type { IncomingMessage } from "node:http";

interface Setup {
  root: string;
  client: Awaited<ReturnType<typeof createPrismaClient>>;
  store: PrismaSessionStore;
  userId: string;
  app: ReturnType<typeof buildApp>;
}

async function setup(): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "svf2-auth-mw-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();

  const client = await createPrismaClient(dbPath);
  const passwordHash = await hashPassword("a-strong-password-1");
  const user = await client.user.create({
    data: {
      id: "user-1",
      username: "alice",
      displayName: "Alice",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
  });

  const store = new PrismaSessionStore(client);
  const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });

  return { root, client, store, userId: user.id, app };
}

function teardown(ctx: Setup): Promise<void> {
  return ctx.client.$disconnect().finally(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });
}

function mockRequest(cookieHeader?: string): IncomingMessage {
  return { headers: cookieHeader ? { cookie: cookieHeader } : {} } as unknown as IncomingMessage;
}

describe("applyAuthMiddleware", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("produces an anonymous AuthContext when no cookie is present", async () => {
    ctx = await setup();
    const { auth } = await applyAuthMiddleware({ sessionStore: ctx.store }, mockRequest(undefined));
    expect(auth.anonymous).toBe(true);
    expect(auth.reason ?? "no_session_token").toBeTruthy();
  });

  it("produces an anonymous AuthContext when the cookie is missing the session value", async () => {
    ctx = await setup();
    const { auth } = await applyAuthMiddleware({ sessionStore: ctx.store }, mockRequest("theme=dark"));
    expect(auth.anonymous).toBe(true);
  });

  it("produces an authenticated AuthContext when a valid session cookie is present", async () => {
    ctx = await setup();
    const created = await ctx.store.createSession({
      userId: ctx.userId, username: "alice", displayName: "Alice", role: "USER",
    });
    const request = mockRequest(`session=${created.token}`);
    const { auth } = await applyAuthMiddleware({ sessionStore: ctx.store }, request);
    expect(auth.anonymous).toBe(false);
    if (!auth.anonymous) {
      expect(auth.userId).toBe(ctx.userId);
      expect(auth.sessionId).toBe(created.sessionId);
    }
  });

  it("produces an anonymous AuthContext when the cookie holds an invalid token", async () => {
    ctx = await setup();
    const request = mockRequest("session=not-a-real-token");
    const { auth } = await applyAuthMiddleware({ sessionStore: ctx.store }, request);
    expect(auth.anonymous).toBe(true);
  });
});

describe("extractSessionTokenFromSource", () => {
  it("returns the token when provided", () => {
    expect(extractSessionTokenFromSource({ token: "abc" })).toBe("abc");
  });

  it("returns undefined for empty token", () => {
    expect(extractSessionTokenFromSource({ token: "" })).toBeUndefined();
  });

  it("returns undefined when source is undefined", () => {
    expect(extractSessionTokenFromSource(undefined)).toBeUndefined();
  });
});

describe("app.inject auth propagation", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("defaults to anonymous auth when inject is called without auth", async () => {
    ctx = await setup();
    ctx.app.addRoute("GET", "/__auth_probe", (context) => ({
      statusCode: 200,
      body: { anonymous: context.auth.anonymous },
    }));

    const response = await ctx.app.inject({ method: "GET", url: "/__auth_probe" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ anonymous: true });
  });

  it("propagates an injected authenticated AuthContext to the handler", async () => {
    ctx = await setup();
    ctx.app.addRoute("GET", "/__auth_probe", (context) => ({
      statusCode: 200,
      body: {
        anonymous: context.auth.anonymous,
        userId: context.auth.anonymous ? null : context.auth.userId,
        role: context.auth.anonymous ? null : context.auth.role,
      },
    }));

    const auth = createAuthenticatedAuthContext({
      userId: ctx.userId, username: "alice", displayName: "Alice", role: "USER", sessionId: "s-1",
    });
    const response = await ctx.app.inject({ method: "GET", url: "/__auth_probe", auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ anonymous: false, userId: ctx.userId, role: "USER" });
  });
});
