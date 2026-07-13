import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runComposeGeneration } from "./compose-run.service";
import { guardOwnedRoute } from "../../auth/authorization.js";

async function generateComposeController(
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

  return runComposeGeneration({
    db: context.app.db,
    project,
  });
}

export function registerComposeRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/compose/generate",
    guardOwnedRoute(generateComposeController),
  );
}
