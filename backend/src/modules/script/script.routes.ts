import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { runScriptGeneration } from "./script-run.service";
import { guardOwnedRoute } from "../../auth/authorization.js";

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

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "文案");
  if (demoBlock) return demoBlock;

  return runScriptGeneration({
    db: context.app.db,
    project,
    allowPatch: context.payload?.allow_patch,
    allowRegen: context.payload?.allow_regen,
    allowLocalRepairRegen: context.payload?.allow_local_repair_regen,
    forceRegen: context.payload?.force_regen,
    userFeedback: context.payload?.user_feedback ?? undefined,
  });
}

export function registerScriptRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/script/generate",
    guardOwnedRoute(generateScriptController),
  );
}
