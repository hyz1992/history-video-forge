import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import { queryAuditLogs, type AuditLogQuery, type AuditLogRecord } from "./audit-log.repository.js";
import {
  hashPassword,
  validatePasswordPolicy,
  PasswordPolicyError,
} from "../../auth/password-hash.js";
import { PrismaSessionStore } from "../../auth/session-store.js";

export interface AdminUserSummary {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isMigrationOwner: boolean;
}

export interface AdminProjectSummary {
  id: string;
  name: string;
  ownerId: string;
  createdById: string;
  status: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAuditLogPage {
  items: AuditLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

const MIGRATION_OWNER_NO_LOGIN_MARKER = "!migration-owner-no-login";

function toUserSummary(row: {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  passwordHash: string;
}): AdminUserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isMigrationOwner: row.passwordHash === MIGRATION_OWNER_NO_LOGIN_MARKER,
  };
}

export async function listAllUsers(client: AppPrismaClient): Promise<AdminUserSummary[]> {
  const users = await client.user.findMany({
    orderBy: { createdAt: "asc" },
  });
  return users.map(toUserSummary);
}

export async function listAllProjects(client: AppPrismaClient): Promise<AdminProjectSummary[]> {
  const projects = await client.project.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      ownerId: true,
      createdById: true,
      status: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return projects;
}

export async function fetchAuditLogs(
  client: AppPrismaClient,
  query: AuditLogQuery,
): Promise<AdminAuditLogPage> {
  const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 200) : 50;
  const offset = query.offset && query.offset > 0 ? query.offset : 0;
  const result = await queryAuditLogs(client, { ...query, limit, offset });
  return {
    items: result.items,
    total: result.total,
    limit,
    offset,
  };
}

export const ADMIN_AUDIT_ACTIONS = {
  userCreate: "user_create",
  userDisable: "user_disable",
  userEnable: "user_enable",
  userPasswordReset: "user_password_reset",
  sessionRevoke: "session_revoke",
  ownerTransfer: "owner_transfer",
} as const;

export class AdminServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "AdminServiceError";
  }
}

export interface AdminActor {
  userId: string;
}

export interface CreateUserInput {
  username: string;
  displayName?: string;
  password: string;
  role?: "ADMIN" | "USER";
}

function normalizeUsername(username: string): string {
  if (typeof username !== "string") {
    throw new AdminServiceError("username_required", "username_required");
  }
  const trimmed = username.trim();
  if (trimmed.length === 0) {
    throw new AdminServiceError("username_required", "username_required");
  }
  if (trimmed.length > 64) {
    throw new AdminServiceError("username_too_long", "username_too_long");
  }
  if (!/^[A-Za-z0-9_.-]+$/u.test(trimmed)) {
    throw new AdminServiceError("username_invalid_characters", "username_invalid_characters");
  }
  return trimmed;
}

function normalizeRole(role: unknown): "ADMIN" | "USER" {
  if (role === undefined || role === null) return "USER";
  if (role === "ADMIN" || role === "USER") return role;
  throw new AdminServiceError("invalid_role", "invalid_role");
}

interface PrismaKnownError {
  code: string;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as PrismaKnownError).code === "P2002";
}

export async function adminCreateUser(
  client: AppPrismaClient,
  actor: AdminActor,
  input: CreateUserInput,
): Promise<AdminUserSummary> {
  const username = normalizeUsername(input.username);
  const role = normalizeRole(input.role);
  try {
    validatePasswordPolicyInput(input.password);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      throw new AdminServiceError(error.message, error.message, 400);
    }
    throw error;
  }
  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || username;

  try {
    const created = await client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username,
          displayName,
          passwordHash,
          role,
          status: "ACTIVE",
          mustChangePassword: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: ADMIN_AUDIT_ACTIONS.userCreate,
          targetType: "User",
          targetId: user.id,
          metadataJson: { username: user.username, role: user.role },
        },
      });
      return user;
    });
    return toUserSummary(created);
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    if (isUniqueConstraintViolation(error)) {
      throw new AdminServiceError("username_taken", "username_taken", 409);
    }
    throw error;
  }
}

function validatePasswordPolicyInput(password: string): void {
  validatePasswordPolicy(password);
}

