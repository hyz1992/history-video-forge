/**
 * Asset Manifest Builder — builds an initial AssetManifest from an AssetPlan.
 *
 * This is a pure-function skeleton: no external provider calls, no file I/O.
 * It creates executions for every task, inline artifacts for motion recipes,
 * placeholder TTS chunk artifacts, segment routes, and an audio summary.
 */

import type {
  AssetArtifact,
  AssetExecutionOptions,
  AssetManifest,
  AssetPlan,
  AssetTaskExecution,
  AssetAudioSummary,
  BgmPlacement,
  SegmentAssetRoute,
  TtsChunkRoute,
} from "../../../../shared/src/index.js";
import { readBgmCueParams } from "./audio-cue-params.js";
import { isProviderTypeEnabled } from "./provider-type-map.js";

// ─── Input ────────────────────────────────────────────────────────────────────

export interface BuildManifestInput {
  assetPlanRecordId: string;
  assetPlan: AssetPlan;
  /** Storyboard segment IDs, needed for TTS chunk-to-segment order alignment. */
  segmentIds: string[];
  /** Optional precomputed TTS chunk routes, used when execution normalizes chunks. */
  ttsChunkRoutes?: TtsChunkRoute[];
  executionOptions?: AssetExecutionOptions;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string, taskId: string): string {
  return `${prefix}_${taskId}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Determine the execution status for a task based on its properties. */
function resolveInitialStatus(
  task: AssetPlan["tasks"][number],
  enabledProviderTypes: string[] | undefined,
): AssetTaskExecution["status"] {
  // Manual-upload-required tasks start as waiting_manual_upload
  if (task.manual_upload_policy.required) {
    return "waiting_manual_upload";
  }
  // When provider type is disabled and task allows manual upload, set waiting_manual_upload
  if (!isProviderTypeEnabled(task.task_type, enabledProviderTypes) && task.manual_upload_policy.allowed) {
    return "waiting_manual_upload";
  }
  return "planned";
}

/** Determine the execution origin for a task. */
function resolveOrigin(
  task: AssetPlan["tasks"][number],
  enabledProviderTypes: string[] | undefined,
): AssetTaskExecution["origin"] {
  if (task.manual_upload_policy.required) {
    return "manual_upload";
  }
  // When provider type is disabled and task allows manual upload, origin is manual_upload
  if (!isProviderTypeEnabled(task.task_type, enabledProviderTypes) && task.manual_upload_policy.allowed) {
    return "manual_upload";
  }
  // Motion recipes are inline (local)
  if (task.task_type === "render_motion_cue") {
    return "local";
  }
  return "provider";
}

// ─── Build executions ─────────────────────────────────────────────────────────

function buildExecutions(
  tasks: AssetPlan["tasks"],
  enabledProviderTypes: string[] | undefined,
): AssetTaskExecution[] {
  return tasks.map((task) => ({
    execution_id: generateId("exec", task.task_id),
    task_id: task.task_id,
    task_type: task.task_type,
    status: resolveInitialStatus(task, enabledProviderTypes),
    origin: resolveOrigin(task, enabledProviderTypes),
    started_at: null,
    completed_at: null,
    provider_id: task.provider_hint,
    attempts: 0,
    output_artifact_ids: [] as string[],
    notes: [] as string[],
  }));
}

// ─── Build inline artifacts ───────────────────────────────────────────────────

function buildMotionRecipeArtifacts(
  tasks: AssetPlan["tasks"],
  executions: AssetTaskExecution[],
): { artifacts: AssetArtifact[]; executionUpdates: Map<string, string[]> } {
  const artifacts: AssetArtifact[] = [];
  const executionUpdates = new Map<string, string[]>();

  for (const task of tasks) {
    if (task.task_type !== "render_motion_cue") continue;

    const artifactId = generateId("artifact_motion", task.task_id);
    const recipeType =
      (task.parameters["recipe_type"] as string | undefined) ?? "unknown";

    artifacts.push({
      artifact_id: artifactId,
      artifact_type: "motion_recipe",
      origin: "inline",
      file_uri: `inline://motion-recipe/${task.task_id}`,
      created_at: nowISO(),
      metadata: {
        recipe_type: recipeType,
        // source_image_artifact_id will be resolved when the upstream image
        // task completes; placeholder satisfies schema's min(1) constraint
        source_image_artifact_id: `pending-image-for-${task.task_id}`,
        parameters: task.parameters,
      },
    });

    const exec = executions.find((e) => e.task_id === task.task_id);
    if (exec) {
      executionUpdates.set(
        exec.execution_id,
        [...(executionUpdates.get(exec.execution_id) ?? []), artifactId],
      );
    }
  }

  return { artifacts, executionUpdates };
}

