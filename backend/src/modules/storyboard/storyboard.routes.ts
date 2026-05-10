import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runStoryboardGeneration } from "./storyboard-run.service";

async function generateStoryboardController(
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

  return runStoryboardGeneration({
    db: context.app.db,
    project,
  });
}

export function registerStoryboardRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/storyboard/generate",
    generateStoryboardController,
  );
}
