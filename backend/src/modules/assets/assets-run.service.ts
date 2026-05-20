import type {
  DbClient,
  ProjectRecord,
} from "../../db/client";
import {
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";
import type {
  AssetArtifact,
  AssetExecutionOptions,
  AssetManifest,
  AssetPlan,
} from "../../../../shared/src/index.js";
import {
  AssetArtifact as AssetArtifactSchema,
  AssetExecutionOptions as AssetExecutionOptionsSchema,
} from "../../../../shared/src/index.js";
import { saveAssetManifestRecord } from "./asset-manifest-record.repository";
import { getAssetManifestRecordById } from "./asset-manifest-record.repository";
import { buildInitialAssetManifest } from "./assets-manifest-builder";
import { validateAssetsManifest } from "./assets-local-validator";
import { createAssetProviderRegistry } from "./assets-provider-registry.js";
import { executeAssetManifest } from "./assets-execution-engine.js";
import { createFakeTtsProvider } from "./providers/fake-tts-provider.js";
import { createFakeImageProvider } from "./providers/fake-image-provider.js";
import { createLocalSubtitleProvider } from "./providers/local-subtitle-provider.js";
import { createLocalBgmProvider } from "./providers/local-bgm-provider.js";
import { createLocalSfxProvider } from "./providers/local-sfx-provider.js";
import { createDashscopeTtsProvider } from "./providers/dashscope/dashscope-tts-provider.js";
import { createDashscopeImageProvider } from "./providers/dashscope/dashscope-image-provider.js";
import { createDashscopeImageToVideoProvider } from "./providers/dashscope/dashscope-image-to-video-provider.js";
import { configureVoiceProfilePersistence } from "./voice/voice-profile.repository.js";
import { resolveVoiceProfile } from "./voice/voice-resolution.service.js";
import { normalizeAssetPlanTtsForExecution } from "./tts-chunking.service.js";

type AssetsProviderMode = "fake" | "dashscope";
type DashscopeTtsFormat = "mp3" | "wav" | "flac" | "pcm";

interface DashscopeProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  imageModel?: string;
  imageSize?: string;
  imagePollIntervalMs?: number;
  imageMaxPollAttempts?: number;
  imageToVideoModel?: string;
  imageToVideoResolution?: string;
  imageToVideoDurationSec?: number;
  imageToVideoPollIntervalMs?: number;
  imageToVideoMaxPollAttempts?: number;
  ttsModel?: string;
  ttsFormat?: DashscopeTtsFormat;
  ttsSampleRate?: number;
}

export interface RunAssetsGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  voiceProfileId: string;
  executionMode: string;
  providerMode?: AssetsProviderMode;
  dashscope?: DashscopeProviderConfig;
}

