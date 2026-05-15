import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runAssetsGeneration } from "./assets-run.service";

async function generateAssetsController(
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

  const voiceProfileId =
    (context.payload as Record<string, unknown>).voice_profile_id as string | undefined
      ?? "voice_default_male_storyteller";
  const executionMode =
    (context.payload as Record<string, unknown>).execution_mode as string | undefined
      ?? "auto_available";

  return runAssetsGeneration({
    db: context.app.db,
    project,
    voiceProfileId,
    executionMode,
  });
}

export function registerAssetsRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/generate",
    generateAssetsController,
  );
}
