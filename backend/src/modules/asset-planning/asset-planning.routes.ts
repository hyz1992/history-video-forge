import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { submitGenerationRun } from "../generation-run/submit-protocol.js";
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

  // 2026-08-23（报价体系移除）：生成统一走 run 提交协议（无需 quote 字段）
  return submitGenerationRun(context, "asset_plan.generate", undefined, {});
}

export function registerAssetPlanningRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/asset-plan/generate",
    guardOwnedRoute(generateAssetPlanController),
  );
}
