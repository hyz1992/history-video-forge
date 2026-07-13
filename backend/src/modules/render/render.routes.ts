import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runRenderGeneration } from "./render-run.service";
import { guardOwnedRoute } from "../../auth/authorization.js";

async function generateRenderController(
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

  return runRenderGeneration({
    db: context.app.db,
    project,
    adapter: context.app.renderAdapter,
  });
}

export function registerRenderRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/render/generate",
    guardOwnedRoute(generateRenderController),
  );
}
