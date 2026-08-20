import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { runAssetPlanningGeneration } from "./asset-planning-run.service";
import { extractSubmitFields, submitGenerationRun } from "../generation-run/submit-protocol.js";
import { isPaidLlmDispatchPossible } from "../generation-cost/provider-dispatch-gate.js";
import { guardOwnedRoute } from "../../auth/authorization.js";

async function generateAssetPlanController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "资产规划");
  if (demoBlock) return demoBlock;

  const payload = (context.payload ?? {}) as Record<string, unknown>;
  // S2-2A 任务 9B：quote 提交协议
  const submit = extractSubmitFields(payload);
  if (submit.present) {
    if (submit.invalid) {
      return { statusCode: 400, body: { error: "generation_submit_fields_incomplete", message: "cost_quote_id 与 idempotency_key 必须同时提供" } };
    }
    return submitGenerationRun(context, "asset_plan.generate", undefined, {});
  }
  if (isPaidLlmDispatchPossible(context.app.db)) {
    return {
      statusCode: 409,
      body: { error: "paid_generation_quote_required", message: "当前部署可调用付费 LLM provider：请先创建报价并在生成请求中携带 cost_quote_id 与 idempotency_key" },
    };
  }

  return runAssetPlanningGeneration({
    db: context.app.db,
    project,
    demoMode: context.app.env.demoMode,
  });
}

export function registerAssetPlanningRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/asset-plan/generate",
    guardOwnedRoute(generateAssetPlanController),
  );
}
