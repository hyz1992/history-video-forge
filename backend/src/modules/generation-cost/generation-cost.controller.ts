import type { AppResponse, RouteContext } from "../../app.js";
import { requireUser } from "../../auth/authorization.js";
import { guardOwnedRoute } from "../../auth/authorization.js";
import {
  createGenerationCostQuote,
  getProjectCostSummary,
  getRunConfiguration,
  listProjectCostRecords,
} from "./generation-cost.service.js";
import {
  ProjectCostRecordsResponseSchema,
  type GenerationQuoteRequest,
} from "../../../../shared/src/index.js";
import { resolveGenerationCostBootstrapInputFromEnv } from "./generation-cost-bootstrap.js";

/**
 * S2-2A 任务 8：报价与成本 controller。
 * 所有项目接口 owner-scoped（guardOwnedRoute 按 projectId 反查 owner）；
 * 禁止只凭 quote/snapshot/run/cost id 返回数据的未授权路径。
 * 金额在响应中为 CNY 十进制字符串。
 */

export const createGenerationQuoteController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const project = context.app.db.projects.get(context.params.projectId)!;
    const request = context.payload as GenerationQuoteRequest;

    const readinessInput =
      context.app.generationQuoteReadinessInput ?? resolveGenerationCostBootstrapInputFromEnv();
    const result = await createGenerationCostQuote(
      context.app.db,
      project,
      user.userId,
      request,
      // I-1'：quote 创建与提交重校验同一 DB 权威输入源
      { readinessInput, prismaClient: context.app.prismaClient },
    );
    if (!result.ok) {
      if (result.error.code === "generation_quote_invalid_input") {
        return { statusCode: 400, body: { error: result.error.code, detail: result.error.message } };
      }
      return { statusCode: 422, body: { error: result.error.code, reason: result.error.message } };
    }
    return { statusCode: 200, body: result.value.response };
  },
);

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
