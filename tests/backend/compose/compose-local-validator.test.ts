import { describe, expect, it } from "vitest";

import { buildComposeTimeline } from "../../../backend/src/modules/compose/compose-timeline-builder.js";
import { validateComposeTimeline } from "../../../backend/src/modules/compose/compose-local-validator.js";
import type {
  AssetArtifact,
  AssetManifest,
  ComposeTimeline,
} from "../../../shared/src/index.js";

function makeReadyManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_1",
      enabled_provider_types: ["tts", "image"],
      allow_manual_placeholders: false,
    },
    executions: [],
    artifacts: [
      {
        artifact_id: "artifact_tts_chunk_001",
        artifact_type: "tts_chunk_audio",
        origin: "provider",
        file_uri: "memory://tts-chunk-001.wav",
        created_at: "2026-05-17T00:00:00.000Z",
        metadata: {
          duration_sec: 12,
          voice_profile_id: "voice_1",
          tts_chunk_id: "tts_chunk_001",
          segment_ids: ["sb_001"],
          script_excerpt: "first segment narration",
        },
      },
      {
        artifact_id: "artifact_tts_merged",
        artifact_type: "tts_merged_audio",
        origin: "provider",
        file_uri: "memory://tts-merged.wav",
        created_at: "2026-05-17T00:00:00.000Z",
        metadata: {
          duration_sec: 12,
          voice_profile_id: "voice_1",
          chunk_artifact_ids: ["artifact_tts_chunk_001"],
        },
      },
      {
        artifact_id: "artifact_subtitle",
        artifact_type: "subtitle_track",
        origin: "local",
        file_uri: "memory://subtitle.srt",
        created_at: "2026-05-17T00:00:00.000Z",
        metadata: {
          format: "srt",
          source_tts_artifact_id: "artifact_tts_merged",
          caption_count: 1,
        },
      },
      {
        artifact_id: "artifact_img_001",
        artifact_type: "image",
        origin: "provider",
        file_uri: "memory://image-001.png",
        created_at: "2026-05-17T00:00:00.000Z",
        metadata: {
          width: 1080,
          height: 1920,
        },
      },
      {
        artifact_id: "artifact_motion_001",
        artifact_type: "motion_recipe",
        origin: "local",
        file_uri: "inline://motion-001",
        created_at: "2026-05-17T00:00:00.000Z",
        metadata: {
          recipe_type: "push_in",
          source_image_artifact_id: "artifact_img_001",
          parameters: { intensity: "subtle" },
        },
      },
    ],
    audio_summary: {
      voice_profile_id: "voice_1",
      tts_total_duration_sec: 12,
      tts_chunk_artifact_ids: ["artifact_tts_chunk_001"],
      tts_chunk_routes: [
        {
          tts_chunk_id: "tts_chunk_001",
          artifact_id: "artifact_tts_chunk_001",
          segment_ids: ["sb_001"],
          script_excerpt: "first segment narration",
        },
      ],
      tts_merged_artifact_id: "artifact_tts_merged",
      subtitle_artifact_id: "artifact_subtitle",
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: "artifact_tts_chunk_001",
        subtitle_artifact_id: "artifact_subtitle",
        primary_visual_artifact_id: "artifact_img_001",
        visual_route_type: "image_with_motion",
        motion_artifact_id: "artifact_motion_001",
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "ready",
        notes: [],
      },
    ],
    readiness: "ready_for_compose",
    notes: [],
  };
}

function makeReadyTimeline(manifest = makeReadyManifest()): ComposeTimeline {
  return buildComposeTimeline({
    assetManifestRecordId: "asset_manifest_record_001",
    assetPlanRecordId: "asset_plan_record_001",
    storyboardRecordId: "storyboard_record_001",
    scriptRecordId: "script_record_001",
    manifest,
  });
}

