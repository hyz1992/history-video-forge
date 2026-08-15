/**
 * Asset execution engine — iterates manifest executions in dependency order,
 * selects registered provider adapters, and produces artifacts.
 */

import { AssetArtifact } from "../../../../shared/src/index.js";
import type {
  AssetManifest,
  AssetPlan,
  AssetTaskExecution,
} from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import { createAssetProviderJobRecord } from "./asset-provider-job.repository.js";
import type {
  AssetProviderAdapter,
  AssetProviderContext,
} from "./assets-provider-adapter.js";
import type { AssetProviderRegistry } from "./assets-provider-registry.js";

// ─── Priority map ──────────────────────────────────────────────────────────

const TASK_TYPE_PRIORITY: Record<AssetTaskExecution["task_type"], number> = {
  tts_audio: 0,
  subtitle_track: 1,
  image_still: 2,
  video_clip: 3,
  sfx_cue: 4,
  bgm_cue: 5,
  render_motion_cue: 6,
};

// ─── Terminal statuses ─────────────────────────────────────────────────────

const TERMINAL_STATUSES: ReadonlySet<AssetTaskExecution["status"]> = new Set([
  "completed",
  "failed",
  "skipped_with_fallback",
  "accepted",
  "rejected",
]);

// ─── Input / Output ────────────────────────────────────────────────────────

export interface ExecuteAssetManifestInput {
  db: DbClient;
  assetManifestRecordId: string;
  assetRunId: string;
  manifest: AssetManifest;
  registry: AssetProviderRegistry;
  assetPlan: AssetPlan;
  projectStorageRootDir: string;
}

export interface ExecuteAssetManifestResult {
  manifest: AssetManifest;
}

// ─── Engine ────────────────────────────────────────────────────────────────