// ─── Build TTS chunk artifacts ────────────────────────────────────────────────

function buildTtsChunkArtifacts(
  ttsPlan: AssetPlan["tts_plan"],
  segmentIds: string[],
  voiceProfileId: string,
  explicitChunkRoutes?: TtsChunkRoute[],
): {
  artifacts: AssetArtifact[];
  chunkRoutes: TtsChunkRoute[];
  executionUpdates: Map<string, string[]>;
  ttsTaskId: string | null;
} {
  const artifacts: AssetArtifact[] = [];
  const chunkRoutes: TtsChunkRoute[] = [];
  const executionUpdates = new Map<string, string[]>();

  for (let i = 0; i < ttsPlan.chunks.length; i++) {
    const chunk = ttsPlan.chunks[i]!;
    const segmentId = i < segmentIds.length ? segmentIds[i]! : null;
    const explicitRoute = explicitChunkRoutes?.find(
      (route) => route.tts_chunk_id === chunk.chunk_id,
    );
    const routeSegmentIds =
      explicitRoute?.segment_ids ?? (segmentId ? [segmentId] : []);
    const artifactId = generateId("artifact_tts_chunk", chunk.chunk_id);

    // Build the chunk route — maps TTS chunk to segment
    chunkRoutes.push({
      tts_chunk_id: chunk.chunk_id,
      artifact_id: artifactId,
      segment_ids: routeSegmentIds,
      script_excerpt: explicitRoute?.script_excerpt ?? chunk.script_excerpt,
    });

    // Build a placeholder TTS chunk artifact
    // These are "planned" artifacts — the file doesn't exist yet.
    // The status reflects that TTS hasn't been generated yet.
    artifacts.push({
      artifact_id: artifactId,
      artifact_type: "tts_chunk_audio",
      origin: "provider",
      file_uri: `planned://tts-chunk/${chunk.chunk_id}`,
      created_at: nowISO(),
      metadata: {
        duration_sec: chunk.estimated_duration_sec,
        voice_profile_id: voiceProfileId,
        tts_chunk_id: chunk.chunk_id,
        segment_ids: routeSegmentIds,
        script_excerpt: chunk.script_excerpt,
      },
    });
  }

  return {
    artifacts,
    chunkRoutes,
    executionUpdates,
    ttsTaskId: null, // Will be wired by caller
  };
}

// ─── Build segment routes ─────────────────────────────────────────────────────

interface VisualTaskInfo {
  segmentId: string;
  hasImage: boolean;
  hasVideo: boolean;
  hasMotion: boolean;
  imageArtifactId: string | null;
  videoArtifactId: string | null;
  motionArtifactId: string | null;
}