describe("validateComposeTimeline", () => {
  it("returns ready_for_render for a valid timeline", async () => {
    const manifest = makeReadyManifest();
    const result = await validateComposeTimeline({
      manifest,
      timeline: makeReadyTimeline(manifest),
    });

    expect(result).toMatchObject({
      stage: "compose_local_validation",
      decision: "ready_for_render",
      errors: [],
      warnings: [],
      metrics: {
        track_count: 3,
        clip_count: 3,
        segment_count: 1,
        duration_sec: 12,
      },
    });
  });

  it("blocks when narration is missing", async () => {
    const manifest = makeReadyManifest();
    const timeline = makeReadyTimeline(manifest);
    timeline.tracks = timeline.tracks.filter(
      (track) => track.track_type !== "narration",
    );

    const result = await validateComposeTimeline({ manifest, timeline });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("compose_narration_missing");
  });

  it("blocks when narration duration is missing", async () => {
    const manifest = makeReadyManifest();
    const timeline = makeReadyTimeline(manifest) as unknown as {
      tracks: Array<{ track_type: string; clips: Array<{ duration_sec: number }> }>;
    } & ComposeTimeline;
    timeline.tracks.find((track) => track.track_type === "narration")!.clips[0]
      .duration_sec = 0;

    const result = await validateComposeTimeline({ manifest, timeline });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("compose_narration_duration_missing");
  });

  it("blocks when subtitle is missing", async () => {
    const manifest = makeReadyManifest();
    manifest.audio_summary.subtitle_artifact_id = null;
    const timeline = makeReadyTimeline(makeReadyManifest());
    timeline.tracks = timeline.tracks.filter(
      (track) => track.track_type !== "subtitle",
    );

    const result = await validateComposeTimeline({ manifest, timeline });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("compose_subtitle_missing");
  });

  it("blocks when a segment has no visual clip", async () => {
    const manifest = makeReadyManifest();
    const timeline = makeReadyTimeline(manifest);
    timeline.segments[0].visual_clip_ids = [];

    const result = await validateComposeTimeline({ manifest, timeline });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("compose_segment_visual_missing");
  });

  it("blocks when a timeline clip references a missing artifact", async () => {
    const manifest = makeReadyManifest();
    const timeline = makeReadyTimeline(manifest);
    timeline.tracks.find((track) => track.track_type === "visual")!.clips[0]
      .artifact_id = "artifact_missing";

    const result = await validateComposeTimeline({ manifest, timeline });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("compose_artifact_missing");
  });

  it("keeps missing optional BGM as a non-blocking warning", async () => {
    const manifest = makeReadyManifest();
    manifest.audio_summary.bgm_placements = [
      {
        bgm_placement_id: "bgm_001",
        scope: "global",
        artifact_id: null,
        start_policy: "timeline_start",
        end_policy: "timeline_end",
        segment_ids: [],
        volume: 0.3,
        fade_in_sec: 0,
        fade_out_sec: 0,
      },
    ];
    const timeline = makeReadyTimeline(manifest);

    const result = await validateComposeTimeline({ manifest, timeline });

    expect(result.decision).toBe("partial");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("compose_bgm_missing_optional");
  });

  it("blocks when a referenced local file is missing", async () => {
    const manifest = makeReadyManifest();
    manifest.artifacts.push({
      artifact_id: "artifact_missing_file",
      artifact_type: "sfx_audio",
      origin: "local",
      file_uri: "local://missing.wav",
      created_at: "2026-05-17T00:00:00.000Z",
      metadata: {
        duration_sec: 1,
      },
    } satisfies AssetArtifact);
    const timeline = makeReadyTimeline(manifest);
    timeline.tracks.push({
      track_id: "track_sfx",
      track_type: "sfx",
      clips: [
        {
          clip_id: "clip_sfx_001",
          segment_id: "sb_001",
          artifact_id: "artifact_missing_file",
          start_sec: 0,
          duration_sec: 1,
          clip_kind: "audio",
          motion_artifact_id: null,
          notes: [],
        },
      ],
    });

    const result = await validateComposeTimeline({
      manifest,
      timeline,
      projectStorageRootDir: "D:/path/that/does/not/exist",
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("compose_artifact_file_missing");
  });
});
