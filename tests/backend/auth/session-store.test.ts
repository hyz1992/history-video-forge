import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import {
  PrismaSessionStore,
  generateSessionToken,
  hashSessionToken,
} from "../../../backend/src/auth/session-store.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";

interface TestContext {
  root: string;
  client: Awaited<ReturnType<typeof createPrismaClient>>;
  store: PrismaSessionStore;
  userId: string;
  fixedNow: Date;
}

async function setupStore(overrides: { userStatus?: string; userRole?: string; now?: Date } = {}): Promise<TestContext> {
  const root = mkdtempSync(join(tmpdir(), "svf2-auth-session-"));
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
      role: overrides.userRole ?? "USER",
      status: overrides.userStatus ?? "ACTIVE",
    },
  });

  const fixedNow = overrides.now ?? new Date("2026-07-13T00:00:00Z");
  const store = new PrismaSessionStore(client, { now: () => fixedNow });

  return { root, client, store, userId: user.id, fixedNow };
}

function teardown(ctx: TestContext): Promise<void> {
  return ctx.client.$disconnect().finally(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });
}

describe("PrismaSessionStore", () => {
  let ctx: TestContext;

  afterEach(async () => {
    if (ctx) await teardown(ctx);
  });

  it("creates a session with a hashed token and persists tokenHash (not the token)", async () => {
    ctx = await setupStore();
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
    });

    expect(created.sessionId).toBeTruthy();
    expect(created.token).toBeTruthy();
    expect(created.tokenHash).toBe(hashSessionToken(created.token));
    expect(created.tokenHash).not.toBe(created.token);

    const stored = await ctx.client.session.findUnique({ where: { id: created.sessionId } });
    expect(stored?.tokenHash).toBe(created.tokenHash);
    expect(stored?.tokenHash).not.toContain(created.token);
    expect(stored?.revokedAt).toBeNull();
    expect(stored?.userId).toBe(ctx.userId);
  });

  it("resolves a valid token into an authenticated AuthContext", async () => {
    ctx = await setupStore();
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
    });

    const resolved = await ctx.store.resolveSession(created.token);
    expect(resolved.ok).toBe(true);
    expect(resolved.context?.anonymous).toBe(false);
    expect(resolved.context?.userId).toBe(ctx.userId);
    expect(resolved.context?.username).toBe("alice");
    expect(resolved.context?.role).toBe("USER");
    expect(resolved.context?.sessionId).toBe(created.sessionId);
  });

  it("returns no_session_token when the token is empty", async () => {
    ctx = await setupStore();
    const resolved = await ctx.store.resolveSession("");
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe("no_session_token");
  });

  it("returns session_not_found for an unknown token", async () => {
    ctx = await setupStore();
    const resolved = await ctx.store.resolveSession(generateSessionToken());
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe("session_not_found");
  });

  it("returns session_expired when expiresAt is in the past", async () => {
    ctx = await setupStore({ now: new Date("2026-07-13T00:00:00Z") });
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
      ttlMs: 1000,
    });

    const laterStore = new PrismaSessionStore(ctx.client, { now: () => new Date("2026-07-20T00:00:00Z") });
    const resolved = await laterStore.resolveSession(created.token);
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe("session_expired");
    expect(resolved.sessionId).toBe(created.sessionId);
  });

  it("returns session_revoked after the session is revoked", async () => {
    ctx = await setupStore();
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
    });

    await ctx.store.revokeSession(created.sessionId);

    const resolved = await ctx.store.resolveSession(created.token);
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe("session_revoked");
    expect(resolved.sessionId).toBe(created.sessionId);
  });

  it("returns user_disabled when user.status is DISABLED", async () => {
    ctx = await setupStore({ userStatus: "DISABLED" });
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
    });

    const resolved = await ctx.store.resolveSession(created.token);
    expect(resolved.ok).toBe(false);
    expect(resolved.reason).toBe("user_disabled");
  });

  it("revokes all active sessions for a user via revokeSessionsByUser", async () => {
    ctx = await setupStore();
    const a = await ctx.store.createSession({
      userId: ctx.userId, username: "alice", displayName: "Alice", role: "USER",
    });
    const b = await ctx.store.createSession({
      userId: ctx.userId, username: "alice", displayName: "Alice", role: "USER",
    });

    const count = await ctx.store.revokeSessionsByUser(ctx.userId);
    expect(count).toBe(2);

    await expect(ctx.store.resolveSession(a.token)).resolves.toMatchObject({ ok: false, reason: "session_revoked" });
    await expect(ctx.store.resolveSession(b.token)).resolves.toMatchObject({ ok: false, reason: "session_revoked" });
  });

  it("renewSession extends expiresAt and unblocks an about-to-expire session", async () => {
    ctx = await setupStore({ now: new Date("2026-07-13T00:00:00Z") });
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
      ttlMs: 60_000,
    });

    const renewedExpiry = await ctx.store.renewSession(created.sessionId, 7 * 24 * 60 * 60 * 1000);
    expect(renewedExpiry.getTime()).toBeGreaterThan(ctx.fixedNow.getTime());

    const futureStore = new PrismaSessionStore(ctx.client, { now: () => new Date("2026-07-14T00:00:00Z") });
    const resolved = await futureStore.resolveSession(created.token);
    expect(resolved.ok).toBe(true);
  });

  it("persists lastSeenAt on resolve via touchSession", async () => {
    ctx = await setupStore({ now: new Date("2026-07-13T00:00:00Z") });
    const created = await ctx.store.createSession({
      userId: ctx.userId,
      username: "alice",
      displayName: "Alice",
      role: "USER",
    });

    const later = new Date("2026-07-13T05:00:00Z");
    const laterStore = new PrismaSessionStore(ctx.client, { now: () => later });
    await laterStore.resolveSession(created.token);

    const stored = await ctx.client.session.findUnique({ where: { id: created.sessionId } });
    expect(stored?.lastSeenAt?.toISOString()).toBe(later.toISOString());
  });
});