export async function adminDisableUser(
  client: AppPrismaClient,
  actor: AdminActor,
  targetUserId: string,
): Promise<{ userId: string; status: string }> {
  try {
    const result = await client.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new AdminServiceError("user_not_found", "user_not_found", 404);
      }
      if (target.status === "DISABLED") {
        throw new AdminServiceError("user_already_disabled", "user_already_disabled", 409);
      }
      if (target.role === "ADMIN") {
        const activeAdminCount = await tx.user.count({
          where: { role: "ADMIN", status: "ACTIVE" },
        });
        if (activeAdminCount <= 1) {
          throw new AdminServiceError("cannot_disable_last_admin", "cannot_disable_last_admin", 409);
        }
      }
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status: "DISABLED" },
      });
      await tx.session.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: ADMIN_AUDIT_ACTIONS.userDisable,
          targetType: "User",
          targetId: targetUserId,
          metadataJson: {},
        },
      });
      return updated;
    });
    return { userId: result.id, status: result.status };
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    throw error;
  }
}

export async function adminEnableUser(
  client: AppPrismaClient,
  actor: AdminActor,
  targetUserId: string,
): Promise<{ userId: string; status: string }> {
  try {
    const result = await client.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new AdminServiceError("user_not_found", "user_not_found", 404);
      }
      if (target.status === "ACTIVE") {
        throw new AdminServiceError("user_already_active", "user_already_active", 409);
      }
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status: "ACTIVE" },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: ADMIN_AUDIT_ACTIONS.userEnable,
          targetType: "User",
          targetId: targetUserId,
          metadataJson: {},
        },
      });
      return updated;
    });
    return { userId: result.id, status: result.status };
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    throw error;
  }
}

export async function adminResetPassword(
  client: AppPrismaClient,
  actor: AdminActor,
  targetUserId: string,
  newPassword: string,
): Promise<{ userId: string; mustChangePassword: boolean }> {
  try {
    validatePasswordPolicyInput(newPassword);
  } catch (error) {
    if (error instanceof PasswordPolicyError) {
      throw new AdminServiceError(error.message, error.message, 400);
    }
    throw error;
  }
  const passwordHash = await hashPassword(newPassword);

  try {
    const result = await client.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target) {
        throw new AdminServiceError("user_not_found", "user_not_found", 404);
      }
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { passwordHash, mustChangePassword: true },
      });
      await tx.session.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          action: ADMIN_AUDIT_ACTIONS.userPasswordReset,
          targetType: "User",
          targetId: targetUserId,
          metadataJson: {},
        },
      });
      return updated;
    });
    return { userId: result.id, mustChangePassword: result.mustChangePassword };
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    throw error;
  }
}

export async function adminRevokeUserSessions(
  client: AppPrismaClient,
  actor: AdminActor,
  targetUserId: string,
): Promise<{ userId: string; revokedCount: number }> {
  const target = await client.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    throw new AdminServiceError("user_not_found", "user_not_found", 404);
  }
  const sessionStore = new PrismaSessionStore(client);
  const revokedCount = await sessionStore.revokeSessionsByUser(targetUserId);
  await client.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: ADMIN_AUDIT_ACTIONS.sessionRevoke,
      targetType: "Session",
      targetId: targetUserId,
      metadataJson: { revokedCount },
    },
  });
  return { userId: targetUserId, revokedCount };
}

export interface TransferOwnerInput {
  projectId: string;
  targetUserId: string;
  reason?: string;
}

export async function adminTransferProjectOwner(
  client: AppPrismaClient,
  actor: AdminActor,
  input: TransferOwnerInput,
): Promise<{ projectId: string; ownerId: string; createdById: string }> {
  try {
    const result = await client.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project) {
        throw new AdminServiceError("project_not_found", "project_not_found", 404);
      }
      const targetUser = await tx.user.findUnique({ where: { id: input.targetUserId } });
      if (!targetUser) {
        throw new AdminServiceError("target_user_not_found", "target_user_not_found", 404);
      }
      if (targetUser.status !== "ACTIVE") {
        throw new AdminServiceError("target_user_not_active", "target_user_not_active", 409);
      }
      const fromOwnerId = project.ownerId;
      const updated = await tx.project.update({
        where: { id: input.projectId },
        data: { ownerId: input.targetUserId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.userId,
          projectId: input.projectId,
          action: ADMIN_AUDIT_ACTIONS.ownerTransfer,
          targetType: "Project",
          targetId: input.projectId,
          metadataJson: {
            fromOwnerId,
            toOwnerId: input.targetUserId,
            reason: input.reason ?? null,
          },
        },
      });
      return updated;
    });
    return {
      projectId: result.id,
      ownerId: result.ownerId,
      createdById: result.createdById,
    };
  } catch (error) {
    if (error instanceof AdminServiceError) throw error;
    throw error;
  }
}
