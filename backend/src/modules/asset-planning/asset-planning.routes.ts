import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runAssetPlanningGeneration } from "./asset-planning-run.service";

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

  return runAssetPlanningGeneration({
    db: context.app.db,
    project,
  });
}

export function registerAssetPlanningRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/asset-plan/generate",
    generateAssetPlanController,
  );
}
