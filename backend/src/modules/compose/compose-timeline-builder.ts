import { ComposeTimeline as ComposeTimelineSchema } from "../../../../shared/src/index.js";

const END_PADDING_SEC = 3;

import type {
  AssetArtifact,
  AssetManifest,
  ComposeClip,
  ComposeTimeline,
  ComposeTimelineSegment,
  ComposeTrack,
} from "../../../../shared/src/index.js";

export interface BuildComposeTimelineInput {
  assetManifestRecordId: string;
  assetPlanRecordId: string;
  storyboardRecordId: string;
  scriptRecordId: string;
  manifest: AssetManifest;
}

interface SegmentTiming {
  segmentId: string;
  startSec: number;
  durationSec: number;
}

function indexArtifacts(manifest: AssetManifest): Map<string, AssetArtifact> {
  return new Map(
    manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]),
  );
}

function getDurationSec(artifact: AssetArtifact | undefined): number | null {
  if (
    artifact?.artifact_type === "tts_chunk_audio" ||
    artifact?.artifact_type === "tts_merged_audio" ||
    artifact?.artifact_type === "video" ||
    artifact?.artifact_type === "sfx_audio" ||
    artifact?.artifact_type === "bgm_audio"
  ) {
    return artifact.metadata.duration_sec;
  }

  return null;
}

function deriveSegmentTimings(input: {
  manifest: AssetManifest;
  artifactsById: Map<string, AssetArtifact>;
  totalDurationSec: number;
  notes: string[];
}): SegmentTiming[] {
  const { manifest, artifactsById, totalDurationSec, notes } = input;
  const chunkDurationBySegment = new Map<string, number>();

  for (const route of manifest.audio_summary.tts_chunk_routes) {
    if (!route.artifact_id) {
      continue;
    }

    const chunkDurationSec = getDurationSec(artifactsById.get(route.artifact_id));
    if (!chunkDurationSec) {
      continue;
    }

    const perSegmentDuration = chunkDurationSec / route.segment_ids.length;
    for (const segmentId of route.segment_ids) {
      chunkDurationBySegment.set(
        segmentId,
        (chunkDurationBySegment.get(segmentId) ?? 0) + perSegmentDuration,
      );
    }
  }

  const canUseChunkDurations = manifest.segment_routes.every((route) =>
    chunkDurationBySegment.has(route.segment_id),
  );

  if (!canUseChunkDurations) {
    notes.push("compose_chunk_timing_fallback_used");
  }

  const fallbackDurationSec =
    manifest.segment_routes.length > 0
      ? totalDurationSec / manifest.segment_routes.length
      : totalDurationSec;

  let cursorSec = 0;
  return manifest.segment_routes.map((route) => {
    const durationSec = canUseChunkDurations
      ? chunkDurationBySegment.get(route.segment_id) ?? fallbackDurationSec
      : fallbackDurationSec;
    const timing = {
      segmentId: route.segment_id,
      startSec: cursorSec,
      durationSec,
    };
    cursorSec += durationSec;
    return timing;
  });
}

function clipKindForRoute(
  route: AssetManifest["segment_routes"][number],
): ComposeClip["clip_kind"] {
  if (route.visual_route_type === "video_clip") {
    return "video";
  }

  if (route.visual_route_type === "image_with_motion") {
    return "image_with_motion";
  }

  return "image_only";
}

function createVisualTrack(input: {
  manifest: AssetManifest;
  timings: SegmentTiming[];
  notes: string[];
}): ComposeTrack {
  const { manifest, timings, notes } = input;
  const timingBySegment = new Map(
    timings.map((timing) => [timing.segmentId, timing]),
  );
  const clips: ComposeClip[] = [];

  for (const route of manifest.segment_routes) {
    const timing = timingBySegment.get(route.segment_id);
    const artifactId =
      route.primary_visual_artifact_id ?? route.fallback_visual_artifact_id;

    if (!timing || !artifactId || route.visual_route_type === "missing") {
      notes.push(`compose_visual_missing:${route.segment_id}`);
      continue;
    }

    clips.push({
      clip_id: `clip_visual_${route.segment_id}`,
      segment_id: route.segment_id,
      artifact_id: artifactId,
      start_sec: timing.startSec,
      duration_sec: timing.durationSec,
      clip_kind: clipKindForRoute(route),
      motion_artifact_id:
        route.visual_route_type === "image_with_motion"
          ? route.motion_artifact_id
          : null,
      notes: [],
    });
  }

  return {
    track_id: "track_visual",
    track_type: "visual",
    clips,
  };
}

