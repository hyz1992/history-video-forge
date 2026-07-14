import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import { queryAuditLogs, type AuditLogQuery, type AuditLogRecord } from "./audit-log.repository.js";

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
