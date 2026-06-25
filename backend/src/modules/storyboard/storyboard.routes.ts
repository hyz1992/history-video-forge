import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runStoryboardGeneration } from "./storyboard-run.service";

interface StoryboardGeneratePayload {
  user_feedback?: string;
}

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

  const payload = context.payload as StoryboardGeneratePayload | undefined;

  return runStoryboardGeneration({
    db: context.app.db,
    project,
    userFeedback: payload?.user_feedback,
  });
}

export function registerStoryboardRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/storyboard/generate",
    generateStoryboardController,
  );
}
