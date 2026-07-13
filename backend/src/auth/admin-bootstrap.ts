import type { AppPrismaClient } from "../db/prisma-client.types.js";
import { hashPassword, validatePasswordPolicy, PasswordPolicyError } from "./password-hash.js";

export const MIGRATION_OWNER_NO_LOGIN_MARKER = "!migration-owner-no-login";

export interface BootstrapAdminInput {
  username: string;
  password: string;
  displayName?: string;
}

export interface BootstrapAdminOptions {
  requireDatabaseActivation?: boolean;
}

export interface BootstrapAdminResult {
  status: "admin_created";
  userId: string;
  username: string;
}

export class AdminBootstrapError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AdminBootstrapError";
  }
}

export const ADMIN_BOOTSTRAP_AUDIT_ACTION = "admin_bootstrap";
export const ADMIN_BOOTSTRAP_AUDIT_TARGET_TYPE = "User";

export function normalizeBootstrapUsername(username: string): string {
  if (typeof username !== "string") {
    throw new AdminBootstrapError("username_required", "username_required");
  }
  const trimmed = username.trim();
  if (trimmed.length === 0) {
    throw new AdminBootstrapError("username_required", "username_required");
  }
  if (trimmed.length > 64) {
    throw new AdminBootstrapError("username_too_long", "username_too_long");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(trimmed)) {
    throw new AdminBootstrapError("username_invalid_characters", "username_invalid_characters");
  }
  return trimmed;
}

async function assertDatabaseActivated(client: AppPrismaClient): Promise<void> {
  const activation = await client.databaseActivation.findUnique({ where: { id: "primary" } });
  if (!activation) {
    throw new AdminBootstrapError("database_not_activated", "database_not_activated");
  }
}

export async function bootstrapAdmin(
  client: AppPrismaClient,
  input: BootstrapAdminInput,
  options: BootstrapAdminOptions = {},
): Promise<BootstrapAdminResult> {
  const username = normalizeBootstrapUsername(input.username);

  try {
    validatePasswordPolicy(input.password);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      throw new AdminBootstrapError(error.message, error.message);
    }
    throw error;
  }

  const requireActivation = options.requireDatabaseActivation ?? true;
  if (requireActivation) {
    await assertDatabaseActivated(client);
  }

  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || username;

  try {
    await client.$executeRawUnsafe("BEGIN IMMEDIATE");
  } catch (error) {
    throw new AdminBootstrapError(
      "bootstrap_lock_acquire_failed",
      `bootstrap_lock_acquire_failed:${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  let createdUser: { id: string; username: string };
  try {
    const existingRealAdminCount = await client.user.count({
      where: {
        role: "ADMIN",
        status: "ACTIVE",
        NOT: { passwordHash: MIGRATION_OWNER_NO_LOGIN_MARKER },
      },
    });
    if (existingRealAdminCount > 0) {
      throw new AdminBootstrapError("admin_already_exists", "admin_already_exists");
    }

    createdUser = await client.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
        mustChangePassword: false,
      },
      select: { id: true, username: true },
    });

    await client.auditLog.create({
      data: {
        actorUserId: null,
        action: ADMIN_BOOTSTRAP_AUDIT_ACTION,
        targetType: ADMIN_BOOTSTRAP_AUDIT_TARGET_TYPE,
        targetId: createdUser.id,
        metadataJson: { username: createdUser.username, role: "ADMIN", source: "cli_bootstrap" },
      },
    });

    await client.$executeRawUnsafe("COMMIT");
  } catch (error) {
    await client.$executeRawUnsafe("ROLLBACK").catch(() => undefined);
    if (error instanceof AdminBootstrapError) {
      throw error;
    }
    if (isUniqueConstraintViolation(error)) {
      throw new AdminBootstrapError("username_taken", "username_taken");
    }
    throw error;
  }

  return {
    status: "admin_created",
    userId: createdUser.id,
    username: createdUser.username,
  };
}

interface PrismaKnownError {
  code: string;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as PrismaKnownError).code;
  return code === "P2002";
}