function buildSegmentRoutes(
  tasks: AssetPlan["tasks"],
  segmentIds: string[],
  artifacts: AssetArtifact[],
  chunkCountMismatch: boolean,
  chunkRoutes: TtsChunkRoute[],
): SegmentAssetRoute[] {
  // Collect visual task info per segment
  const visualMap = new Map<string, VisualTaskInfo>();

  for (const segId of segmentIds) {
    visualMap.set(segId, {
      segmentId: segId,
      hasImage: false,
      hasVideo: false,
      hasMotion: false,
      imageArtifactId: null,
      videoArtifactId: null,
      motionArtifactId: null,
    });
  }

  // Check image tasks — these are planned (no real artifact yet), use placeholder IDs
  for (const task of tasks) {
    if (!task.source_segment_id) continue;
    const info = visualMap.get(task.source_segment_id);
    if (!info) continue;

    if (task.task_type === "image_still") {
      info.hasImage = true;
      info.imageArtifactId = generateId("artifact_img", task.task_id);
    } else if (task.task_type === "video_clip") {
      info.hasVideo = true;
      info.videoArtifactId = generateId("artifact_video", task.task_id);
    } else if (task.task_type === "render_motion_cue") {
      info.hasMotion = true;
      info.motionArtifactId = generateId("artifact_motion", task.task_id);
    }
  }

  // Build routes
  const routes: SegmentAssetRoute[] = [];

  for (const segId of segmentIds) {
    const info = visualMap.get(segId)!;
    const chunkRoute = chunkRoutes.find((cr) => cr.segment_ids.includes(segId));

    let visualRouteType: SegmentAssetRoute["visual_route_type"] = "missing";
    let primaryVisualArtifactId: string | null = null;
    let motionArtifactId: string | null = null;
    let readiness: SegmentAssetRoute["readiness"] = "blocked";

    if (info.hasVideo) {
      // Video takes priority, but since no real artifact exists, mark as blocked
      visualRouteType = "video_clip";
      primaryVisualArtifactId = null; // no real artifact
      readiness = "blocked";
    } else if (info.hasImage && info.hasMotion) {
      visualRouteType = "image_with_motion";
      primaryVisualArtifactId = null; // no real image artifact yet
      motionArtifactId = info.motionArtifactId;
      // Motion recipe is inline (exists), but image doesn't exist yet
      readiness = "blocked";
    } else if (info.hasImage) {
      visualRouteType = "image_only";
      primaryVisualArtifactId = null;
      readiness = "blocked";
    }

    // If chunk count mismatch, mark route as blocked
    if (chunkCountMismatch) {
      readiness = "blocked";
    }

    routes.push({
      segment_id: segId,
      tts_artifact_id: chunkRoute?.artifact_id ?? null,
      subtitle_artifact_id: null,
      primary_visual_artifact_id: primaryVisualArtifactId,
      visual_route_type: visualRouteType,
      motion_artifact_id: motionArtifactId,
      fallback_visual_artifact_id: null,
      sfx_artifact_ids: [],
      bgm_placement_ids: [],
      readiness,
      notes: [],
      // S2-2A 任务 6：策略由 run.service 按项目配置覆写，此处给缺省值
      video_strategy: "prefer_remotion",
      fallback_decision: "none",
      route_events: [],
    });
  }

  return routes;
}

// ─── Build BGM placements ─────────────────────────────────────────────────────

function buildBgmPlacements(tasks: AssetPlan["tasks"]): BgmPlacement[] {
  const placements: BgmPlacement[] = [];

  for (const task of tasks) {
    if (task.task_type !== "bgm_cue") continue;

    const params = readBgmCueParams(task.parameters);
    const segmentIds =
      params.scope === "global"
        ? []
        : params.segmentIds.length > 0
          ? params.segmentIds
          : task.source_segment_id
            ? [task.source_segment_id]
            : [];

    placements.push({
      bgm_placement_id: generateId("bgm_place", task.task_id),
      source_task_id: task.task_id,
      scope: params.scope,
      artifact_id: null, // No BGM audio artifact yet
      start_policy: params.scope === "global" ? "timeline_start" : "segment_start",
      end_policy:
        params.scope === "global"
          ? "timeline_end"
          : params.scope === "segment"
            ? "segment_end"
            : "fade_out_after_span",
      segment_ids: segmentIds,
      volume: params.volume,
      fade_in_sec: params.fadeInSec,
      fade_out_sec: params.fadeOutSec,
    });
  }

  return placements;
}

// ─── Build audio summary ──────────────────────────────────────────────────────

function buildAudioSummary(
  plan: AssetPlan,
  chunkRoutes: TtsChunkRoute[],
  bgmPlacements: BgmPlacement[],
  voiceProfileId: string,
): AssetAudioSummary {
  return {
    voice_profile_id: voiceProfileId,
    tts_total_duration_sec: plan.tts_plan.estimated_total_duration_sec,
    tts_chunk_artifact_ids: chunkRoutes
      .map((cr) => cr.artifact_id)
      .filter((id): id is string => id !== null),
    tts_chunk_routes: chunkRoutes,
    tts_merged_artifact_id: null,
    subtitle_artifact_id: null,
    bgm_placements: bgmPlacements,
    sfx_artifact_ids: [],
  };
}

// ─── Determine overall readiness ──────────────────────────────────────────────