function buildTraceSummary(input: {
  runId: string;
  validationDecision: string;
  staleSourceDetected: boolean;
}) {
  const now = new Date().toISOString();
  const steps = [
    {
      step_name: "assets-manifest-build",
      phase: "assets",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    },
    {
      step_name: "assets-local-validate",
      phase: "assets",
      status:
        input.validationDecision === "ready_for_compose"
          ? "succeeded"
          : "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    },
  ];

  if (input.staleSourceDetected) {
    steps.push({
      step_name: "assets-source-recheck",
      phase: "assets",
      status: "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  return {
    phase: "assets",
    run_id: input.runId,
    nodes: [
      {
        node_name: "assets-manifest-build",
        input_ref: "active-asset-plan:current",
        output_ref: "asset-manifest:candidate",
        failure_reason: null,
      },
      {
        node_name: "assets-local-validate",
        input_ref: "asset-manifest:candidate",
        output_ref: "assets-local-validation:current",
        failure_reason:
          input.validationDecision === "ready_for_compose"
            ? null
            : "assets_local_validation_failed",
      },
      {
        node_name: "assets-source-recheck",
        input_ref: "active-asset-plan:current",
        output_ref: "asset-manifest-activation:current",
        failure_reason: input.staleSourceDetected
          ? "stale_assets_source"
          : null,
      },
    ],
    steps,
  };
}

function buildExecutionOptions(input: {
  executionMode: string;
  voiceProfileId: string;
}) {
  return AssetExecutionOptionsSchema.safeParse({
    execution_mode: input.executionMode,
    voice_profile_id: input.voiceProfileId,
    enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
    allow_manual_placeholders: false,
  });
}

function readDashscopeConfig(input: DashscopeProviderConfig | undefined) {
  return {
    apiKey: input?.apiKey ?? process.env.ALIYUN_DASHSCOPE_API_KEY ?? "",
    baseUrl: input?.baseUrl ?? process.env.ALIYUN_DASHSCOPE_BASE_URL,
    imageModel:
      input?.imageModel ??
      process.env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL ??
      process.env.ALIYUN_DASHSCOPE_MODEL ??
      "wan2.6-t2i",
    imageSize: input?.imageSize,
    imagePollIntervalMs: input?.imagePollIntervalMs,
    imageMaxPollAttempts: input?.imageMaxPollAttempts,
    imageToVideoModel:
      input?.imageToVideoModel ??
      process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL ??
      "wan2.7-i2v-2026-04-25",
    imageToVideoResolution:
      input?.imageToVideoResolution ??
      process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION,
    imageToVideoDurationSec:
      input?.imageToVideoDurationSec ??
      readOptionalNumber(process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC),
    imageToVideoPollIntervalMs:
      input?.imageToVideoPollIntervalMs ??
      readOptionalNumber(process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS),
    imageToVideoMaxPollAttempts:
      input?.imageToVideoMaxPollAttempts ??
      readOptionalNumber(process.env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS),
    ttsModel:
      input?.ttsModel ??
      process.env.ALIYUN_DASHSCOPE_TTS_MODEL ??
      process.env.TTS_MODEL ??
      "qwen3-tts-instruct-flash",
    ttsFormat: input?.ttsFormat,
    ttsSampleRate: input?.ttsSampleRate,
  };
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildProviderRegistry(input: {
  db: DbClient;
  providerMode: AssetsProviderMode | undefined;
  dashscope: DashscopeProviderConfig | undefined;
}) {
  if (input.providerMode === "dashscope") {
    const dashscope = readDashscopeConfig(input.dashscope);

    return createAssetProviderRegistry([
      createDashscopeTtsProvider({
        apiKey: dashscope.apiKey,
        baseUrl: dashscope.baseUrl,
        model: dashscope.ttsModel,
        format: dashscope.ttsFormat,
        sampleRate: dashscope.ttsSampleRate,
        db: input.db,
      }),
      createLocalSubtitleProvider(),
      createDashscopeImageProvider({
        apiKey: dashscope.apiKey,
        baseUrl: dashscope.baseUrl,
        model: dashscope.imageModel,
        size: dashscope.imageSize,
        pollIntervalMs: dashscope.imagePollIntervalMs,
        maxPollAttempts: dashscope.imageMaxPollAttempts,
      }),
      createDashscopeImageToVideoProvider({
        apiKey: dashscope.apiKey,
        baseUrl: dashscope.baseUrl,
        model: dashscope.imageToVideoModel,
        resolution: dashscope.imageToVideoResolution,
        durationSec: dashscope.imageToVideoDurationSec,
        pollIntervalMs: dashscope.imageToVideoPollIntervalMs,
        maxPollAttempts: dashscope.imageToVideoMaxPollAttempts,
      }),
      createLocalSfxProvider(input.db),
      createLocalBgmProvider(input.db),
    ]);
  }

  return createAssetProviderRegistry([
    createFakeTtsProvider(),
    createLocalSubtitleProvider(),
    createFakeImageProvider(),
    createLocalSfxProvider(input.db),
    createLocalBgmProvider(input.db),
  ]);
}

function allowedArtifactTypesForTask(taskType: AssetPlan["tasks"][number]["task_type"]) {
  switch (taskType) {
    case "tts_audio":
      return ["tts_chunk_audio", "tts_merged_audio"];
    case "image_still":
      return ["image"];
    case "video_clip":
      return ["video"];
    case "subtitle_track":
      return ["subtitle_track"];
    case "sfx_cue":
      return ["sfx_audio", "sfx_selection"];
    case "bgm_cue":
      return ["bgm_audio", "bgm_selection"];
    case "render_motion_cue":
      return ["motion_recipe"];
  }
}

function applyArtifactToManifestRoutes(input: {
  manifest: AssetManifest;
  planTask: AssetPlan["tasks"][number];
  artifact: AssetArtifact;
}) {
  const { manifest, planTask, artifact } = input;

  if (artifact.artifact_type === "subtitle_track") {
    manifest.audio_summary.subtitle_artifact_id = artifact.artifact_id;
    for (const route of manifest.segment_routes) {
      route.subtitle_artifact_id = artifact.artifact_id;
    }
    return;
  }

  if (artifact.artifact_type === "tts_merged_audio") {
    manifest.audio_summary.tts_merged_artifact_id = artifact.artifact_id;
    return;
  }

  if (artifact.artifact_type === "tts_chunk_audio") {
    const chunkId = artifact.metadata.tts_chunk_id;
    const segmentIds = artifact.metadata.segment_ids;
    const chunkRoute = manifest.audio_summary.tts_chunk_routes.find(
      (route) => route.tts_chunk_id === chunkId,
    );
    if (chunkRoute) {
      chunkRoute.artifact_id = artifact.artifact_id;
    }
    for (const segmentId of segmentIds) {
      const route = manifest.segment_routes.find(
        (item) => item.segment_id === segmentId,
      );
      if (route) {
        route.tts_artifact_id = artifact.artifact_id;
      }
    }
    if (!manifest.audio_summary.tts_chunk_artifact_ids.includes(artifact.artifact_id)) {
      manifest.audio_summary.tts_chunk_artifact_ids.push(artifact.artifact_id);
    }
    return;
  }

  if (artifact.artifact_type === "sfx_audio" || artifact.artifact_type === "sfx_selection") {
    if (!manifest.audio_summary.sfx_artifact_ids.includes(artifact.artifact_id)) {
      manifest.audio_summary.sfx_artifact_ids.push(artifact.artifact_id);
    }
    if (planTask.source_segment_id) {
      const route = manifest.segment_routes.find(
        (item) => item.segment_id === planTask.source_segment_id,
      );
      if (route && !route.sfx_artifact_ids.includes(artifact.artifact_id)) {
        route.sfx_artifact_ids.push(artifact.artifact_id);
      }
    }
    return;
  }

  if (artifact.artifact_type === "bgm_audio" || artifact.artifact_type === "bgm_selection") {
    const expectedLegacyPlacementId = `bgm_place_${planTask.task_id}`;
    const placement =
      manifest.audio_summary.bgm_placements.find(
        (item) => item.source_task_id === planTask.task_id,
      ) ??
      manifest.audio_summary.bgm_placements.find(
        (item) => item.bgm_placement_id === expectedLegacyPlacementId,
      );
    if (placement) {
      placement.artifact_id = artifact.artifact_id;
    }
    return;
  }

  if (!planTask.source_segment_id) {
    return;
  }

  const route = manifest.segment_routes.find(
    (item) => item.segment_id === planTask.source_segment_id,
  );
  if (!route) {
    return;
  }

  if (artifact.artifact_type === "image") {
    if (route.visual_route_type === "video_clip") {
      route.fallback_visual_artifact_id = artifact.artifact_id;
      route.readiness = "fallback_ready";
    } else {
      route.primary_visual_artifact_id = artifact.artifact_id;
      route.visual_route_type = route.motion_artifact_id
        ? "image_with_motion"
        : "image_only";
      route.readiness = "ready";
    }
  }

  if (artifact.artifact_type === "video") {
    route.primary_visual_artifact_id = artifact.artifact_id;
    route.visual_route_type = "video_clip";
    route.readiness = "ready";
  }

  if (artifact.artifact_type === "motion_recipe") {
    route.motion_artifact_id = artifact.artifact_id;
    if (route.primary_visual_artifact_id) {
      route.visual_route_type = "image_with_motion";
      route.readiness = "ready";
    }
  }
}

export async function runAssetsGeneration(input: RunAssetsGenerationInput) {
  const { db, project } = input;
  if (
    !db.voiceProfilePersistence.enabled &&
    project.storageRootDir.trim()
  ) {
    configureVoiceProfilePersistence(db, { rootDir: project.storageRootDir });
  }

  // Step 1: Check project has active asset plan
  if (!project.activeAssetPlanRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_asset_plan_missing",
      },
    };
  }

  const capturedAssetPlanRecordId = project.activeAssetPlanRecordId;

  // Step 2: Get the active asset plan record
  const assetPlanRecord = db.assetPlanRecords.get(capturedAssetPlanRecordId);
  if (!assetPlanRecord) {
    return {
      statusCode: 404,
      body: {
        error: "asset_plan_record_not_found",
      },
    };
  }

  // Step 3: Get storyboard record to extract segment IDs
  const storyboardRecord = db.storyboardRecords.get(
    assetPlanRecord.storyboardRecordId,
  );
  if (!storyboardRecord) {
    return {
      statusCode: 404,
      body: {
        error: "storyboard_record_not_found",
      },
    };
  }

  // Extract segment IDs from storyboard plan
  const storyboardPlan = storyboardRecord.planJson as { segments?: Array<{ segment_id: string }> };
  const segmentIds = storyboardPlan.segments?.map((s) => s.segment_id) ?? [];
  const normalizedTts = normalizeAssetPlanTtsForExecution({
    assetPlan: assetPlanRecord.planJson,
    segmentIds,
  });

  // Step 4: Resolve local global voice profile before manifest build
  const voiceResolution = await resolveVoiceProfile({
    db,
    requestedVoiceProfileId: input.voiceProfileId,
    assetPlan: normalizedTts.assetPlan,
  });

  // Step 5: Build execution options from resolved voice profile
  const executionOptionsResult = buildExecutionOptions({
    executionMode: input.executionMode,
    voiceProfileId: voiceResolution.voiceProfileId,
  });
  if (!executionOptionsResult.success) {
    return {
      statusCode: 422,
      body: {
        error: "assets_execution_options_invalid",
      },
    };
  }
  const executionOptions = executionOptionsResult.data;

  // Step 6: Build manifest
  let manifest = buildInitialAssetManifest({
    assetPlanRecordId: assetPlanRecord.id,
    assetPlan: normalizedTts.assetPlan,
    segmentIds,
    ttsChunkRoutes: normalizedTts.ttsChunkRoutes,
    executionOptions,
  });

  // Step 6a: Execution engine integration
  const runId = `assets_run_${db.generateId()}`;
  let executionManifestRecordId: string | null = null;

  if (executionOptions.execution_mode === "dry_run") {
    // dry_run: manifest-only, strip all placeholder artifacts
    manifest.artifacts = [];
  } else if (executionOptions.execution_mode === "auto_available") {
    // auto_available: execute with fake providers unless a real provider mode is explicit.
    const registry = buildProviderRegistry({
      db,
      providerMode: input.providerMode,
      dashscope: input.dashscope,
    });

    const tempManifestRecordId = `manifest_${db.generateId()}`;
    executionManifestRecordId = tempManifestRecordId;
    const engineResult = await executeAssetManifest({
      db,
      assetManifestRecordId: tempManifestRecordId,
      assetRunId: runId,
      manifest,
      registry,
      assetPlan: normalizedTts.assetPlan,
      projectStorageRootDir: project.storageRootDir,
    });

    manifest = engineResult.manifest;
  }

  // Step 7: Validate manifest (after engine execution for auto_available)
  const localValidation = await validateAssetsManifest({
    assetPlanRecordId: assetPlanRecord.id,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    topicPackageId: assetPlanRecord.topicPackageId,
    assetPlan: normalizedTts.assetPlan,
    manifest,
    projectStorageRootDir: project.storageRootDir,
  });

  // Step 8: Stale check — verify activeAssetPlanRecordId hasn't changed
  let staleSourceDetected = false;
  if (project.activeAssetPlanRecordId !== capturedAssetPlanRecordId) {
    staleSourceDetected = true;
  }

  if (staleSourceDetected) {
    const traceSummary = buildTraceSummary({
      runId,
      validationDecision: localValidation.decision,
      staleSourceDetected: true,
    });

    return {
      statusCode: 409,
      body: {
        error: "stale_assets_source",
        project_id: project.id,
        source_asset_plan_record_id: capturedAssetPlanRecordId,
        manifest,
        local_validation: localValidation,
        execution_state: {
          ...executionOptions,
          activated: false,
        },
        graph_trace_summary: traceSummary,
        runtime_diagnostics: null,
      },
    };
  }

  // Step 9: Create and save manifest record
  const executionState = {
    execution_mode: executionOptions.execution_mode,
    voice_profile_id: executionOptions.voice_profile_id,
    activated: true,
  };

  const traceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    staleSourceDetected: false,
  });

  const assetManifestRecord = await saveAssetManifestRecord(db, {
    projectId: project.id,
    topicPackageId: assetPlanRecord.topicPackageId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    assetPlanRecordId: assetPlanRecord.id,
    manifestJson: manifest,
    validationResultJson: localValidation,
    executionStateJson: executionState,
    graphTraceSummaryJson: traceSummary,
    runtimeDiagnosticsJson: null,
  });

  if (executionManifestRecordId) {
    for (const job of db.assetProviderJobRecords.values()) {
      if (
        job.assetManifestRecordId === executionManifestRecordId &&
        job.assetRunId === runId
      ) {
        job.assetManifestRecordId = assetManifestRecord.id;
        job.updatedAt = new Date();
      }
    }
  }

  // Step 9: Update project state
  project.activeAssetManifestRecordId = assetManifestRecord.id;
  project.activeComposeRecordId = null;
  project.activeRenderJobRecordId = null;

  // Step 10: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else {
    // "partial" or "blocked"
    project.status = "assets_blocked";
  }

  project.latestAssetsRunTraceJson = traceSummary as unknown as Record<string, unknown>;
  project.latestComposeRunTraceJson = null;
  project.latestRenderRunTraceJson = null;
  project.updatedAt = new Date();

  persistProjectRunArtifacts({
    project,
    phase: "assets",
    runId,
    traceSummary: traceSummary as unknown as Record<string, unknown>,
  });

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: assetManifestRecord.id,
      source_asset_plan_record_id: assetPlanRecord.id,
      manifest,
      local_validation: localValidation,
      execution_state: executionState,
      graph_trace_summary: traceSummary,
      runtime_diagnostics: null,
    },
  };
}