export async function executeAssetManifest(
  input: ExecuteAssetManifestInput,
): Promise<ExecuteAssetManifestResult> {
  const {
    db,
    assetManifestRecordId,
    assetRunId,
    manifest,
    registry,
    assetPlan,
    projectStorageRootDir,
  } = input;

  // Work on a deep-enough copy so the original is not mutated.
  const manifestCopy: AssetManifest = structuredClone(manifest);

  // Sort executions by task type priority.
  const sorted = [...manifestCopy.executions].sort(
    (a, b) => TASK_TYPE_PRIORITY[a.task_type] - TASK_TYPE_PRIORITY[b.task_type],
  );

  for (const execution of sorted) {
    // 1. Skip terminal executions.
    if (TERMINAL_STATUSES.has(execution.status)) continue;

    // 2. Check dependency readiness.
    if (!areDependenciesSatisfied(execution, manifestCopy)) continue;

    // 3. Resolve plan task.
    const planTask = assetPlan.tasks.find(
      (t) => t.task_id === execution.task_id,
    );
    if (!planTask) {
      execution.status = "failed";
      execution.notes = [
        ...execution.notes,
        `[engine] no matching plan task for task_id=${execution.task_id}`,
      ];
      continue;
    }

    // 4. Select adapter.
    // S2-2A 任务 6：all_remotion 永不调用视频 provider——即使客户端构造了
    // video task，也按 manifest 中持久化的策略跳过，不创建 provider job。
    if (execution.task_type === "video_clip") {
      const route = findSegmentRoute(manifestCopy, planTask.source_segment_id);
      if (route && (route.video_strategy ?? "prefer_remotion") === "all_remotion") {
        execution.status = "skipped_with_fallback";
        execution.notes = [
          ...execution.notes,
          "[strategy] all_remotion 段不调用视频 provider",
        ];
        continue;
      }
    }
    const adapter = registry.findAdapter({
      taskType: execution.task_type,
      enabledProviderTypes:
        manifestCopy.execution_options.enabled_provider_types,
    });
    if (!adapter) continue; // no adapter — skip, don't fail.

    // 5. Build context.
    const ctx: AssetProviderContext = {
      manifest: manifestCopy,
      assetPlan,
      execution,
      planTask,
      assetManifestRecordId,
      assetRunId,
      projectStorageRootDir,
    };

    // 6. Run the pipeline.
    await runAdapterPipeline(db, ctx, adapter, assetManifestRecordId, assetRunId, manifestCopy, planTask);
  }

  return { manifest: manifestCopy };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function runAdapterPipeline(
  db: DbClient,
  ctx: AssetProviderContext,
  adapter: AssetProviderAdapter,
  assetManifestRecordId: string,
  assetRunId: string,
  manifest: AssetManifest,
  planTask: AssetPlan["tasks"][number],
): Promise<void> {
  const execution = ctx.execution;
  const startedAt = new Date().toISOString();
  execution.status = "running";
  execution.started_at = startedAt;
  execution.attempts += 1;
  execution.provider_id = adapter.providerName;

  try {
    // prepare
    const prepared = await adapter.prepare(ctx);

    // Create job record
    await createAssetProviderJobRecord(db, {
      assetManifestRecordId,
      assetRunId,
      executionId: execution.execution_id,
      taskId: execution.task_id,
      providerType: adapter.providerType,
      providerName: adapter.providerName,
      providerJobId: prepared.providerJobId,
      status: "prepared",
      attemptCount: execution.attempts,
      rawRequestJson: prepared.rawRequestJson,
      rawResponseJson: null,
      errorCode: null,
      errorMessage: null,
    });

    // submit
    const submitted = await adapter.submit(ctx, prepared);

    // poll
    const pollResult = await adapter.poll(ctx, submitted);

    if (pollResult.status === "failed") {
      execution.status = "failed";
      execution.completed_at = new Date().toISOString();
      execution.notes = [
        ...execution.notes,
        `[engine] provider poll failed: ${pollResult.errorCode ?? "unknown"} — ${pollResult.errorMessage ?? "no message"}`,
      ];
      // S2-2A 任务 6：按段视频策略处理失败（严格阻塞或自动降级）
      handleVideoStrategyFailure(
        manifest,
        planTask,
        pollResult.errorCode ?? "video_provider_error",
        pollResult.errorMessage ?? "no message",
      );
      return;
    }

    if (pollResult.status === "running") {
      // Still running — leave as running, do not finalize.
      execution.status = "running";
      execution.notes = [
        ...execution.notes,
        "[engine] provider poll returned running; deferring finalization",
      ];
      return;
    }

    // completed — download + normalize
    const downloaded = await adapter.download(ctx, pollResult);
    const normalized = await adapter.normalizeResult({
      ctx,
      downloadedArtifacts: downloaded,
      rawResponseJson: pollResult.rawResponseJson,
    });

    // Validate each artifact with Zod
    const validArtifacts = normalized.artifacts.filter((a) => {
      const parsed = AssetArtifact.safeParse(a);
      if (!parsed.success) {
        execution.notes = [
          ...execution.notes,
          `[engine] artifact ${a.artifact_id} failed validation: ${parsed.error.message}`,
        ];
        return false;
      }
      return true;
    });

    // Append artifacts and update execution. Provider outputs replace any
    // planned placeholders with the same artifact id.
    const artifactIds = validArtifacts.map((a) => a.artifact_id);
    const artifactIdSet = new Set(artifactIds);
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => !artifactIdSet.has(artifact.artifact_id),
    );
    manifest.artifacts.push(...validArtifacts);
    execution.output_artifact_ids = [
      ...new Set([...execution.output_artifact_ids, ...artifactIds]),
    ];
    execution.status = "completed";
    execution.completed_at = new Date().toISOString();
    execution.notes = [...execution.notes, ...normalized.notes];

    // Apply artifacts to segment routes
    applyArtifactRoutes(manifest, validArtifacts, planTask);
  } catch (err) {
    execution.status = "failed";
    execution.completed_at = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    execution.notes = [
      ...execution.notes,
      `[engine] adapter pipeline error: ${message}`,
    ];
    // S2-2A 任务 6：管线异常同样按段视频策略处理
    handleVideoStrategyFailure(manifest, planTask, "adapter_pipeline_error", message);
  }
}

