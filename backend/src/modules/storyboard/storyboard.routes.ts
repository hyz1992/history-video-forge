import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { runStoryboardGeneration, runStoryboardSegmentRegeneration } from "./storyboard-run.service";
import { getStoryboardRecordById, saveStoryboardRecord } from "./storyboard-record.repository";

interface StoryboardGeneratePayload {
  user_feedback?: string;
}

interface StoryboardUpdateStrategyPayload {
  segment_id: string;
  visual_strategy_preference: "remotion_motion" | "api_video" | null;
}

interface StoryboardSegmentRegenPayload {
  user_feedback: string;
}

async function regenerateSegmentController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "分镜");
  if (demoBlock) return demoBlock;

  const payload = context.payload as StoryboardSegmentRegenPayload;
  return runStoryboardSegmentRegeneration({
    db: context.app.db,
    project,
    segmentId: context.params.segmentId,
    userFeedback: payload.user_feedback,
  });
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

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "分镜");
  if (demoBlock) return demoBlock;

  const payload = context.payload as StoryboardGeneratePayload | undefined;

  return runStoryboardGeneration({
    db: context.app.db,
    project,
    userFeedback: payload?.user_feedback,
  });
}

async function updateSegmentStrategyController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  if (!project.activeStoryboardRecordId) {
    return { statusCode: 400, body: { error: "no_active_storyboard" } };
  }

  const record = await getStoryboardRecordById(
    context.app.db,
    project.activeStoryboardRecordId,
  );
  if (!record) {
    return { statusCode: 404, body: { error: "storyboard_record_not_found" } };
  }

  const payload = context.payload as StoryboardUpdateStrategyPayload;
  const plan = record.planJson as Record<string, unknown>;
  const segments = plan.segments as Array<Record<string, unknown>> | undefined;
  if (!segments) {
    return { statusCode: 400, body: { error: "no_segments_in_plan" } };
  }

  const segment = segments.find(
    (s) => s.segment_id === payload.segment_id,
  );
  if (!segment) {
    return { statusCode: 404, body: { error: "segment_not_found" } };
  }

  segment.visual_strategy_preference = payload.visual_strategy_preference;

  await saveStoryboardRecord(context.app.db, {
    id: record.id,
    projectId: record.projectId,
    topicPackageId: record.topicPackageId,
    scriptRecordId: record.scriptRecordId,
    planJson: plan,
    validationResultJson: record.validationResultJson as Record<string, unknown>,
    executionStateJson: record.executionStateJson as Record<string, unknown> | null,
    graphTraceSummaryJson: record.graphTraceSummaryJson as Record<string, unknown> | null,
    runtimeDiagnosticsJson: record.runtimeDiagnosticsJson as Record<string, unknown> | null,
  });

  return {
    statusCode: 200,
    body: { updated: true, segment_id: payload.segment_id },
  };
}

export function registerStoryboardRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/storyboard/generate",
    generateStoryboardController,
  );
  app.addRoute(
    "PATCH",
    "/api/projects/:projectId/storyboard/strategy",
    updateSegmentStrategyController,
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/storyboard/segments/:segmentId/regen",
    regenerateSegmentController,
  );
}