// ─── Manual Artifact Registration ───────────────────────────────────────────

export interface RegisterManualArtifactInput {
  db: DbClient;
  project: ProjectRecord;
  taskId: string;
  artifactType: string;
  fileUri: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export async function registerManualArtifact(input: RegisterManualArtifactInput) {
  const { db, project, taskId, artifactType, fileUri, mimeType, metadata } = input;

  // Step 1: Check active manifest exists
  if (!project.activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  // Step 2: Get the active manifest record
  const manifestRecord = await getAssetManifestRecordById(db, project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;

  // Step 3: Find the execution by task_id
  const execution = manifest.executions.find((e) => e.task_id === taskId);
  if (!execution) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 4: Get the asset plan to check MIME type
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (!assetPlanRecord) {
    return {
      statusCode: 404,
      body: { error: "asset_plan_record_not_found" },
    };
  }
  const assetPlan = assetPlanRecord.planJson as unknown as AssetPlan;
  const planTask = assetPlan.tasks.find((t) => t.task_id === taskId);
  if (!planTask) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  if (!planTask.manual_upload_policy.allowed && !planTask.manual_upload_policy.required) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_upload_not_allowed" },
    };
  }

  // Step 5: Validate MIME type
  const allowedTypes = planTask.manual_upload_policy.accepted_file_types;
  if (!allowedTypes.includes(mimeType)) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_upload_type_not_allowed" },
    };
  }

  const allowedArtifactTypes = allowedArtifactTypesForTask(planTask.task_type);
  if (!allowedArtifactTypes.includes(artifactType)) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_artifact_type_not_allowed" },
    };
  }

  // Step 6: Create new artifact
  const now = new Date().toISOString();
  const artifactId = `artifact_manual_${db.generateId()}`;

  const newArtifactCandidate = {
    artifact_id: artifactId,
    artifact_type: artifactType,
    origin: "manual_upload",
    file_uri: fileUri,
    created_at: now,
    metadata,
  };

  const parsedArtifact = AssetArtifactSchema.safeParse(newArtifactCandidate);
  if (!parsedArtifact.success) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_artifact_invalid" },
    };
  }
  const newArtifact = parsedArtifact.data;

  // Step 7: Add artifact to manifest
  manifest.artifacts.push(newArtifact);

  // Step 8: Add artifact_id to execution output_artifact_ids
  execution.output_artifact_ids.push(artifactId);

  // Step 9: Update execution status to completed and origin to manual_upload
  execution.status = "completed";
  execution.origin = "manual_upload";
  execution.completed_at = now;

  applyArtifactToManifestRoutes({
    manifest,
    planTask,
    artifact: newArtifact,
  });

  // Step 10: Re-run validator
  const localValidation = await validateAssetsManifest({
    assetPlanRecordId: manifestRecord.assetPlanRecordId,
    storyboardRecordId: manifestRecord.storyboardRecordId,
    scriptRecordId: manifestRecord.scriptRecordId,
    topicPackageId: manifestRecord.topicPackageId,
    assetPlan,
    manifest,
    projectStorageRootDir: project.storageRootDir,
  });

  // Step 11: Update manifest readiness
  manifest.readiness = localValidation.decision;

  // Step 12: Save updated manifest record
  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  manifestRecord.validationResultJson = localValidation as unknown as Record<string, unknown>;

  // Step 13: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else {
    project.status = "assets_blocked";
  }
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      manifest,
      local_validation: localValidation,
    },
  };
}

