import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { runAssetPlanningGeneration } from "./asset-planning-run.service";
import { guardUserRoute } from "../../auth/authorization.js";

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

  return runAssetPlanningGeneration({
    db: context.app.db,
    project,
  });
}

export function registerAssetPlanningRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/asset-plan/generate",
    guardUserRoute(generateAssetPlanController),
  );
}