function createNarrationTrack(input: {
  manifest: AssetManifest;
  totalDurationSec: number;
}): ComposeTrack | null {
  const artifactId = input.manifest.audio_summary.tts_merged_artifact_id;
  if (!artifactId) {
    return null;
  }

  return {
    track_id: "track_narration",
    track_type: "narration",
    clips: [
      {
        clip_id: "clip_narration",
        segment_id: null,
        artifact_id: artifactId,
        start_sec: 0,
        duration_sec: input.totalDurationSec,
        clip_kind: "audio",
        motion_artifact_id: null,
        notes: [],
      },
    ],
  };
}

function createSubtitleTrack(input: {
  manifest: AssetManifest;
  totalDurationSec: number;
}): ComposeTrack | null {
  const artifactId = input.manifest.audio_summary.subtitle_artifact_id;
  if (!artifactId) {
    return null;
  }

  return {
    track_id: "track_subtitle",
    track_type: "subtitle",
    clips: [
      {
        clip_id: "clip_subtitle",
        segment_id: null,
        artifact_id: artifactId,
        start_sec: 0,
        duration_sec: input.totalDurationSec,
        clip_kind: "subtitle",
        motion_artifact_id: null,
        notes: [],
      },
    ],
  };
}

function createBgmTrack(input: {
  manifest: AssetManifest;
  artifactsById: Map<string, AssetArtifact>;
  timings: SegmentTiming[];
  totalDurationSec: number;
}): ComposeTrack | null {
  const clips: ComposeClip[] = [];
  const timingBySegment = new Map(
    input.timings.map((timing) => [timing.segmentId, timing]),
  );

  for (const placement of input.manifest.audio_summary.bgm_placements) {
    if (!placement.artifact_id) {
      continue;
    }
    const artifact = input.artifactsById.get(placement.artifact_id);
    if (artifact?.artifact_type !== "bgm_audio") {
      continue;
    }

    if (placement.scope === "global" || placement.segment_ids.length === 0) {
      clips.push({
        clip_id: `clip_bgm_${placement.bgm_placement_id}`,
        segment_id: null,
        artifact_id: placement.artifact_id,
        start_sec: 0,
        duration_sec: input.totalDurationSec,
        clip_kind: "audio",
        motion_artifact_id: null,
        notes: [],
      });
      continue;
    }

    const selectedTimings = placement.segment_ids
      .map((segmentId) => timingBySegment.get(segmentId))
      .filter((timing): timing is SegmentTiming => timing !== undefined);
    if (selectedTimings.length === 0) {
      continue;
    }
    const startSec = Math.min(...selectedTimings.map((timing) => timing.startSec));
    const endSec = Math.max(
      ...selectedTimings.map((timing) => timing.startSec + timing.durationSec),
    );

    clips.push({
      clip_id: `clip_bgm_${placement.bgm_placement_id}`,
      segment_id:
        selectedTimings.length === 1 ? selectedTimings[0]!.segmentId : null,
      artifact_id: placement.artifact_id,
      start_sec: startSec,
      duration_sec: Math.max(0.01, endSec - startSec),
      clip_kind: "audio",
      motion_artifact_id: null,
      notes: [],
    });
  }

  if (clips.length === 0) {
    return null;
  }

  return {
    track_id: "track_bgm",
    track_type: "bgm",
    clips,
  };
}

