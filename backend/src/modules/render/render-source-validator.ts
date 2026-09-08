import { assertNarrationTimelineManifest } from "../../../../shared/src/compose/compose-timeline.schema.js";
import { stat } from "node:fs/promises";

import { normalizeAssetManifestDates } from "../assets/manifest-date-normalizer.js";
import { resolveArtifactFileUri } from "../assets/artifact-file-resolver.js";
import {
  AssetManifest as AssetManifestSchema,
  ComposeTimeline as ComposeTimelineSchema,
  RenderValidationResult as RenderValidationResultSchema,
} from "../../../../shared/src/index.js";
import type {
  AssetArtifact,
  AssetManifest,
  ComposeTimeline,
  RenderValidationResult,
} from "../../../../shared/src/index.js";
import type {
  AssetManifestRecord,
  ComposeRecord,
} from "../../db/client.js";

export interface ValidateRenderSourcesInput {
  activeComposeRecordId?: string | null;
  composeRecord: ComposeRecord | null;
  assetManifestRecord: AssetManifestRecord | null;
  projectStorageRootDir?: string;
}

function pushUnique(target: string[], code: string) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function buildResult(input: {
  decision: RenderValidationResult["decision"];
  errors: string[];
  warnings: string[];
  timeline?: ComposeTimeline;
  clipCount?: number;
}): RenderValidationResult {
  return RenderValidationResultSchema.parse({
    stage: "render_local_validation",
    decision: input.decision,
    errors: input.errors,
    warnings: input.warnings,
    metrics: {
      track_count: input.timeline?.tracks.length ?? 0,
      clip_count: input.clipCount ?? 0,
      duration_sec: input.timeline?.duration_sec ?? null,
    },
  });
}

function indexArtifacts(manifest: AssetManifest): Map<string, AssetArtifact> {
  return new Map(
    manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]),
  );
}

function listTimelineClips(timeline: ComposeTimeline) {
  return timeline.tracks.flatMap((track) => track.clips);
}

function isRequiredTrackMissing(
  timeline: ComposeTimeline,
  trackType: "narration" | "subtitle",
): boolean {
  return !timeline.tracks.some(
    (track) => track.track_type === trackType && track.clips.length > 0,
  );
}

async function checkReferencedFiles(input: {
  artifactsById: Map<string, AssetArtifact>;
  referencedArtifactIds: Set<string>;
  projectStorageRootDir?: string;
  errors: string[];
}) {
  if (!input.projectStorageRootDir) {
    return;
  }

  const checkedResolvedPaths = new Set<string>();
  for (const artifactId of input.referencedArtifactIds) {
    const artifact = input.artifactsById.get(artifactId);
    if (!artifact) continue;

    const resolvedPath = resolveArtifactFileUri({
      fileUri: artifact.file_uri,
      projectStorageRootDir: input.projectStorageRootDir,
    });
    if (!resolvedPath) continue;

    if (checkedResolvedPaths.has(resolvedPath)) continue;
    checkedResolvedPaths.add(resolvedPath);

    try {
      await stat(resolvedPath);
    } catch {
      pushUnique(
        input.errors,
        `render_artifact_file_missing:${artifact.artifact_id}:${artifact.artifact_type}:${artifact.file_uri}`,
      );
    }
  }
}

function collectReferencedArtifactIds(input: {
  timeline: ComposeTimeline;
  artifactsById: Map<string, AssetArtifact>;
  errors: string[];
}): Set<string> {
  const referencedArtifactIds = new Set<string>();

  for (const clip of listTimelineClips(input.timeline)) {
    referencedArtifactIds.add(clip.artifact_id);
    if (!input.artifactsById.has(clip.artifact_id)) {
      pushUnique(input.errors, "render_artifact_missing");
    }

    if (clip.motion_artifact_id) {
      referencedArtifactIds.add(clip.motion_artifact_id);
      if (!input.artifactsById.has(clip.motion_artifact_id)) {
        pushUnique(input.errors, "render_artifact_missing");
      }
    }
  }

  return referencedArtifactIds;
}

function collectOptionalWarnings(input: {
  manifest: AssetManifest;
  artifactsById: Map<string, AssetArtifact>;
  warnings: string[];
}) {
  for (const placement of input.manifest.audio_summary.bgm_placements) {
    if (!placement.artifact_id) {
      pushUnique(input.warnings, "render_bgm_missing_optional");
      continue;
    }
    if (!input.artifactsById.has(placement.artifact_id)) {
      pushUnique(input.warnings, "render_bgm_missing_optional");
    }
  }

  for (const artifactId of input.manifest.audio_summary.sfx_artifact_ids) {
    if (!input.artifactsById.has(artifactId)) {
      pushUnique(input.warnings, "render_sfx_missing_optional");
    }
  }
}

export async function validateRenderSources(
  input: ValidateRenderSourcesInput,
): Promise<RenderValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.activeComposeRecordId === null) {
    pushUnique(errors, "render_active_compose_missing");
    return buildResult({ decision: "blocked", errors, warnings });
  }

  if (!input.composeRecord) {
    pushUnique(errors, "render_compose_record_missing");
    return buildResult({ decision: "blocked", errors, warnings });
  }

  const timelineResult = ComposeTimelineSchema.safeParse(
    input.composeRecord.timelineJson,
  );
  if (!timelineResult.success) {
    pushUnique(errors, "render_timeline_not_ready");
    return buildResult({ decision: "blocked", errors, warnings });
  }
  const timeline = timelineResult.data;
  const clips = listTimelineClips(timeline);

  if (timeline.readiness === "blocked") {
    pushUnique(errors, "render_timeline_not_ready");
  } else if (timeline.readiness === "partial") {
    pushUnique(warnings, "render_timeline_partial");
  }

  if (!input.assetManifestRecord) {
    pushUnique(errors, "render_asset_manifest_missing");
    return buildResult({
      decision: "blocked",
      errors,
      warnings,
      timeline,
      clipCount: clips.length,
    });
  }

  const manifestResult = AssetManifestSchema.safeParse(
    normalizeAssetManifestDates(
      input.assetManifestRecord.manifestJson as Record<string, unknown>,
    ),
  );
  if (!manifestResult.success) {
    pushUnique(errors, "render_asset_manifest_invalid");
    return buildResult({
      decision: "blocked",
      errors,
      warnings,
      timeline,
      clipCount: clips.length,
    });
  }
  const manifest = manifestResult.data;
  if(timeline.timeline_version==="compose_timeline_v2"||manifest.manifest_version==="asset_manifest_v2"){try{assertNarrationTimelineManifest(timeline,manifest);}catch{errors.push("render_narration_source_invalid");}}
  const artifactsById = indexArtifacts(manifest);

  if (isRequiredTrackMissing(timeline, "narration")) {
    pushUnique(errors, "render_narration_missing");
  }
  if (isRequiredTrackMissing(timeline, "subtitle")) {
    pushUnique(errors, "render_subtitle_missing");
  }

  const referencedArtifactIds = collectReferencedArtifactIds({
    timeline,
    artifactsById,
    errors,
  });

  collectOptionalWarnings({ manifest, artifactsById, warnings });

  await checkReferencedFiles({
    artifactsById,
    referencedArtifactIds,
    projectStorageRootDir: input.projectStorageRootDir,
    errors,
  });

  return buildResult({
    decision: errors.length > 0 ? "blocked" : "ready_to_render",
    errors,
    warnings,
    timeline,
    clipCount: clips.length,
  });
}
