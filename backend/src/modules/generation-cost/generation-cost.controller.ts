import type { AppResponse, RouteContext } from "../../app.js";
import { requireUser } from "../../auth/authorization.js";
import { guardOwnedRoute } from "../../auth/authorization.js";
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

export const getProjectCostSummaryController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    requireUser(context.auth);
    const summary = await getProjectCostSummary(
      context.app.db,
      context.params.projectId,
      context.app.prismaClient,
    );
    return { statusCode: 200, body: summary };
  },
);

export const getProjectCostRecordsController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    requireUser(context.auth);
    const records = await listProjectCostRecords(
      context.app.db,
      context.params.projectId,
      context.app.prismaClient,
    );
    const body = ProjectCostRecordsResponseSchema.parse({ records, total: records.length });
    return { statusCode: 200, body };
  },
);

export const getRunConfigurationController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    requireUser(context.auth);
    const result = await getRunConfiguration(
      context.app.db,
      context.params.projectId,
      context.params.runId,
      context.app.prismaClient,
    );
    if (!result) {
      return { statusCode: 404, body: { error: "generation_run_not_found" } };
    }
    return { statusCode: 200, body: result };
  },
);