function createSfxTrack(input: {
  manifest: AssetManifest;
  artifactsById: Map<string, AssetArtifact>;
  timings: SegmentTiming[];
}): ComposeTrack | null {
  const clips: ComposeClip[] = [];
  const timingBySegment = new Map(
    input.timings.map((timing) => [timing.segmentId, timing]),
  );
  const emittedClipIds = new Set<string>();

  for (const route of input.manifest.segment_routes) {
    const timing = timingBySegment.get(route.segment_id);
    if (!timing) {
      continue;
    }

    for (const artifactId of route.sfx_artifact_ids) {
      const artifact = input.artifactsById.get(artifactId);
      if (artifact?.artifact_type !== "sfx_audio") {
        continue;
      }
      const clipId = `clip_sfx_${route.segment_id}_${artifactId}`;
      if (emittedClipIds.has(clipId)) {
        continue;
      }
      emittedClipIds.add(clipId);

      clips.push({
        clip_id: clipId,
        segment_id: route.segment_id,
        artifact_id: artifactId,
        start_sec: timing.startSec,
        duration_sec: Math.min(artifact.metadata.duration_sec, timing.durationSec),
        clip_kind: "audio",
        motion_artifact_id: null,
        notes: [],
      });
    }
  }

  if (clips.length === 0) {
    return null;
  }

  return {
    track_id: "track_sfx",
    track_type: "sfx",
    clips,
  };
}

function createSegments(input: {
  timings: SegmentTiming[];
  visualTrack: ComposeTrack;
  hasNarration: boolean;
  hasSubtitle: boolean;
}): ComposeTimelineSegment[] {
  const visualClipsBySegment = new Map<string, string[]>();
  for (const clip of input.visualTrack.clips) {
    if (!clip.segment_id) {
      continue;
    }
    const existing = visualClipsBySegment.get(clip.segment_id) ?? [];
    existing.push(clip.clip_id);
    visualClipsBySegment.set(clip.segment_id, existing);
  }

  return input.timings.map((timing) => ({
    segment_id: timing.segmentId,
    start_sec: timing.startSec,
    duration_sec: timing.durationSec,
    visual_clip_ids: visualClipsBySegment.get(timing.segmentId) ?? [],
    narration_clip_ids: input.hasNarration ? ["clip_narration"] : [],
    subtitle_clip_ids: input.hasSubtitle ? ["clip_subtitle"] : [],
    notes: [],
  }));
}

export function buildComposeTimeline(
  input: BuildComposeTimelineInput,
): ComposeTimeline {
  const artifactsById = indexArtifacts(input.manifest);
  const mergedTtsArtifactId = input.manifest.audio_summary.tts_merged_artifact_id;
  const mergedTtsDurationSec = getDurationSec(
    mergedTtsArtifactId ? artifactsById.get(mergedTtsArtifactId) : undefined,
  );
  const narrationDurationSec =
    mergedTtsDurationSec ??
    input.manifest.audio_summary.tts_total_duration_sec ??
    0;
  const notes: string[] = [];
  const timings = deriveSegmentTimings({
    manifest: input.manifest,
    artifactsById,
    totalDurationSec: narrationDurationSec,
    notes,
  });

  if (timings.length > 0) {
    timings[timings.length - 1]!.durationSec += END_PADDING_SEC;
  }

  const totalDurationSec = timings.length > 0
    ? timings.reduce((sum, t) => sum + t.durationSec, 0)
    : narrationDurationSec + END_PADDING_SEC;
  notes.push(`含 ${END_PADDING_SEC} 秒片尾缓冲`);
  const visualTrack = createVisualTrack({
    manifest: input.manifest,
    timings,
    notes,
  });
  const narrationTrack = createNarrationTrack({
    manifest: input.manifest,
    totalDurationSec: narrationDurationSec,
  });
  const subtitleTrack = createSubtitleTrack({
    manifest: input.manifest,
    totalDurationSec: narrationDurationSec,
  });
  const bgmTrack = createBgmTrack({
    manifest: input.manifest,
    artifactsById,
    timings,
    totalDurationSec,
  });
  const sfxTrack = createSfxTrack({
    manifest: input.manifest,
    artifactsById,
    timings,
  });
  const tracks = [
    visualTrack,
    narrationTrack,
    subtitleTrack,
    bgmTrack,
    sfxTrack,
  ].filter(
    (track): track is ComposeTrack => track !== null,
  );

  return ComposeTimelineSchema.parse({
    timeline_version: "compose_timeline_v1",
    source_asset_manifest_record_id: input.assetManifestRecordId,
    source_asset_plan_record_id: input.assetPlanRecordId,
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    output_profile: {
      aspect_ratio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
    },
    duration_sec: totalDurationSec,
    tracks,
    segments: createSegments({
      timings,
      visualTrack,
      hasNarration: narrationTrack !== null,
      hasSubtitle: subtitleTrack !== null,
    }),
    readiness: "ready_for_render",
    notes,
  });
}
