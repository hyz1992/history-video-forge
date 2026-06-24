import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runScriptGeneration } from "./script-run.service";

async function generateScriptController(
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

  return runScriptGeneration({
    db: context.app.db,
    project,
    allowPatch: context.payload?.allow_patch,
    allowRegen: context.payload?.allow_regen,
    forceRegen: context.payload?.force_regen,
    userFeedback: context.payload?.user_feedback ?? undefined,
  });
}

export function registerScriptRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/script/generate",
    generateScriptController,
  );
}
