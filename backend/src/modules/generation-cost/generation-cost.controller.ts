import type { AppResponse, RouteContext } from "../../app.js";
import { requireUser, requireOwner, handleControllerAuthError } from "../../auth/authorization.js";
import {
  getProjectCostSummary,
  getRunConfiguration,
  listProjectCostRecords,
} from "./generation-cost.service.js";
import { ProjectCostRecordsResponseSchema } from "../../../../shared/src/index.js";

/**
 * S2-2A 任务 8：成本只读 controller（2026-08-23 报价体系移除后保留）。
 * 所有项目接口 owner-scoped（guardOwnedRoute 按 projectId 反查 owner）；
 * 禁止只凭 snapshot/run/cost id 返回数据的未授权路径。
 * 金额在响应中为 CNY 十进制字符串。
 */

export const getProjectCostSummaryController = guardCostOwner(
  async (context: RouteContext): Promise<AppResponse> => {
    requireUser(context.auth);
    const summary = await getProjectCostSummary(
      context.app.db,
      context.params.projectId,
      context.app.prismaClient ?? context.app.db.narrationPersistence.prismaClient ?? context.app.db.firstAggregateWriter?.narrationPrismaClient,
    );
    return { statusCode: 200, body: summary };
  },
);

export const getProjectCostRecordsController = guardCostOwner(
  async (context: RouteContext): Promise<AppResponse> => {
    requireUser(context.auth);
    const records = await listProjectCostRecords(
      context.app.db,
      context.params.projectId,
      context.app.prismaClient ?? context.app.db.narrationPersistence.prismaClient ?? context.app.db.firstAggregateWriter?.narrationPrismaClient,
    );
    const body = ProjectCostRecordsResponseSchema.parse({ records, total: records.length });
    return { statusCode: 200, body };
  },
);

export const getRunConfigurationController = guardCostOwner(
  async (context: RouteContext): Promise<AppResponse> => {
    requireUser(context.auth);
    const result = await getRunConfiguration(
      context.app.db,
      context.params.projectId,
      context.params.runId,
      context.app.prismaClient ?? context.app.db.narrationPersistence.prismaClient ?? context.app.db.firstAggregateWriter?.narrationPrismaClient,
    );
    if (!result) {
      return { statusCode: 404, body: { error: "generation_run_not_found" } };
    }
    return { statusCode: 200, body: result };
  },
);

function guardCostOwner(handler: (context: RouteContext) => Promise<AppResponse>) {
  return async (context: RouteContext): Promise<AppResponse> => {
    try {
      const user = requireUser(context.auth), db = context.app.db;
      const client = context.app.prismaClient ?? db.narrationPersistence.prismaClient ?? db.firstAggregateWriter?.narrationPrismaClient;
      if (!client && (db.firstAggregateWriter || db.secondAggregateWriter || db.thirdAggregateWriter)) return { statusCode: 503, body: { error: "generation_cost_persistence_unavailable" } };
      const project = client ? await client.project.findFirst({ where: { id: context.params.projectId, archivedAt: null } }) : db.projects.get(context.params.projectId);
      if (!project) return { statusCode: 404, body: { error: "project_not_found" } }; requireOwner(user, project.ownerId);
      return await handler(context);
    } catch (error) { const response = handleControllerAuthError(error); if (response) return response; throw error ;}
  };
}