// ─── S2-2A 任务 6：视频策略状态机 ────────────────────────────────────────────

function findSegmentRoute(
  manifest: AssetManifest,
  segmentId: string | null,
): AssetManifest["segment_routes"][number] | null {
  if (!segmentId) return null;
  return manifest.segment_routes.find((route) => route.segment_id === segmentId) ?? null;
}

/**
 * API 视频失败后的策略分支：
 * - all_api_video（严格）：进入 blocked_waiting_user，不自动改 manifest route，
 *   fallback artifact 保留，等用户显式 accept-fallback 或重试。
 * - prefer_api_video / prefer_remotion（自动）：降级为 image_with_motion 并记录
 *   automatic_fallback 事件；同段 anchor 或 Remotion cue 缺一不可，否则保持
 *   blocked 不得伪装 ready。
 * - all_remotion：engine 层已跳过，不进入本函数。
 */
function handleVideoStrategyFailure(
  manifest: AssetManifest,
  planTask: AssetPlan["tasks"][number],
  reasonCode: string,
  reasonMessage: string,
): void {
  if (planTask.task_type !== "video_clip") return;
  const route = findSegmentRoute(manifest, planTask.source_segment_id);
  if (!route) return;

  const strategy = route.video_strategy ?? "prefer_remotion";
  const failureNote = `[strategy] api video failed: ${reasonCode} — ${reasonMessage}`;

  if (strategy === "all_api_video") {
    route.readiness = "blocked_waiting_user";
    route.notes = [...route.notes, failureNote];
    return;
  }

  // 自动降级要求同段 fallback anchor 与 Remotion cue 齐备
  const hasAnchor =
    route.fallback_visual_artifact_id !== null ||
    route.primary_visual_artifact_id !== null;
  const hasMotion = route.motion_artifact_id !== null;
  if (!hasAnchor || !hasMotion) {
    route.readiness = "blocked";
    route.notes = [
      ...route.notes,
      `[strategy] auto fallback unavailable: anchor=${hasAnchor} motion=${hasMotion}; ${failureNote}`,
    ];
    return;
  }

  if (route.primary_visual_artifact_id === null) {
    route.primary_visual_artifact_id = route.fallback_visual_artifact_id;
  }
  route.visual_route_type = "image_with_motion";
  route.fallback_decision = "automatic";
  route.route_events = [
    ...(route.route_events ?? []),
    {
      event_type: "automatic_fallback",
      occurred_at: new Date().toISOString(),
      reason_code: reasonCode,
    },
  ];
  route.readiness = "ready";
  route.notes = [...route.notes, failureNote];
}

/**
 * Check whether upstream dependencies are satisfied for the given execution.
 *
 * v1 rules:
 * - subtitle_track requires at least one tts_chunk_audio artifact in manifest.
 * - video_clip requires at least one image artifact for the same segment.
 * - Everything else is assumed ready.
 */
