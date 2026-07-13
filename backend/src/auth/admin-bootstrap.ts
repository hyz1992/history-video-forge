import type { AppPrismaClient } from "../db/prisma-client.types.js";
import { hashPassword, validatePasswordPolicy, PasswordPolicyError } from "./password-hash.js";

export interface BootstrapAdminInput {
  username: string;
  password: string;
  displayName?: string;
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

export async function bootstrapAdmin(
  client: AppPrismaClient,
  input: BootstrapAdminInput,
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

  const existingActiveAdminCount = await client.user.count({
    where: { role: "ADMIN", status: "ACTIVE" },
  });
  if (existingActiveAdminCount > 0) {
    throw new AdminBootstrapError("admin_already_exists", "admin_already_exists");
  }

  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || username;

  try {
    const result = await client.$transaction(async (tx) => {
      const user = await tx.user.create({
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

      await tx.auditLog.create({
        data: {
          actorUserId: null,
          action: ADMIN_BOOTSTRAP_AUDIT_ACTION,
          targetType: ADMIN_BOOTSTRAP_AUDIT_TARGET_TYPE,
          targetId: user.id,
          metadataJson: { username: user.username, role: "ADMIN", source: "cli_bootstrap" },
        },
      });

      return user;
    });

    return {
      status: "admin_created",
      userId: result.id,
      username: result.username,
    };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AdminBootstrapError("username_taken", "username_taken");
    }
    throw error;
  }
}

interface PrismaKnownError {
  code: string;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as PrismaKnownError).code;
  return code === "P2002";
}
