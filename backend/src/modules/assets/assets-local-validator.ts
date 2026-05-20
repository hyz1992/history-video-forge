import { stat } from "node:fs/promises";

import type {
  AssetManifest,
  AssetPlan,
  AssetsValidationResult,
  MediaLibraryItem,
} from "../../../../shared/src/index.js";
import { AssetsValidationResult as AssetsValidationResultSchema } from "../../../../shared/src/index.js";

/**
 * Segment-bound task types that should have a corresponding segment route
 * when they reference a source_segment_id.
 */
const VISUAL_TASK_TYPES = new Set(["image_still", "video_clip", "render_motion_cue"]);
const TERMINAL_EXECUTION_STATUSES = new Set([
  "completed",
  "accepted",
  "skipped_with_fallback",
]);

function isOptionalIncompleteExecution(
  execution: AssetManifest["executions"][number],
  assetPlan: AssetPlan,
): boolean {
  const task = assetPlan.tasks.find((item) => item.task_id === execution.task_id);
  if (!task) {
    return false;
  }

  if (task.manual_upload_policy.required) {
    return false;
  }

  return task.task_type === "bgm_cue" || task.task_type === "sfx_cue";
}

function pushUnique(target: string[], code: string) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

export async function validateAssetsManifest(input: {
  assetPlanRecordId: string;
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
  assetPlan: AssetPlan;
  manifest: AssetManifest;
  projectStorageRootDir?: string;
  mediaLibraryItems?: MediaLibraryItem[];
}): Promise<AssetsValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { assetPlan, manifest } = input;

  // ── Source ID checks ────────────────────────────────────────────────────

  if (manifest.source_asset_plan_id !== input.assetPlanRecordId) {
    pushUnique(errors, "assets_source_asset_plan_mismatch");
  }
  if (manifest.source_storyboard_record_id !== input.storyboardRecordId) {
    pushUnique(errors, "assets_source_storyboard_mismatch");
  }
  if (manifest.source_script_record_id !== input.scriptRecordId) {
    pushUnique(errors, "assets_source_script_mismatch");
  }
  // Topic package id lives on the AssetPlan, not on the manifest
  if (assetPlan.source_topic_package_id !== input.topicPackageId) {
    pushUnique(errors, "assets_source_topic_mismatch");
  }

  // ── Build lookup sets ───────────────────────────────────────────────────

  const artifactIds = new Set(manifest.artifacts.map((a) => a.artifact_id));
  const executionTaskIds = new Set(manifest.executions.map((e) => e.task_id));
  const routeSegmentIds = new Set(manifest.segment_routes.map((r) => r.segment_id));
  const referencedArtifactIds = new Set<string>();

  // ── Each plan task must have an execution ───────────────────────────────

  const taskSegmentIds = new Set<string>();

  for (const task of assetPlan.tasks) {
    if (!executionTaskIds.has(task.task_id)) {
      pushUnique(errors, "assets_task_execution_missing");
    }

    if (task.source_segment_id && VISUAL_TASK_TYPES.has(task.task_type)) {
      taskSegmentIds.add(task.source_segment_id);
    }
  }

  // ── Execution artifact ids must exist in artifacts ──────────────────────

  for (const execution of manifest.executions) {
    if (
      !TERMINAL_EXECUTION_STATUSES.has(execution.status) &&
      !isOptionalIncompleteExecution(execution, assetPlan)
    ) {
      pushUnique(errors, "assets_execution_incomplete");
    }

    for (const artifactId of execution.output_artifact_ids) {
      referencedArtifactIds.add(artifactId);
      if (!artifactIds.has(artifactId)) {
        pushUnique(errors, "assets_selected_artifact_missing");
      }
    }
  }

  // ── Segment routes for visual tasks ─────────────────────────────────────

  for (const segmentId of taskSegmentIds) {
    if (!routeSegmentIds.has(segmentId)) {
      pushUnique(errors, "assets_segment_route_missing");
    }
  }

  // ── Route visual references ─────────────────────────────────────────────

  let videoFallbackUsed = false;

  for (const route of manifest.segment_routes) {
    if (route.visual_route_type === "missing") {
      continue;
    }

    // Check primary visual artifact exists
    for (const artifactId of [
      route.tts_artifact_id,
      route.subtitle_artifact_id,
      route.primary_visual_artifact_id,
      route.motion_artifact_id,
      route.fallback_visual_artifact_id,
      ...route.sfx_artifact_ids,
      ...route.bgm_placement_ids,
    ]) {
      if (artifactId) {
        referencedArtifactIds.add(artifactId);
      }
    }

    if (
      route.primary_visual_artifact_id &&
      !artifactIds.has(route.primary_visual_artifact_id)
    ) {
      pushUnique(errors, "assets_segment_visual_missing");
    }

    // Check motion artifact exists when route says image_with_motion
    if (
      route.visual_route_type === "image_with_motion" &&
      route.motion_artifact_id &&
      !artifactIds.has(route.motion_artifact_id)
    ) {
      pushUnique(errors, "assets_segment_visual_missing");
    }

    // Detect video fallback: route uses image_with_motion instead of video_clip
    // for a segment that has a video_clip task
    if (route.visual_route_type === "image_with_motion") {
      const hasVideoTask = assetPlan.tasks.some(
        (t) =>
          t.task_type === "video_clip" &&
          t.source_segment_id === route.segment_id,
      );
      if (hasVideoTask) {
        videoFallbackUsed = true;
      }
    }
  }

  // ── Missing route visuals when route_type is not "missing" ──────────────

  for (const route of manifest.segment_routes) {
    if (route.visual_route_type === "missing") {
      continue;
    }
    if (!route.primary_visual_artifact_id) {
      pushUnique(errors, "assets_segment_visual_missing");
    }
  }

  // ── Video fallback warning ──────────────────────────────────────────────

  if (videoFallbackUsed) {
    pushUnique(warnings, "assets_video_fallback_used");
  }

  // ── BGM warning ─────────────────────────────────────────────────────────

  if (manifest.audio_summary.bgm_placements.length === 0) {
    pushUnique(warnings, "assets_bgm_missing_optional");
  }
  if (
    manifest.audio_summary.bgm_placements.length > 0 &&
    manifest.audio_summary.bgm_placements.every(
      (placement) => !placement.artifact_id,
    )
  ) {
    pushUnique(warnings, "assets_bgm_artifact_missing_optional");
  }

  for (const artifactId of [
    ...manifest.audio_summary.tts_chunk_artifact_ids,
    manifest.audio_summary.tts_merged_artifact_id,
    manifest.audio_summary.subtitle_artifact_id,
    ...manifest.audio_summary.sfx_artifact_ids,
  ]) {
    if (artifactId) {
      referencedArtifactIds.add(artifactId);
    }
  }

  for (const route of manifest.audio_summary.tts_chunk_routes) {
    if (route.artifact_id) {
      referencedArtifactIds.add(route.artifact_id);
    }
  }

  for (const placement of manifest.audio_summary.bgm_placements) {
    if (placement.artifact_id) {
      referencedArtifactIds.add(placement.artifact_id);
    }
  }

  for (const artifact of manifest.artifacts) {
    if (
      referencedArtifactIds.has(artifact.artifact_id) &&
      artifact.file_uri.startsWith("planned://")
    ) {
      pushUnique(errors, "assets_artifact_placeholder_unresolved");
    }
  }

  // ── File existence checks ─────────────────────────────────────────────

  const { projectStorageRootDir } = input;
  if (projectStorageRootDir) {
    const checkedPaths = new Set<string>();
    for (const artifact of manifest.artifacts) {
      if (
        !referencedArtifactIds.has(artifact.artifact_id) ||
        artifact.file_uri.startsWith("planned://")
      ) {
        continue;
      }
      const uri = artifact.file_uri;
      if (checkedPaths.has(uri)) continue;
      checkedPaths.add(uri);

      try {
        await stat(uri);
      } catch {
        pushUnique(errors, "assets_artifact_file_missing");
      }
    }
  }

  // ── Media library checks ──────────────────────────────────────────────

  const { mediaLibraryItems } = input;
  if (mediaLibraryItems) {
    const libItemMap = new Map(
      mediaLibraryItems.map((item) => [item.library_item_id, item]),
    );

    for (const artifact of manifest.artifacts) {
      if (
        artifact.artifact_type !== "sfx_selection" &&
        artifact.artifact_type !== "bgm_selection"
      ) {
        continue;
      }

      const libraryItemId = (
        artifact.metadata as { library_item_id?: string }
      ).library_item_id;
      if (!libraryItemId) continue;

      const libItem = libItemMap.get(libraryItemId);
      if (!libItem) {
        pushUnique(errors, "assets_media_library_item_missing");
        continue;
      }

      if (!libItem.approved_for_use) {
        pushUnique(errors, "assets_media_library_item_unapproved");
      }

      if (!libItem.license.commercial_use_allowed) {
        pushUnique(errors, "assets_media_library_item_license_blocked");
      }
    }
  }

  // ── Decision logic ──────────────────────────────────────────────────────

  let decision: "ready_for_compose" | "blocked" | "partial";
  if (errors.length > 0) {
    decision = "blocked";
  } else if (warnings.length > 0) {
    decision = "partial";
  } else {
    decision = "ready_for_compose";
  }

  return AssetsValidationResultSchema.parse({
    stage: "assets_local_validation",
    decision,
    errors,
    warnings,
    metrics: {
      task_count: assetPlan.tasks.length,
      execution_count: manifest.executions.length,
      artifact_count: manifest.artifacts.length,
      segment_route_count: manifest.segment_routes.length,
    },
  });
}
