import type { AppPrismaClient } from "../../db/prisma-client.types.js";

export interface AuditLogQuery {
  actorUserId?: string;
  projectId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  projectId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadataJson: unknown;
  createdAt: Date;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function clampLimit(value: number | undefined): number {
  if (!value || value <= 0) return DEFAULT_PAGE_SIZE;
  if (value > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return value;
}

export async function queryAuditLogs(
  client: AppPrismaClient,
  query: AuditLogQuery,
): Promise<{ items: AuditLogRecord[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (query.actorUserId !== undefined) where.actorUserId = query.actorUserId;
  if (query.projectId !== undefined) where.projectId = query.projectId;
  if (query.action !== undefined) where.action = query.action;
  if (query.targetType !== undefined) where.targetType = query.targetType;
  if (query.targetId !== undefined) where.targetId = query.targetId;
  if (query.from !== undefined || query.to !== undefined) {
    const range: Record<string, Date> = {};
    if (query.from !== undefined) range.gte = query.from;
    if (query.to !== undefined) range.lte = query.to;
    where.createdAt = range;
  }

  const limit = clampLimit(query.limit);
  const offset = query.offset && query.offset > 0 ? query.offset : 0;

  const [items, total] = await Promise.all([
    client.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    client.auditLog.count({ where }),
  ]);

  return {
    items: items.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      projectId: row.projectId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadataJson: row.metadataJson,
      createdAt: row.createdAt,
    })),
    total,
  };
}
