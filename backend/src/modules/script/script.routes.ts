import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runScriptGeneration } from "./script-run.service";
import { submitGenerationRun } from "../generation-run/submit-protocol.js";
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

  const payload = (context.payload ?? {}) as Record<string, unknown>;
  // 2026-08-23（报价体系移除）：生成统一走 run 提交协议（无需 quote 字段）
  return submitGenerationRun(context, "script.generate", undefined, {
    allow_patch: payload.allow_patch as boolean | undefined,
    allow_regen: payload.allow_regen as boolean | undefined,
    allow_local_repair_regen: payload.allow_local_repair_regen as boolean | undefined,
    force_regen: payload.force_regen as boolean | undefined,
    user_feedback: payload.user_feedback as string | undefined,
  });
}

export function registerScriptRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/script/generate",
    guardOwnedRoute(generateScriptController),
  );
}