function areDependenciesSatisfied(
  execution: AssetTaskExecution,
  manifest: AssetManifest,
): boolean {
  if (execution.task_type === "subtitle_track") {
    return manifest.audio_summary.tts_chunk_artifact_ids.length > 0;
  }

  if (execution.task_type === "video_clip") {
    // v1: just check if any image artifact exists in manifest
    return manifest.artifacts.some((a) => a.artifact_type === "image");
  }

  return true;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

/**
 * Apply generated artifacts to the manifest's segment routes and summaries.
 *
 * For `image` artifacts:
 * - If the route's `visual_route_type` is `"video_clip"`: set fallback and
 *   mark readiness as `"fallback_ready"`.
 * - Otherwise: set primary visual, keep `image_only`, mark `"ready"`.
 *
 * For `tts_chunk_audio` artifacts:
 * - Append to `audio_summary.tts_chunk_artifact_ids`.
 * - Update matching `audio_summary.tts_chunk_routes[].artifact_id` by `tts_chunk_id`.
 * - Set matching `segment_routes[].tts_artifact_id` for segments in `segment_ids`.
 *
 * For `tts_merged_audio` artifacts:
 * - Set `audio_summary.tts_merged_artifact_id`.
 * - Set `audio_summary.tts_total_duration_sec` from metadata.
 *
 * For `subtitle_track` artifacts (first SRT):
 * - Set `audio_summary.subtitle_artifact_id` to the first SRT artifact.
 * - Set all `segment_routes[].subtitle_artifact_id`.
 */
function applyArtifactRoutes(
  manifest: AssetManifest,
  artifacts: AssetArtifact[],
  planTask: AssetPlan["tasks"][number],
): void {
  for (const artifact of artifacts) {
    switch (artifact.artifact_type) {
      case "image": {
        const segmentId = planTask.source_segment_id;
        const route = manifest.segment_routes.find(
          (r) => r.segment_id === segmentId,
        );
        if (!route) break;

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
        break;
      }

      case "video": {
        const segmentId = planTask.source_segment_id;
        const route = manifest.segment_routes.find(
          (item) => item.segment_id === segmentId,
        );
        if (!route) break;

        if (!route.fallback_visual_artifact_id && route.primary_visual_artifact_id) {
          route.fallback_visual_artifact_id = route.primary_visual_artifact_id;
        }
        route.primary_visual_artifact_id = artifact.artifact_id;
        route.visual_route_type = "video_clip";
        route.readiness = "ready";
        break;
      }

      case "tts_chunk_audio": {
        const meta = artifact.metadata as {
          tts_chunk_id: string;
          segment_ids: string[];
        };

        // Add to tts_chunk_artifact_ids
        pushUnique(
          manifest.audio_summary.tts_chunk_artifact_ids,
          artifact.artifact_id,
        );

        // Update matching tts_chunk_route
        const chunkRoute = manifest.audio_summary.tts_chunk_routes.find(
          (r) => r.tts_chunk_id === meta.tts_chunk_id,
        );
        if (chunkRoute) {
          chunkRoute.artifact_id = artifact.artifact_id;
        }

        // Set segment route tts_artifact_id for each segment
        for (const segId of meta.segment_ids) {
          const segRoute = manifest.segment_routes.find(
            (r) => r.segment_id === segId,
          );
          if (segRoute) {
            segRoute.tts_artifact_id = artifact.artifact_id;
          }
        }
        break;
      }

      case "tts_merged_audio": {
        const meta = artifact.metadata as { duration_sec: number };
        manifest.audio_summary.tts_merged_artifact_id = artifact.artifact_id;
        manifest.audio_summary.tts_total_duration_sec = meta.duration_sec;
        break;
      }

      case "subtitle_track": {
        const meta = artifact.metadata as { format: string };

        // Set subtitle_artifact_id for the first SRT artifact
        if (
          meta.format === "srt" &&
          !manifest.audio_summary.subtitle_artifact_id
        ) {
          manifest.audio_summary.subtitle_artifact_id = artifact.artifact_id;

          // Set all segment route subtitle_artifact_ids
          for (const segRoute of manifest.segment_routes) {
            segRoute.subtitle_artifact_id = artifact.artifact_id;
          }
        }
        break;
      }

      case "sfx_audio":
      case "sfx_selection": {
        pushUnique(
          manifest.audio_summary.sfx_artifact_ids,
          artifact.artifact_id,
        );

        if (planTask.source_segment_id) {
          const route = manifest.segment_routes.find(
            (item) => item.segment_id === planTask.source_segment_id,
          );
          if (route) {
            pushUnique(route.sfx_artifact_ids, artifact.artifact_id);
          }
        }
        break;
      }

      case "bgm_audio":
      case "bgm_selection": {
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
        break;
      }

      default:
        break;
    }
  }
}