function determineReadiness(
  executions: AssetTaskExecution[],
  routes: SegmentAssetRoute[],
): AssetManifest["readiness"] {
  // If any execution is still planned/waiting (not completed), it's blocked
  const hasIncompleteExecutions = executions.some(
    (e) => e.status !== "completed" && e.status !== "skipped_with_fallback",
  );

  if (hasIncompleteExecutions) {
    // Check if it's partial (some things done) vs fully blocked
    const hasCompletedAny = executions.some(
      (e) => e.status === "completed",
    );
    return hasCompletedAny ? "partial" : "blocked";
  }

  // Check segment routes
  const allRoutesReady = routes.every((r) => r.readiness === "ready");
  if (!allRoutesReady) {
    return "blocked";
  }

  return "ready_for_compose";
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildInitialAssetManifest(input: BuildManifestInput): AssetManifest {
  const { assetPlanRecordId, assetPlan, segmentIds } = input;
  const executionOptions: AssetExecutionOptions = input.executionOptions ?? {
    execution_mode: "auto_available",
    voice_profile_id: assetPlan.tts_plan.voice_profile_id,
    enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
    allow_manual_placeholders: false,
  };
  const voiceProfileId =
    executionOptions.voice_profile_id ?? assetPlan.tts_plan.voice_profile_id;

  // ── Executions ───────────────────────────────────────────────────────────
  const executions = buildExecutions(assetPlan.tasks, executionOptions.enabled_provider_types);

  // ── Inline artifacts: motion recipes ─────────────────────────────────────
  const { artifacts: motionArtifacts, executionUpdates: motionUpdates } =
    buildMotionRecipeArtifacts(assetPlan.tasks, executions);

  // Apply motion artifact IDs to executions
  for (const exec of executions) {
    const updates = motionUpdates.get(exec.execution_id);
    if (updates) {
      exec.output_artifact_ids.push(...updates);
      exec.status = "completed";
      exec.completed_at = nowISO();
    }
  }

  // ── TTS chunk artifacts and routes ───────────────────────────────────────
  const chunkCountMismatch =
    input.ttsChunkRoutes
      ? !segmentIds.every((segmentId) =>
          input.ttsChunkRoutes!.some((route) =>
            route.segment_ids.includes(segmentId),
          ),
        )
      : assetPlan.tts_plan.chunks.length !== segmentIds.length;

  const { artifacts: ttsArtifacts, chunkRoutes } = buildTtsChunkArtifacts(
    assetPlan.tts_plan,
    segmentIds,
    voiceProfileId,
    input.ttsChunkRoutes,
  );

  // Wire TTS chunk artifacts to the tts_audio execution
  const ttsExecution = executions.find((e) => e.task_type === "tts_audio");
  if (ttsExecution) {
    for (const artifact of ttsArtifacts) {
      ttsExecution.output_artifact_ids.push(artifact.artifact_id);
    }
  }

  // ── Segment routes ───────────────────────────────────────────────────────
  const allArtifactsSoFar = [...motionArtifacts, ...ttsArtifacts];
  const segmentRoutes = buildSegmentRoutes(
    assetPlan.tasks,
    segmentIds,
    allArtifactsSoFar,
    chunkCountMismatch,
    chunkRoutes,
  );

  // ── BGM placements ───────────────────────────────────────────────────────
  const bgmPlacements = buildBgmPlacements(assetPlan.tasks);

  // ── Audio summary ────────────────────────────────────────────────────────
  const audioSummary = buildAudioSummary(
    assetPlan,
    chunkRoutes,
    bgmPlacements,
    voiceProfileId,
  );

  // ── Combine all artifacts ────────────────────────────────────────────────
  const allArtifacts: AssetArtifact[] = [...ttsArtifacts, ...motionArtifacts];

  // ── Overall readiness ────────────────────────────────────────────────────
  const readiness = determineReadiness(executions, segmentRoutes);

  // ── Assemble manifest ────────────────────────────────────────────────────
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: assetPlanRecordId,
    source_storyboard_record_id: assetPlan.source_storyboard_record_id,
    source_script_record_id: assetPlan.source_script_record_id,
    execution_options: executionOptions,
    executions,
    artifacts: allArtifacts,
    audio_summary: audioSummary,
    segment_routes: segmentRoutes,
    readiness,
    notes: chunkCountMismatch
      ? ["tts_chunk_segment_count_mismatch: TTS chunks and storyboard segments differ in count"]
      : [],
  };
}
