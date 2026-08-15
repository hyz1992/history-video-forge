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
  canonicalStringify,
  deterministicHash,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";
import { getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
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
import { preserveAssetsRunStorage, resolveAssetsRunStorage } from "./assets-file-storage.js";

type AssetsProviderMode = "fake" | "dashscope" | "dashscope_tts";
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
  asrModel?: string;
}

export interface RunAssetsGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  voiceProfileId: string;
  executionMode: string;
  enabledProviderTypes?: string[];
  /** Only process tasks that are not yet completed/accepted. */
  missingOnly?: boolean;
  /** Only process these specific task IDs. */
  taskIds?: string[];
}

/**
 * S2-2A 任务 6：判断 route 决策字段是否为"未决策"默认值。
 * 用于局部重试合并时决定是否用旧 route 的决策覆盖新默认值。
 */
function isDefaultRouteDecision(field: string, value: unknown): boolean {
  switch (field) {
    case "video_strategy":
      return value === "prefer_remotion";
    case "fallback_decision":
      return value === "none";
    case "route_events":
      return Array.isArray(value) && value.length === 0;
    case "notes":
      return Array.isArray(value) && value.length === 0;
    default:
      return value === undefined || value === null || value === "";
  }
}

function isRealArtifact(art: Record<string, unknown>): boolean {
  const uri = typeof art.file_uri === "string" ? art.file_uri : "";
  return uri.length > 0 && !uri.startsWith("planned://");
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
  enabledProviderTypes?: string[];
}) {
  return AssetExecutionOptionsSchema.safeParse({
    execution_mode: input.executionMode,
    voice_profile_id: input.voiceProfileId,
    enabled_provider_types: input.enabledProviderTypes ?? ["tts", "image", "video", "sfx", "bgm"],
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
    asrModel:
      input?.asrModel ??
      process.env.ALIYUN_DASHSCOPE_ASR_MODEL ??
      "qwen3-asr-flash-filetrans",
  };
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildProviderRegistry(input: { db: DbClient }) {
  // S2-2A 任务 6：provider 授权只来自后端 env（API key 存在时启用真实 provider），
  // 客户端不得指定 provider_mode / model / api key。
  const providerMode: AssetsProviderMode | undefined =
    process.env.ALIYUN_DASHSCOPE_API_KEY ? "dashscope" : undefined;
  if (providerMode === "dashscope") {
    const dashscope = readDashscopeConfig(undefined);
    const ttsProvider = createDashscopeTtsProvider({
      apiKey: dashscope.apiKey,
      baseUrl: dashscope.baseUrl,
      model: dashscope.ttsModel,
      format: dashscope.ttsFormat,
      sampleRate: dashscope.ttsSampleRate,
      db: input.db,
    });

    return createAssetProviderRegistry([
      ttsProvider,
      createLocalSubtitleProvider({
        dashscopeApiKey: dashscope.apiKey,
        dashscopeBaseUrl: dashscope.baseUrl,
        dashscopeAsrModel: dashscope.asrModel,
      }),
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
  const previousActiveAssetManifestRecordId = project.activeAssetManifestRecordId;
  if (!db.voiceProfilePersistence.enabled) {
    const voiceRoot = process.env.VITEST
      ? process.env.STORAGE_ROOT_DIR
      : project.storageRootDir;
    if (voiceRoot?.trim()) {
      configureVoiceProfilePersistence(db, { rootDir: voiceRoot });
    }
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

  // Write resolved voice profile ID back to the asset plan
  if (voiceResolution.voiceProfileId && voiceResolution.voiceProfileId !== (normalizedTts.assetPlan.tts_plan as Record<string, unknown>)?.voice_profile_id) {
    (normalizedTts.assetPlan.tts_plan as Record<string, unknown>).voice_profile_id = voiceResolution.voiceProfileId;
  }

  // Step 5: Build execution options from resolved voice profile
  const executionOptionsResult = buildExecutionOptions({
    executionMode: input.executionMode,
    voiceProfileId: voiceResolution.voiceProfileId,
    enabledProviderTypes: input.enabledProviderTypes,
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

  // Step 6a-0: S2-2A 任务 6——解析项目视频策略并写入每条 route。
  // 策略是项目冻结配置（客户端不可覆盖），决定 API 视频失败时严格阻塞或自动降级。
  let videoStrategy: GenerationConfigurationV1["video"]["strategy"] = "prefer_remotion";
  try {
    const configResult = await getProjectGenerationConfiguration(
      db,
      project.id,
      project.ownerId,
    );
    videoStrategy = configResult.configuration.video.strategy;
  } catch {
    return {
      statusCode: 500,
      body: { error: "assets_video_strategy_resolution_failed" },
    };
  }
  for (const route of manifest.segment_routes) {
    route.video_strategy = videoStrategy;
  }

  // Step 6a: For missing_only / task_ids modes, load the existing manifest
  // so we can merge new results into it rather than replacing everything.
  let existingManifest: Record<string, unknown> | null = null;
  if (input.missingOnly || (input.taskIds && input.taskIds.length > 0)) {
    if (project.activeAssetManifestRecordId) {
      const existingRecord = db.assetManifestRecords.get(project.activeAssetManifestRecordId);
      if (existingRecord) {
        existingManifest = existingRecord.manifestJson as Record<string, unknown>;
      }
    }
  }

  // Step 6b: Determine which tasks to actually execute in this run.
  const taskIdSet = input.taskIds ? new Set(input.taskIds) : null;
  if (input.missingOnly || taskIdSet) {
    const existingCompletedIds = new Set<string>();
    if (existingManifest) {
      const existingExecs = existingManifest.executions;
      if (Array.isArray(existingExecs)) {
        for (const exec of existingExecs) {
          if (exec && typeof exec === "object") {
            const s = (exec as Record<string, unknown>).status;
            if (s === "completed" || s === "accepted") {
              existingCompletedIds.add((exec as Record<string, unknown>).task_id as string);
            }
          }
        }
      }
    }

    manifest.executions = manifest.executions.filter((exec) => {
      // 显式请求的任务总是执行，不因之前已完成而跳过
      if (taskIdSet?.has(exec.task_id)) return true;
      if (existingCompletedIds.has(exec.task_id)) return false;
      if (taskIdSet) return false;
      return true;
    });
  }

  // Step 6b-ii: Before executing the filtered manifest, inject the old
  // manifest's artifacts, segment routes, and audio summary so that
  // dependency lookups (e.g. video_clip finding source image by segment)
  // work during provider execution.
  if (existingManifest) {
    const oldArtifacts = (Array.isArray(existingManifest.artifacts) ? existingManifest.artifacts : []) as Record<string, unknown>[];
    const oldRoutes = (Array.isArray(existingManifest.segment_routes) ? existingManifest.segment_routes : []) as Record<string, unknown>[];
    const oldAudio = (existingManifest.audio_summary ?? {}) as Record<string, unknown>;

    // Inject old artifacts that aren't already in the new manifest
    const newArtifactIds = new Set(manifest.artifacts.map(a => a.artifact_id));
    for (const a of oldArtifacts) {
      if (!newArtifactIds.has(a.artifact_id as string)) {
        manifest.artifacts.push(a as unknown as typeof manifest.artifacts[number]);
      }
    }

    // Merge old routes into the working manifest so dependency lookups
    // (e.g. video_clip finding source image by segment) work.
    // For segments NOT in the new manifest, add the whole old route.
    // For segments in BOTH, inject old visual-dependency fields so the
    // fresh (empty) route has source image/video references.
    const DEPENDENCY_ROUTE_FIELDS = new Set([
      "primary_visual_artifact_id", "fallback_visual_artifact_id",
      "motion_artifact_id", "image_artifact_id", "video_artifact_id",
    ]);
    // S2-2A 任务 6 整改：策略决策字段同样参与合并。新 route 是 builder 默认值时
    // （本轮未触碰该段/未产生新决策）保留旧 route 的决策与诊断，避免局部重试丢失。
    const STRATEGY_DECISION_FIELDS = new Set([
      "video_strategy", "fallback_decision", "route_events", "notes",
    ]);

    const existingNewRoutes = (Array.isArray((manifest as Record<string, unknown>).segment_routes)
      ? (manifest as Record<string, unknown>).segment_routes as Record<string, unknown>[]
      : []) as Record<string, unknown>[];
    const newRouteBySeg = new Map<string, Record<string, unknown>>();
    for (const r of existingNewRoutes) {
      const sid = r.segment_id as string | undefined;
      if (sid) newRouteBySeg.set(sid, r);
    }

    const mergedPreRoutes: Record<string, unknown>[] = [];
    const seenSegs = new Set<string>();

    for (const newRoute of existingNewRoutes) {
      const sid = newRoute.segment_id as string;
      const oldRoute = oldRoutes.find(r => r.segment_id === sid);
      if (oldRoute) {
        // Same segment exists in old manifest — inject dependency fields.
        const merged = { ...newRoute };
        for (const field of DEPENDENCY_ROUTE_FIELDS) {
          const oldVal = (oldRoute as Record<string, unknown>)[field];
          const newVal = (merged as Record<string, unknown>)[field];
          // Fill null / empty / undefined values from the old route.
          if (oldVal != null && oldVal !== "" && (newVal == null || newVal === "")) {
            (merged as Record<string, unknown>)[field] = oldVal;
          }
        }
        // 决策字段：新值为默认（未决策）时保留旧值；新值已有决策则不覆盖。
        for (const field of STRATEGY_DECISION_FIELDS) {
          const oldVal = (oldRoute as Record<string, unknown>)[field];
          const newVal = (merged as Record<string, unknown>)[field];
          if (isDefaultRouteDecision(field, newVal) && !isDefaultRouteDecision(field, oldVal)) {
            (merged as Record<string, unknown>)[field] = oldVal;
          }
        }
        mergedPreRoutes.push(merged);
      } else {
        mergedPreRoutes.push(newRoute);
      }
      seenSegs.add(sid);
    }

    // Add old routes for segments not in the new manifest at all.
    for (const r of oldRoutes) {
      if (!seenSegs.has(r.segment_id as string)) {
        mergedPreRoutes.push(r);
      }
    }

    (manifest as Record<string, unknown>).segment_routes = mergedPreRoutes;

    // Inject old audio summary as fallback context.
    // The initial manifest may have audio_summary present but with many
    // null fields. Merge the old values when new ones are missing.
    const currentAudio = (manifest as Record<string, unknown>).audio_summary as Record<string, unknown> | null | undefined;
    if (!currentAudio) {
      (manifest as Record<string, unknown>).audio_summary = oldAudio;
    } else {
      for (const [key, value] of Object.entries(oldAudio)) {
        if (
          (currentAudio[key] === null || currentAudio[key] === undefined) &&
          value !== null &&
          value !== undefined
        ) {
          currentAudio[key] = value;
        }
      }
    }
  }

  // Step 6c: Execution engine integration
  const runId = `assets_run_${db.generateId()}`;
  const runStorage = resolveAssetsRunStorage({
    projectStorageRootDir: project.storageRootDir,
    runId,
  });
  let executionManifestRecordId: string | null = null;

  // Set active pointer BEFORE execution so refresh during generation shows status
  const generatingManifestRecord = await saveAssetManifestRecord(db, {
    projectId: project.id,
    topicPackageId: assetPlanRecord.topicPackageId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    assetPlanRecordId: assetPlanRecord.id,
    manifestJson: manifest,
    validationResultJson: { stage: "assets_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
    executionStateJson: { generating: true, run_id: runId, activated: false },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });
  project.status = "assets_generating";
  await db.firstAggregateWriter?.syncProject(project);

  if (executionOptions.execution_mode === "dry_run") {
    manifest.artifacts = [];
  } else if (executionOptions.execution_mode === "auto_available") {
    const registry = buildProviderRegistry({ db });

    const tempManifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: assetPlanRecord.topicPackageId,
      scriptRecordId: assetPlanRecord.scriptRecordId,
      storyboardRecordId: assetPlanRecord.storyboardRecordId,
      assetPlanRecordId: assetPlanRecord.id,
      manifestJson: manifest,
      validationResultJson: { stage: "assets_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
      executionStateJson: { generating: true, run_id: runId, execution_staging: true, activated: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    executionManifestRecordId = tempManifestRecord.id;
    const engineResult = await executeAssetManifest({
      db,
      assetManifestRecordId: tempManifestRecord.id,
      assetRunId: runId,
      manifest,
      registry,
      assetPlan: normalizedTts.assetPlan,
      projectStorageRootDir: project.storageRootDir,
    });

    manifest = engineResult.manifest;
  }

  // Step 6d: Merge new results into the existing manifest at the
  // field and task level.  Visual fields update for touched segments;
  // audio / subtitle / SFX / BGM references are preserved from the
  // old manifest unless their provider tasks were actually re-executed.
  if (existingManifest) {
    const oldExecs = (Array.isArray(existingManifest.executions) ? existingManifest.executions : []) as Record<string, unknown>[];
    const oldArtifacts = (Array.isArray(existingManifest.artifacts) ? existingManifest.artifacts : []) as Record<string, unknown>[];
    const oldRoutes = (Array.isArray(existingManifest.segment_routes) ? existingManifest.segment_routes : []) as Record<string, unknown>[];
    const oldAudio = (existingManifest.audio_summary ?? {}) as Record<string, unknown>;
    const newExecTaskIds = new Set(manifest.executions.map(e => e.task_id));
    const newArtifactIds = new Set(manifest.artifacts.map(a => a.artifact_id));

    // Map: task_id → source_segment_id and task_type (segment tasks only)
    // Separate: task_id → task_type for ALL tasks (including global tts/subtitle)
    const planTasks = (normalizedTts.assetPlan.tasks ?? []) as Array<{
      task_id: string; source_segment_id: string | null; task_type: string;
    }>;
    const taskMeta = new Map<string, { segId: string; type: string }>();
    const taskTypeById = new Map<string, string>();
    for (const t of planTasks) {
      taskTypeById.set(t.task_id, t.task_type);
      if (t.source_segment_id) taskMeta.set(t.task_id, { segId: t.source_segment_id, type: t.task_type });
    }

    // Which segments and task types were touched by this run?
    const touchedSegments = new Set<string>();
    const touchedTaskTypes = new Set<string>();
    for (const tid of newExecTaskIds) {
      const meta = taskMeta.get(tid);
      if (meta) touchedSegments.add(meta.segId);
      // Always record the touched task type, even for global tasks (tts/subtitle)
      const ttype = taskTypeById.get(tid);
      if (ttype) touchedTaskTypes.add(ttype);
    }

    // ---- segment_routes: field-level merge for touched segments ----
    const VISUAL_ROUTE_FIELDS = new Set([
      "primary_visual_artifact_id", "visual_route_type",
      "image_route", "video_route", "readiness",
      "fallback_visual_artifact_id",
    ]);
    const oldRouteBySegment = new Map<string, Record<string, unknown>>();
    for (const r of oldRoutes) {
      const sid = r.segment_id as string | undefined;
      if (sid) oldRouteBySegment.set(sid, r);
    }

    const newRoutes = (Array.isArray((manifest as Record<string, unknown>).segment_routes)
      ? (manifest as Record<string, unknown>).segment_routes as Record<string, unknown>[]
      : []) as Record<string, unknown>[];
    const mergedRoutes: Record<string, unknown>[] = [];

    for (const newRoute of newRoutes) {
      const sid = newRoute.segment_id as string | undefined;
      const oldRoute = sid ? oldRouteBySegment.get(sid) : undefined;

      if (!oldRoute || !touchedSegments.has(sid!)) {
        // Untouched segment: keep old route, or use new if no old exists.
        mergedRoutes.push(oldRoute ?? newRoute);
      } else {
        // Touched segment: visual fields from new, everything else from old.
        const merged: Record<string, unknown> = { ...oldRoute };

        // Only switch to video_clip if a video artifact was actually produced
        // by this run.  Otherwise keep the old visual_route_type (image_with_motion).
        const newRouteType = newRoute.visual_route_type as string | undefined;
        if (newRouteType === "video_clip") {
          const hasNewVideoArtifact = manifest.artifacts.some(
            a => a.artifact_type === "video" && newExecTaskIds.has(
              // Find which execution produced this artifact
              manifest.executions.find(e => e.output_artifact_ids.includes(a.artifact_id))?.task_id ?? "",
            ),
          );
          if (hasNewVideoArtifact) {
            merged.visual_route_type = "video_clip";
          }
          // else: keep old visual_route_type (image_with_motion)
        } else {
          merged.visual_route_type = newRouteType ?? merged.visual_route_type;
        }

        for (const [key, value] of Object.entries(newRoute)) {
          if (VISUAL_ROUTE_FIELDS.has(key) || !(key in merged)) {
            // Skip visual_route_type — already handled above
            if (key === "visual_route_type") continue;
            merged[key] = value;
          }
        }
        mergedRoutes.push(merged);
      }
    }

    // ---- executions: old untouched + new touched ----
    const oldExecByTaskId = new Map<string, Record<string, unknown>>();
    for (const e of oldExecs) {
      const tid = e.task_id as string | undefined;
      if (tid) oldExecByTaskId.set(tid, e);
    }
    const mergedExecs: Record<string, unknown>[] = [
      ...oldExecs.filter(e => !newExecTaskIds.has(e.task_id as string)),
    ];
    for (const newExec of manifest.executions) {
      const oldExec = oldExecByTaskId.get(newExec.task_id);
      if (oldExec) {
        const oldIds = (Array.isArray(oldExec.output_artifact_ids) ? oldExec.output_artifact_ids : []) as string[];
        const newIds = (Array.isArray(newExec.output_artifact_ids) ? newExec.output_artifact_ids : []) as string[];
        const mergedIds = [...new Set([...oldIds, ...newIds])];
        (newExec as Record<string, unknown>).output_artifact_ids = mergedIds;
      }
      mergedExecs.push(newExec as unknown as Record<string, unknown>);
    }

    // ---- artifacts: prefer old when it has a real file_uri ----
    const oldArtById = new Map<string, Record<string, unknown>>();
    for (const a of oldArtifacts) {
      oldArtById.set(a.artifact_id as string, a);
    }
    const mergedArtifacts = [
      ...oldArtifacts.filter(a => !newArtifactIds.has(a.artifact_id as string)),
    ];
    for (const newArt of manifest.artifacts) {
      const oldArt = oldArtById.get(newArt.artifact_id as string);
      if (oldArt && isRealArtifact(oldArt) && !isRealArtifact(newArt as Record<string, unknown>)) {
        // Old artifact has a real file; new one is a planned placeholder — keep old.
        mergedArtifacts.push(oldArt);
      } else {
        mergedArtifacts.push(newArt as unknown as Record<string, unknown>);
      }
    }

    // ---- audio_summary: field-level merge based on touched task types ----
    const newAudio = ((manifest as Record<string, unknown>).audio_summary ?? {}) as Record<string, unknown>;
    const AUDIO_FIELDS_BY_TASK_TYPE: Record<string, string[]> = {
      tts_audio: ["tts_merged_artifact_id", "tts_total_duration_sec", "tts_chunk_artifact_ids", "tts_chunk_routes"],
      subtitle_track: ["subtitle_artifact_id"],
      bgm_cue: ["bgm_placements"],
      sfx_cue: ["sfx_artifact_ids"],
    };
    const mergedAudio: Record<string, unknown> = { ...oldAudio };
    for (const [taskType, fields] of Object.entries(AUDIO_FIELDS_BY_TASK_TYPE)) {
      if (touchedTaskTypes.has(taskType)) {
        for (const f of fields) {
          if (f in newAudio) mergedAudio[f] = newAudio[f];
        }
      }
    }
    // For untouched audio fields, keep old values (already in mergedAudio from spread).

    manifest.executions = mergedExecs as typeof manifest.executions;
    manifest.artifacts = mergedArtifacts as typeof manifest.artifacts;
    (manifest as Record<string, unknown>).segment_routes = mergedRoutes;
    (manifest as Record<string, unknown>).audio_summary = mergedAudio;
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
  manifest.readiness = localValidation.decision;

  // Step 8: Stale check — verify activeAssetPlanRecordId hasn't changed
  let staleSourceDetected = false;
  if (project.activeAssetPlanRecordId !== capturedAssetPlanRecordId) {
    staleSourceDetected = true;
  }

  if (staleSourceDetected) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    // Clean up generating state — delete placeholder record, don't leave dirty state
    db.assetManifestRecords.delete(generatingManifestRecord.id);
    project.activeAssetManifestRecordId = previousActiveAssetManifestRecordId;
    project.status = "asset_plan_ready";
    project.updatedAt = new Date();
    await db.firstAggregateWriter?.syncProject(project);
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
  // S2-2A 任务 6 整改：保留 run_id，accept-fallback 依赖它校验当前运行。
  const executionState = {
    execution_mode: executionOptions.execution_mode,
    voice_profile_id: executionOptions.voice_profile_id,
    run_id: runId,
    activated: true,
  };

  const traceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    staleSourceDetected: false,
  });

  let assetManifestRecord;
  try {
    assetManifestRecord = await saveAssetManifestRecord(db, {
      id: generatingManifestRecord.id,
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
  } catch (error) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    throw error;
  }

  if (executionManifestRecordId) try {
    for (const job of db.assetProviderJobRecords.values()) {
      if (job.assetManifestRecordId !== executionManifestRecordId || job.assetRunId !== runId) continue;
      job.assetManifestRecordId = assetManifestRecord.id;
      job.updatedAt = new Date();
      const projectOwnerId = db.projects.get(assetManifestRecord.projectId)?.ownerId ?? "system";
      const persisted = await db.thirdAggregateWriter?.saveProviderJob(job, projectOwnerId) ?? job;
      if (persisted.id !== job.id) db.assetProviderJobRecords.delete(job.id);
      db.assetProviderJobRecords.set(persisted.id, persisted);
    }
  } catch (error) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    throw error;
  }

  // Step 10: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else if (localValidation.decision === "partial") {
    project.status = "assets_partial";
  } else {
    project.status = "assets_blocked";
  }

  project.latestAssetsRunTraceJson = traceSummary as unknown as Record<string, unknown>;
  project.latestComposeRunTraceJson = null;
  project.latestRenderRunTraceJson = null;
  project.updatedAt = new Date();
  try {
    await db.thirdAggregateWriter?.activateAssetManifest(project, assetManifestRecord);
  } catch (error) {
    await preserveAssetsRunStorage(runStorage).catch(() => undefined);
    project.activeAssetManifestRecordId = previousActiveAssetManifestRecordId;
    project.status = previousActiveAssetManifestRecordId ? "assets_ready" : "asset_plan_ready";
    await db.firstAggregateWriter?.syncProject(project);
    throw error;
  }
  project.activeAssetManifestRecordId = assetManifestRecord.id;
  project.activeComposeRecordId = null;
  project.activeRenderJobRecordId = null;
  project.activePublishPackageRecordId = null;

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
  const artifactId = `artifact_manual_${db.generateId()}_${Date.now().toString(36)}`;

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

  // Step 8: Add artifact_id to execution output_artifact_ids (new ID at front = current selection)
  execution.output_artifact_ids = [
    artifactId,
    ...execution.output_artifact_ids,
  ];

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
  } else if (localValidation.decision === "partial") {
    project.status = "assets_partial";
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

export interface AcceptSegmentFallbackInput {
  db: DbClient;
  project: ProjectRecord;
  /** accept-fallback 请求路径中的 run id（用于审计与防过期校验）。 */
  runId: string;
  segmentId: string;
  /** 客户端声明的预期 run id；与 manifest 记录的执行 run 不一致时拒绝。 */
  expectedRunId: string;
  /** 客户端看到的 manifest 指纹（CAS）；与当前记录不一致时拒绝并发覆盖。 */
  expectedVersion: string;
}

/** 计算 manifest 内容指纹，作为 accept-fallback 的并发版本（CAS）。 */
export function manifestFallbackVersion(manifest: AssetManifest): string {
  return deterministicHash(canonicalStringify(manifest));
}

/**
 * S2-2A 任务 6：用户显式接受严格模式（all_api_video）失败段的 Remotion fallback。
 * - 仅允许对 blocked_waiting_user 状态的段接受；
 * - 必须携带预期 run id，防止对过期失败接受 fallback；
 * - 激活 image-with-motion 前校验同段 anchor 与 Remotion cue 齐备（不能伪装成功）；
 * - 写 fallback_accepted 事件；原运行快照（旧 manifest 记录）保持不变，
 *   只更新当前可变执行视图（active manifest 记录）。
 */
export async function acceptSegmentFallback(
  input: AcceptSegmentFallbackInput,
) {
  const { db, project, runId, segmentId, expectedRunId, expectedVersion } = input;

  if (!project.activeAssetManifestRecordId) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }
  const manifestRecord = await getAssetManifestRecordById(
    db,
    project.activeAssetManifestRecordId,
  );
  if (!manifestRecord) {
    return { statusCode: 409, body: { error: "active_assets_missing" } };
  }

  // 防过期：请求必须针对当前执行 run
  const executionRunId =
    typeof manifestRecord.executionStateJson?.run_id === "string"
      ? manifestRecord.executionStateJson.run_id
      : null;
  if (runId !== expectedRunId || executionRunId !== expectedRunId) {
    return {
      statusCode: 409,
      body: { error: "assets_fallback_run_mismatch" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;
  // CAS：客户端必须基于当前 manifest 指纹接受，防止并发覆盖。
  if (manifestFallbackVersion(manifest) !== expectedVersion) {
    return {
      statusCode: 409,
      body: { error: "assets_fallback_version_mismatch" },
    };
  }
  const route = manifest.segment_routes.find(
    (item) => item.segment_id === segmentId,
  );
  if (!route) {
    return { statusCode: 404, body: { error: "segment_route_not_found" } };
  }
  if (route.readiness !== "blocked_waiting_user") {
    return {
      statusCode: 409,
      body: { error: "segment_fallback_not_awaiting_decision" },
    };
  }

  // 激活前必须同段 anchor + Remotion cue 齐备，且 artifact 真实存在、类型正确，
  // 否则不能伪装 ready。
  const anchorArtifactId =
    route.fallback_visual_artifact_id ?? route.primary_visual_artifact_id;
  const anchorArtifact = anchorArtifactId
    ? manifest.artifacts.find((item) => item.artifact_id === anchorArtifactId)
    : undefined;
  const motionArtifact = route.motion_artifact_id
    ? manifest.artifacts.find((item) => item.artifact_id === route.motion_artifact_id)
    : undefined;
  if (
    !anchorArtifact ||
    anchorArtifact.artifact_type !== "image" ||
    !motionArtifact ||
    motionArtifact.artifact_type !== "motion_recipe"
  ) {
    return {
      statusCode: 409,
      body: { error: "segment_fallback_incomplete" },
    };
  }

  route.visual_route_type = "image_with_motion";
  route.primary_visual_artifact_id = anchorArtifactId;
  route.fallback_decision = "user_accepted";
  route.route_events = [
    ...(route.route_events ?? []),
    {
      event_type: "fallback_accepted",
      occurred_at: new Date().toISOString(),
      reason_code: "user_accept_fallback",
    },
  ];
  route.readiness = "ready";
  route.notes = [
    ...route.notes,
    `[strategy] user accepted Remotion fallback for segment ${segmentId} (run ${runId})`,
  ];

  // 重跑 validator 更新 manifest 就绪度与项目状态
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (assetPlanRecord) {
    const localValidation = await validateAssetsManifest({
      assetPlanRecordId: manifestRecord.assetPlanRecordId,
      storyboardRecordId: manifestRecord.storyboardRecordId,
      scriptRecordId: manifestRecord.scriptRecordId,
      topicPackageId: manifestRecord.topicPackageId,
      assetPlan: assetPlanRecord.planJson as unknown as AssetPlan,
      manifest,
      projectStorageRootDir: project.storageRootDir,
    });
    manifest.readiness = localValidation.decision;
    manifestRecord.validationResultJson =
      localValidation as unknown as Record<string, unknown>;
    if (localValidation.decision === "ready_for_compose") {
      project.status = "assets_ready";
    } else if (localValidation.decision === "partial") {
      project.status = "assets_partial";
    } else {
      project.status = "assets_blocked";
    }
  }

  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  // 在 execution state 追加可审计事件（fallback_accepted run event）
  const executionState = {
    ...(manifestRecord.executionStateJson ?? {}),
    events: [
      ...(Array.isArray(manifestRecord.executionStateJson?.events)
        ? manifestRecord.executionStateJson.events
        : []),
      {
        event_type: "fallback_accepted",
        segment_id: segmentId,
        run_id: runId,
        occurred_at: new Date().toISOString(),
      },
    ],
  };
  manifestRecord.executionStateJson = executionState;
  project.updatedAt = new Date();

  // S2-2A 任务 6 整改：接受结果必须持久化（Prisma writer + 项目同步），
  // 只改内存会在重启后丢失。
  const projectOwnerId = db.projects.get(project.id)?.ownerId ?? "system";
  await db.thirdAggregateWriter?.saveAssetManifest(manifestRecord, projectOwnerId);
  await db.firstAggregateWriter?.syncProject(project);

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      segment_id: segmentId,
      version: manifestFallbackVersion(manifest),
      manifest,
    },
  };
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
    } else if (localValidation.decision === "partial") {
      project.status = "assets_partial";
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
