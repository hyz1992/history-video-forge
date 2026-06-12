import { stat } from "node:fs/promises";
import { join } from "node:path";

import { ComposeValidationResult as ComposeValidationResultSchema } from "../../../../shared/src/index.js";
import type {
  AssetArtifact,
  AssetManifest,
  ComposeTimeline,
  ComposeValidationResult,
} from "../../../../shared/src/index.js";

export interface ValidateComposeTimelineInput {
  manifest: AssetManifest;
  timeline: ComposeTimeline;
  projectStorageRootDir?: string;
}

function pushUnique(target: string[], code: string) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function indexArtifacts(manifest: AssetManifest): Map<string, AssetArtifact> {
  return new Map(
    manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]),
  );
}

function listTimelineClips(timeline: ComposeTimeline) {
  return timeline.tracks.flatMap((track) => track.clips);
}

function hasPositiveDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFileUriCheckable(fileUri: string): boolean {
  return !(
    fileUri.startsWith("memory://") ||
    fileUri.startsWith("inline://") ||
    fileUri.startsWith("planned://") ||
    fileUri.startsWith("external://") ||
    fileUri.startsWith("http://") ||
    fileUri.startsWith("https://")
  );
}

function resolveCheckableFileUri(input: {
  fileUri: string;
  projectStorageRootDir: string;
}): string {
  const { fileUri, projectStorageRootDir } = input;
  if (fileUri.startsWith("local://")) {
    return join(projectStorageRootDir, fileUri.slice("local://".length));
  }

  return fileUri;
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

  const checkedFileUris = new Set<string>();
  for (const artifactId of input.referencedArtifactIds) {
    const artifact = input.artifactsById.get(artifactId);
    if (!artifact || !isFileUriCheckable(artifact.file_uri)) {
      continue;
    }

    const filePath = resolveCheckableFileUri({
      fileUri: artifact.file_uri,
      projectStorageRootDir: input.projectStorageRootDir,
    });
    if (checkedFileUris.has(filePath)) {
      continue;
    }
    checkedFileUris.add(filePath);

    try {
      await stat(filePath);
    } catch {
      pushUnique(input.errors, "compose_artifact_file_missing");
    }
  }
}

export async function validateComposeTimeline(
  input: ValidateComposeTimelineInput,
): Promise<ComposeValidationResult> {
  const { manifest, timeline } = input;
  const errors: string[] = [];
  const warnings: string[] = [];
  const artifactsById = indexArtifacts(manifest);
  const clips = listTimelineClips(timeline);
  const referencedArtifactIds = new Set<string>();

  // Only "blocked" prevents compose.  "partial" means warnings-only
  // (e.g. optional BGM missing) and should still allow composing.
  if (manifest.readiness === "blocked") {
    pushUnique(errors, "compose_asset_manifest_not_ready");
  } else if (manifest.readiness === "partial") {
    pushUnique(warnings, "compose_asset_manifest_partial");
  }

  const narrationTrack = timeline.tracks.find(
    (track) => track.track_type === "narration",
  );
  const narrationClip = narrationTrack?.clips[0];
  if (!manifest.audio_summary.tts_merged_artifact_id || !narrationClip) {
    pushUnique(errors, "compose_narration_missing");
  } else if (!hasPositiveDuration(narrationClip.duration_sec)) {
    pushUnique(errors, "compose_narration_duration_missing");
  }

  const subtitleTrack = timeline.tracks.find(
    (track) => track.track_type === "subtitle",
  );
  if (!manifest.audio_summary.subtitle_artifact_id || !subtitleTrack?.clips[0]) {
    pushUnique(errors, "compose_subtitle_missing");
  }

  if (!hasPositiveDuration(timeline.duration_sec)) {
    pushUnique(errors, "compose_timeline_duration_invalid");
  }

  for (const segment of timeline.segments) {
    if (segment.visual_clip_ids.length === 0) {
      pushUnique(errors, "compose_segment_visual_missing");
    }
    if (!hasPositiveDuration(segment.duration_sec)) {
      pushUnique(errors, "compose_timeline_duration_invalid");
    }
  }

  const lastClipEndSec = clips.reduce(
    (max, clip) => Math.max(max, clip.start_sec + clip.duration_sec),
    0,
  );
  if (timeline.duration_sec < lastClipEndSec) {
    pushUnique(errors, "compose_timeline_duration_invalid");
  }

  for (const clip of clips) {
    referencedArtifactIds.add(clip.artifact_id);
    if (!artifactsById.has(clip.artifact_id)) {
      pushUnique(errors, "compose_artifact_missing");
    }
    if (clip.motion_artifact_id) {
      referencedArtifactIds.add(clip.motion_artifact_id);
      if (!artifactsById.has(clip.motion_artifact_id)) {
        pushUnique(errors, "compose_artifact_missing");
      }
    }
  }

  for (const placement of manifest.audio_summary.bgm_placements) {
    if (!placement.artifact_id) {
      pushUnique(warnings, "compose_bgm_missing_optional");
    }
  }

  await checkReferencedFiles({
    artifactsById,
    referencedArtifactIds,
    projectStorageRootDir: input.projectStorageRootDir,
    errors,
  });

  const decision =
    errors.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "partial"
        : "ready_for_render";

  return ComposeValidationResultSchema.parse({
    stage: "compose_local_validation",
    decision,
    errors,
    warnings,
    metrics: {
      track_count: timeline.tracks.length,
      clip_count: clips.length,
      segment_count: timeline.segments.length,
      duration_sec: timeline.duration_sec,
    },
  });
}
