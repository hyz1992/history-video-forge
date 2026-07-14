import type { AppResponse, RouteContext } from "../../app.js";
import { guardAdminRoute, requireAdmin } from "../../auth/authorization.js";
import type { AuthenticatedAuthContext } from "../../auth/auth-context.js";
import {
  adminCreateUser,
  adminDisableUser,
  adminEnableUser,
  adminResetPassword,
  adminRevokeUserSessions,
  adminTransferProjectOwner,
  AdminServiceError,
  fetchAuditLogs,
  listAllProjects,
  listAllUsers,
  type CreateUserInput,
} from "./admin.service.js";

function prismaUnavailable(): AppResponse {
  return {
    statusCode: 503,
    body: { error: "admin_store_unavailable", message: "管理后台数据存储未就绪" },
  };
}

function handleAdminServiceError(error: unknown): AppResponse {
  if (error instanceof AdminServiceError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.code, message: error.code },
    };
  }
  return {
    statusCode: 500,
    body: { error: "admin_internal_error", message: "admin_internal_error" },
  };
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

export const listUsersController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    const users = await listAllUsers(client);
    return { statusCode: 200, body: { items: users } };
  },
);

export const listProjectsController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    const projects = await listAllProjects(client);
    return { statusCode: 200, body: { items: projects } };
  },
);

export const queryAuditLogsController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    const query = context.payload ?? {};
    const page = await fetchAuditLogs(client, {
      actorUserId: typeof query.actorUserId === "string" && query.actorUserId.length > 0 ? query.actorUserId : undefined,
      projectId: typeof query.projectId === "string" && query.projectId.length > 0 ? query.projectId : undefined,
      action: typeof query.action === "string" && query.action.length > 0 ? query.action : undefined,
      targetType: typeof query.targetType === "string" && query.targetType.length > 0 ? query.targetType : undefined,
      targetId: typeof query.targetId === "string" && query.targetId.length > 0 ? query.targetId : undefined,
      from: parseDate(query.from),
      to: parseDate(query.to),
      limit: parseNumber(query.limit),
      offset: parseNumber(query.offset),
    });
    return { statusCode: 200, body: page };
  },
);

export const createUserController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const admin = requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    const payload = context.payload ?? {};
    const input: CreateUserInput = {
      username: typeof payload.username === "string" ? payload.username : "",
      displayName: typeof payload.displayName === "string" ? payload.displayName : undefined,
      password: typeof payload.password === "string" ? payload.password : "",
      role: payload.role === "ADMIN" || payload.role === "USER" ? payload.role : undefined,
    };
    try {
      const created = await adminCreateUser(client, { userId: admin.userId }, input);
      return { statusCode: 201, body: { user: created } };
    } catch (error) {
      return handleAdminServiceError(error);
    }
  },
);

export const disableUserController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const admin = requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    try {
      const result = await adminDisableUser(client, { userId: admin.userId }, context.params.userId);
      return { statusCode: 200, body: result };
    } catch (error) {
      return handleAdminServiceError(error);
    }
  },
);

export const enableUserController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const admin = requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    try {
      const result = await adminEnableUser(client, { userId: admin.userId }, context.params.userId);
      return { statusCode: 200, body: result };
    } catch (error) {
      return handleAdminServiceError(error);
    }
  },
);

export const resetPasswordController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const admin = requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    const payload = context.payload ?? {};
    const newPassword = typeof payload.password === "string" ? payload.password : "";
    try {
      const result = await adminResetPassword(
        client,
        { userId: admin.userId },
        context.params.userId,
        newPassword,
      );
      return { statusCode: 200, body: result };
    } catch (error) {
      return handleAdminServiceError(error);
    }
  },
);

export const revokeUserSessionsController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const admin = requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    try {
      const result = await adminRevokeUserSessions(client, { userId: admin.userId }, context.params.userId);
      return { statusCode: 200, body: result };
    } catch (error) {
      return handleAdminServiceError(error);
    }
  },
);

export const transferProjectOwnerController = guardAdminRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const admin: AuthenticatedAuthContext = requireAdmin(context.auth);
    const client = context.app.prismaClient;
    if (!client) return prismaUnavailable();
    const payload = context.payload ?? {};
    const targetUserId = typeof payload.targetUserId === "string" ? payload.targetUserId : "";
    const reason = typeof payload.reason === "string" ? payload.reason : undefined;
    try {
      const result = await adminTransferProjectOwner(
        client,
        { userId: admin.userId },
        {
          projectId: context.params.projectId,
          targetUserId,
          reason,
        },
      );
      return { statusCode: 200, body: result };
    } catch (error) {
      return handleAdminServiceError(error);
    }
  },
);