// ─── Accept Artifact ────────────────────────────────────────────────────────

export interface AcceptArtifactInput {
  db: DbClient;
  project: ProjectRecord;
  taskId: string;
  artifactId: string;
}

export async function acceptArtifact(input: AcceptArtifactInput) {
  const { db, project, taskId, artifactId } = input;

  // Step 1: Check active manifest exists
  if (!project.activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  // Step 2: Get the active manifest record
  const manifestRecord = await getAssetManifestRecordById(db, project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;

  // Step 3: Find the execution by task_id
  const execution = manifest.executions.find((e) => e.task_id === taskId);
  if (!execution) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 4: Verify the artifact_id exists in execution output_artifact_ids
  if (!execution.output_artifact_ids.includes(artifactId)) {
    return {
      statusCode: 404,
      body: { error: "artifact_not_found_in_execution" },
    };
  }

  // Step 5: Move the accepted artifact to the front of output_artifact_ids
  // This convention marks it as the "selected" artifact
  execution.output_artifact_ids = [
    artifactId,
    ...execution.output_artifact_ids.filter((id) => id !== artifactId),
  ];

  // Step 6: Update execution status to accepted
  execution.status = "accepted";

  // Step 7: Re-run validator to update readiness
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (assetPlanRecord) {
    const assetPlan = assetPlanRecord.planJson as unknown as AssetPlan;

    const localValidation = await validateAssetsManifest({
      assetPlanRecordId: manifestRecord.assetPlanRecordId,
      storyboardRecordId: manifestRecord.storyboardRecordId,
      scriptRecordId: manifestRecord.scriptRecordId,
      topicPackageId: manifestRecord.topicPackageId,
      assetPlan,
      manifest,
      projectStorageRootDir: project.storageRootDir,
    });

    manifest.readiness = localValidation.decision;
    manifestRecord.validationResultJson = localValidation as unknown as Record<string, unknown>;

    if (localValidation.decision === "ready_for_compose") {
      project.status = "assets_ready";
    } else {
      project.status = "assets_blocked";
    }
  }

  // Step 8: Save updated manifest record
  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      manifest,
    },
  };
}
