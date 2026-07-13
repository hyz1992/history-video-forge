import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, afterEach } from "vitest";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { activateDatabase } from "../../../backend/src/db/database-activation.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import {
  AdminBootstrapError,
  ADMIN_BOOTSTRAP_AUDIT_ACTION,
  bootstrapAdmin,
} from "../../../backend/src/auth/admin-bootstrap.js";
import { hashPassword, verifyPassword } from "../../../backend/src/auth/password-hash.js";

interface SetupOptions {
  withMigrationOwner?: boolean;
  activated?: boolean;
}

interface Setup {
  root: string;
  client: Awaited<ReturnType<typeof createPrismaClient>>;
  dbPath: string;
}

async function setup(options: SetupOptions = {}): Promise<Setup> {
  const root = mkdtempSync(join(tmpdir(), "svf2-admin-bootstrap-"));
  const dbPath = join(root, "test.db");
  const sqlite = new Database(dbPath);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(dbPath);
  if (options.withMigrationOwner) {
    await client.user.create({
      data: {
        id: "migration-owner",
        username: "migration-owner",
        displayName: "migration-owner",
        passwordHash: "!migration-owner-no-login",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
  }
  if (options.activated) {
    await activateDatabase(client, { mode: "fresh" });
  }
  return { root, client, dbPath };
}

function teardown(ctx: Setup): Promise<void> {
  return ctx.client.$disconnect().finally(() => {
    rmSync(ctx.root, { recursive: true, force: true });
  });
}

const STRONG_PASSWORD = "a-strong-bootstrap-password-99";

describe("bootstrapAdmin", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("creates the first admin user with role=ADMIN, status=ACTIVE, mustChangePassword=false", async () => {
    ctx = await setup({ activated: true });
    const result = await bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD });

    expect(result.status).toBe("admin_created");
    expect(result.username).toBe("admin");
    expect(result.userId).toBeTruthy();

    const user = await ctx.client.user.findUnique({ where: { id: result.userId } });
    expect(user?.role).toBe("ADMIN");
    expect(user?.status).toBe("ACTIVE");
    expect(user?.mustChangePassword).toBe(false);
    expect(user?.displayName).toBe("admin");
  });

  it("stores an argon2id hash, never the plaintext password", async () => {
    ctx = await setup({ activated: true });
    const result = await bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD });

    const user = await ctx.client.user.findUnique({ where: { id: result.userId } });
    expect(user?.passwordHash).not.toBe(STRONG_PASSWORD);
    expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user?.passwordHash.length).toBeGreaterThan(40);

    await expect(verifyPassword(user!.passwordHash, STRONG_PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword(user!.passwordHash, "wrong-password-99")).resolves.toBe(false);
  });

  it("writes an AuditLog entry with action=admin_bootstrap and actorUserId=null", async () => {
    ctx = await setup({ activated: true });
    const result = await bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD });

    const audit = await ctx.client.auditLog.findFirst({
      where: { action: ADMIN_BOOTSTRAP_AUDIT_ACTION, targetId: result.userId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorUserId).toBeNull();
    expect(audit?.targetType).toBe("User");
    expect(audit?.targetId).toBe(result.userId);
  });

  it("refuses to create a second admin when an ACTIVE ADMIN already exists", async () => {
    ctx = await setup({ activated: true });
    await bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD });

    await expect(
      bootstrapAdmin(ctx.client, { username: "second", password: STRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "admin_already_exists" });
  });

  it("allows creating a second admin only when the existing one is DISABLED", async () => {
    ctx = await setup({ activated: true });
    const first = await bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD });
    await ctx.client.user.update({ where: { id: first.userId }, data: { status: "DISABLED" } });

    const second = await bootstrapAdmin(ctx.client, { username: "next", password: STRONG_PASSWORD });
    expect(second.username).toBe("next");
  });

  it("rejects a password shorter than the minimum length", async () => {
    ctx = await setup({ activated: true });
    await expect(
      bootstrapAdmin(ctx.client, { username: "admin", password: "short" }),
    ).rejects.toMatchObject({ code: "password_too_short:12" });
  });

  it("rejects an empty username", async () => {
    ctx = await setup({ activated: true });
    await expect(
      bootstrapAdmin(ctx.client, { username: "   ", password: STRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "username_required" });
  });

  it("rejects a username with invalid characters", async () => {
    ctx = await setup({ activated: true });
    await expect(
      bootstrapAdmin(ctx.client, { username: "bad name!", password: STRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "username_invalid_characters" });
  });

  it("returns username_taken when the username is already in use", async () => {
    ctx = await setup({ activated: true });
    const passwordHash = await hashPassword(STRONG_PASSWORD);
    await ctx.client.user.create({
      data: {
        username: "admin",
        displayName: "admin",
        passwordHash,
        role: "USER",
        status: "ACTIVE",
      },
    });

    await expect(
      bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "username_taken" });
  });

  it("uses the provided displayName when given", async () => {
    ctx = await setup({ activated: true });
    const result = await bootstrapAdmin(ctx.client, {
      username: "admin",
      password: STRONG_PASSWORD,
      displayName: "Alice Admin",
    });
    const user = await ctx.client.user.findUnique({ where: { id: result.userId } });
    expect(user?.displayName).toBe("Alice Admin");
  });

  it("exposes a stable audit action constant", () => {
    expect(ADMIN_BOOTSTRAP_AUDIT_ACTION).toBe("admin_bootstrap");
  });

  it("AdminBootstrapError is a typed error with a code property", () => {
    const error = new AdminBootstrapError("some_code", "some message");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("some_code");
    expect(error.name).toBe("AdminBootstrapError");
  });

  it("does NOT block bootstrap when only the migration owner (no-login marker) exists", async () => {
    ctx = await setup({ withMigrationOwner: true, activated: true });
    const result = await bootstrapAdmin(ctx.client, { username: "realadmin", password: STRONG_PASSWORD });
    expect(result.status).toBe("admin_created");

    const realAdmin = await ctx.client.user.findUnique({ where: { id: result.userId } });
    expect(realAdmin?.role).toBe("ADMIN");
    expect(realAdmin?.status).toBe("ACTIVE");
    expect(realAdmin?.passwordHash).not.toBe("!migration-owner-no-login");

    const admins = await ctx.client.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" } });
    expect(admins).toHaveLength(2);
    const realAdmins = admins.filter((u) => u.passwordHash !== "!migration-owner-no-login");
    expect(realAdmins).toHaveLength(1);
  });

  it("still reports admin_already_exists when a real ACTIVE ADMIN exists alongside a migration owner", async () => {
    ctx = await setup({ withMigrationOwner: true, activated: true });
    await bootstrapAdmin(ctx.client, { username: "realadmin", password: STRONG_PASSWORD });

    await expect(
      bootstrapAdmin(ctx.client, { username: "second", password: STRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "admin_already_exists" });
  });

  it("rejects bootstrap when the database is not activated (default behavior)", async () => {
    ctx = await setup({ activated: false });
    await expect(
      bootstrapAdmin(ctx.client, { username: "admin", password: STRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "database_not_activated" });

    const count = await ctx.client.user.count();
    expect(count).toBe(0);
  });

  it("allows skipping the activation check via options for tooling/test scenarios", async () => {
    ctx = await setup({ activated: false });
    const result = await bootstrapAdmin(
      ctx.client,
      { username: "admin", password: STRONG_PASSWORD },
      { requireDatabaseActivation: false },
    );
    expect(result.status).toBe("admin_created");
  });
});

describe("bootstrapAdmin concurrency", () => {
  let ctx: Setup;
  afterEach(async () => { if (ctx) await teardown(ctx); });

  it("only one of two concurrent bootstraps on separate clients succeeds; the other gets admin_already_exists", async () => {
    ctx = await setup({ activated: true });
    const secondClient = await createPrismaClient(ctx.dbPath);
    try {
      const results = await Promise.allSettled([
        bootstrapAdmin(ctx.client, { username: "alpha", password: STRONG_PASSWORD }),
        bootstrapAdmin(secondClient, { username: "beta", password: STRONG_PASSWORD }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ status: string; userId: string; username: string }>[];
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: "admin_already_exists" });

      const realAdmins = await ctx.client.user.findMany({
        where: { role: "ADMIN", status: "ACTIVE", NOT: { passwordHash: "!migration-owner-no-login" } },
      });
      expect(realAdmins).toHaveLength(1);
    } finally {
      await secondClient.$disconnect();
    }
  });
});
