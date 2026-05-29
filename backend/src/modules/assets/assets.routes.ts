import type { AppInstance, AppResponse, RouteContext } from "../../app";
import { getProjectById } from "../projects/project.repository";
import { runAssetsGeneration, registerManualArtifact, acceptArtifact } from "./assets-run.service";

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readDashscopeTtsFormat(value: unknown) {
  return value === "mp3" || value === "wav" || value === "flac" || value === "pcm"
    ? value
    : undefined;
}

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
  const payload = context.payload as Record<string, unknown>;
  const providerMode =
    payload.provider_mode === "dashscope" || payload.provider_mode === "dashscope_tts"
      ? payload.provider_mode
      : undefined;
  const dashscopePayload =
    typeof payload.dashscope === "object" && payload.dashscope !== null
      ? payload.dashscope as Record<string, unknown>
      : {};
  const enabledProviderTypes = Array.isArray(payload.enabled_provider_types)
    ? payload.enabled_provider_types as string[]
    : undefined;

  return runAssetsGeneration({
    db: context.app.db,
    project,
    voiceProfileId,
    executionMode,
    providerMode,
    enabledProviderTypes,
    dashscope: {
      apiKey: dashscopePayload.api_key as string | undefined,
      baseUrl: dashscopePayload.base_url as string | undefined,
      imageModel: dashscopePayload.image_model as string | undefined,
      imageSize: dashscopePayload.image_size as string | undefined,
      imagePollIntervalMs: readOptionalNumber(dashscopePayload.image_poll_interval_ms),
      imageMaxPollAttempts: readOptionalNumber(dashscopePayload.image_max_poll_attempts),
      imageToVideoModel: dashscopePayload.image_to_video_model as string | undefined,
      imageToVideoResolution: dashscopePayload.image_to_video_resolution as string | undefined,
      imageToVideoDurationSec: readOptionalNumber(dashscopePayload.image_to_video_duration_sec),
      imageToVideoPollIntervalMs: readOptionalNumber(dashscopePayload.image_to_video_poll_interval_ms),
      imageToVideoMaxPollAttempts: readOptionalNumber(dashscopePayload.image_to_video_max_poll_attempts),
      ttsModel: dashscopePayload.tts_model as string | undefined,
      ttsFormat: readDashscopeTtsFormat(dashscopePayload.tts_format),
      ttsSampleRate: readOptionalNumber(dashscopePayload.tts_sample_rate),
    },
  });
}

async function registerArtifactController(
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

  const payload = context.payload as Record<string, unknown>;

  return registerManualArtifact({
    db: context.app.db,
    project,
    taskId: context.params.taskId,
    artifactType: payload.artifact_type as string,
    fileUri: payload.file_uri as string,
    mimeType: payload.mime_type as string,
    metadata: (payload.metadata as Record<string, unknown>) ?? {},
  });
}

async function acceptArtifactController(
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

  const payload = context.payload as Record<string, unknown>;

  return acceptArtifact({
    db: context.app.db,
    project,
    taskId: context.params.taskId,
    artifactId: payload.artifact_id as string,
  });
}

export function registerAssetsRoutes(app: AppInstance) {
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/generate",
    generateAssetsController,
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/artifacts/register",
    registerArtifactController,
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/assets/tasks/:taskId/accept",
    acceptArtifactController,
  );
}
