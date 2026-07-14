import type { AppResponse, RouteContext } from "../../app.js";
import { guardAdminRoute, requireAdmin } from "../../auth/authorization.js";
import {
  fetchAuditLogs,
  listAllProjects,
  listAllUsers,
} from "./admin.service.js";

function prismaUnavailable(): AppResponse {
  return {
    statusCode: 503,
    body: { error: "admin_store_unavailable", message: "管理后台数据存储未就绪" },
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
