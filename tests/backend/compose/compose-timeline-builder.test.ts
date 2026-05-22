import { describe, expect, it } from "vitest";

import { buildComposeTimeline } from "../../../backend/src/modules/compose/compose-timeline-builder.js";
import type { AssetManifest } from "../../../shared/src/index.js";

function makeArtifactManifest(): AssetManifest {
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

describe("buildComposeTimeline", () => {
  it("builds a ready timeline from image motion, narration, and subtitle artifacts", () => {
    const timeline = buildComposeTimeline({
      assetManifestRecordId: "asset_manifest_record_001",
      assetPlanRecordId: "asset_plan_record_001",
      storyboardRecordId: "storyboard_record_001",
      scriptRecordId: "script_record_001",
      manifest: makeArtifactManifest(),
    });

    expect(timeline).toMatchObject({
      timeline_version: "compose_timeline_v1",
      source_asset_manifest_record_id: "asset_manifest_record_001",
      source_asset_plan_record_id: "asset_plan_record_001",
      source_storyboard_record_id: "storyboard_record_001",
      source_script_record_id: "script_record_001",
      duration_sec: 15,
      readiness: "ready_for_render",
    });
    expect(timeline.output_profile).toEqual({
      aspect_ratio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(
      timeline.tracks.find((track) => track.track_type === "visual")?.clips[0],
    ).toMatchObject({
      segment_id: "sb_001",
      artifact_id: "artifact_img_001",
      start_sec: 0,
      duration_sec: 15,
      clip_kind: "image_with_motion",
      motion_artifact_id: "artifact_motion_001",
    });
    expect(
      timeline.tracks.find((track) => track.track_type === "narration")
        ?.clips[0],
    ).toMatchObject({
      artifact_id: "artifact_tts_merged",
      start_sec: 0,
      duration_sec: 12,
      clip_kind: "audio",
    });
    expect(
      timeline.tracks.find((track) => track.track_type === "subtitle")
        ?.clips[0],
    ).toMatchObject({
      artifact_id: "artifact_subtitle",
      start_sec: 0,
      duration_sec: 12,
      clip_kind: "subtitle",
    });
  });

  it("falls back to merged narration duration when chunk timing is unavailable", () => {
    const manifest = makeArtifactManifest();
    manifest.audio_summary.tts_chunk_routes = [];
    manifest.audio_summary.tts_chunk_artifact_ids = [];
    manifest.segment_routes = [
      manifest.segment_routes[0],
      {
        ...manifest.segment_routes[0],
        segment_id: "sb_002",
        tts_artifact_id: null,
      },
    ];

    const timeline = buildComposeTimeline({
      assetManifestRecordId: "asset_manifest_record_001",
      assetPlanRecordId: "asset_plan_record_001",
      storyboardRecordId: "storyboard_record_001",
      scriptRecordId: "script_record_001",
      manifest,
    });

    expect(timeline.notes).toContain("compose_chunk_timing_fallback_used");
    expect(timeline.segments).toMatchObject([
      { segment_id: "sb_001", start_sec: 0, duration_sec: 6 },
      { segment_id: "sb_002", start_sec: 6, duration_sec: 9 },
    ]);
  });

  it("accumulates multiple TTS chunk durations routed to the same segment", () => {
    const manifest = makeArtifactManifest();
    manifest.artifacts = [
      {
        ...manifest.artifacts[0],
        artifact_id: "artifact_tts_chunk_001",
        metadata: {
          ...manifest.artifacts[0]!.metadata,
          duration_sec: 1.5,
          tts_chunk_id: "tts_chunk_001",
          segment_ids: ["sb_001"],
        },
      },
      {
        ...manifest.artifacts[0],
        artifact_id: "artifact_tts_chunk_002",
        metadata: {
          ...manifest.artifacts[0]!.metadata,
          duration_sec: 2.5,
          tts_chunk_id: "tts_chunk_002",
          segment_ids: ["sb_001"],
        },
      },
      {
        ...manifest.artifacts[0],
        artifact_id: "artifact_tts_chunk_003",
        metadata: {
          ...manifest.artifacts[0]!.metadata,
          duration_sec: 3,
          tts_chunk_id: "tts_chunk_003",
          segment_ids: ["sb_002"],
        },
      },
      {
        ...manifest.artifacts[1],
        metadata: {
          ...manifest.artifacts[1]!.metadata,
          duration_sec: 7,
          chunk_artifact_ids: [
            "artifact_tts_chunk_001",
            "artifact_tts_chunk_002",
            "artifact_tts_chunk_003",
          ],
        },
      },
      manifest.artifacts[2]!,
      manifest.artifacts[3]!,
      manifest.artifacts[4]!,
    ];
    manifest.audio_summary.tts_total_duration_sec = 7;
    manifest.audio_summary.tts_chunk_artifact_ids = [
      "artifact_tts_chunk_001",
      "artifact_tts_chunk_002",
      "artifact_tts_chunk_003",
    ];
    manifest.audio_summary.tts_chunk_routes = [
      {
        tts_chunk_id: "tts_chunk_001",
        artifact_id: "artifact_tts_chunk_001",
        segment_ids: ["sb_001"],
        script_excerpt: "first part",
      },
      {
        tts_chunk_id: "tts_chunk_002",
        artifact_id: "artifact_tts_chunk_002",
        segment_ids: ["sb_001"],
        script_excerpt: "second part",
      },
      {
        tts_chunk_id: "tts_chunk_003",
        artifact_id: "artifact_tts_chunk_003",
        segment_ids: ["sb_002"],
        script_excerpt: "third part",
      },
    ];
    manifest.segment_routes = [
      manifest.segment_routes[0]!,
      {
        ...manifest.segment_routes[0]!,
        segment_id: "sb_002",
        tts_artifact_id: "artifact_tts_chunk_003",
      },
    ];

    const timeline = buildComposeTimeline({
      assetManifestRecordId: "asset_manifest_record_001",
      assetPlanRecordId: "asset_plan_record_001",
      storyboardRecordId: "storyboard_record_001",
      scriptRecordId: "script_record_001",
      manifest,
    });

    expect(timeline.duration_sec).toBe(10);
    expect(timeline.segments.map((segment) => segment.duration_sec)).toEqual([
      4,
      6,
    ]);
    expect(timeline.notes).not.toContain("compose_chunk_timing_fallback_used");
  });

  it("adds optional BGM track when a concrete bgm_audio artifact is placed", () => {
    const manifest = makeArtifactManifest();
    manifest.artifacts.push({
      artifact_id: "artifact_bgm_001",
      artifact_type: "bgm_audio",
      origin: "library",
      file_uri: "memory://bgm.wav",
      created_at: "2026-05-20T00:00:00.000Z",
      metadata: {
        duration_sec: 30,
        loopable: true,
      },
    });
    manifest.audio_summary.bgm_placements = [
      {
        bgm_placement_id: "bgm_place_001",
        scope: "global",
        artifact_id: "artifact_bgm_001",
        start_policy: "timeline_start",
        end_policy: "timeline_end",
        segment_ids: [],
        volume: 0.22,
        fade_in_sec: 0,
        fade_out_sec: 1,
      },
    ];

    const timeline = buildComposeTimeline({
      assetManifestRecordId: "asset_manifest_record_001",
      assetPlanRecordId: "asset_plan_record_001",
      storyboardRecordId: "storyboard_record_001",
      scriptRecordId: "script_record_001",
      manifest,
    });

    const bgmTrack = timeline.tracks.find((track) => track.track_type === "bgm");
    expect(bgmTrack?.clips).toMatchObject([
      {
        clip_kind: "audio",
        artifact_id: "artifact_bgm_001",
        start_sec: 0,
        duration_sec: timeline.duration_sec,
      },
    ]);
  });

  it("adds SFX track from concrete segment route sfx artifacts", () => {
    const manifest = makeArtifactManifest();
    manifest.artifacts.push({
      artifact_id: "artifact_sfx_001",
      artifact_type: "sfx_audio",
      origin: "library",
      file_uri: "memory://sfx.wav",
      created_at: "2026-05-20T00:00:00.000Z",
      metadata: {
        duration_sec: 2,
      },
    });
    manifest.audio_summary.sfx_artifact_ids = ["artifact_sfx_001"];
    manifest.segment_routes[0]!.sfx_artifact_ids = ["artifact_sfx_001"];

    const timeline = buildComposeTimeline({
      assetManifestRecordId: "asset_manifest_record_001",
      assetPlanRecordId: "asset_plan_record_001",
      storyboardRecordId: "storyboard_record_001",
      scriptRecordId: "script_record_001",
      manifest,
    });

    const sfxTrack = timeline.tracks.find((track) => track.track_type === "sfx");
    expect(sfxTrack?.clips).toMatchObject([
      {
        clip_kind: "audio",
        artifact_id: "artifact_sfx_001",
        segment_id: "sb_001",
        start_sec: 0,
        duration_sec: 2,
      },
    ]);
  });

  it("consumes concrete BGM/SFX audio artifacts and ignores unplaced selections", () => {
    const manifest = makeArtifactManifest();
    manifest.artifacts.push(
      {
        artifact_id: "artifact_bgm_001",
        artifact_type: "bgm_audio",
        origin: "library",
        file_uri: "memory://bgm.wav",
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          duration_sec: 30,
          loopable: true,
        },
      },
      {
        artifact_id: "artifact_sfx_001",
        artifact_type: "sfx_audio",
        origin: "library",
        file_uri: "memory://sfx.wav",
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          duration_sec: 2,
        },
      },
      {
        artifact_id: "artifact_bgm_selection_001",
        artifact_type: "bgm_selection",
        origin: "library",
        file_uri: "library://bgm/selection-only",
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          library_item_id: "bgm_selection_only",
        },
      },
    );
    manifest.audio_summary.bgm_placements = [
      {
        bgm_placement_id: "bgm_place_001",
        scope: "global",
        artifact_id: "artifact_bgm_001",
        start_policy: "timeline_start",
        end_policy: "timeline_end",
        segment_ids: [],
        volume: 0.22,
        fade_in_sec: 0,
        fade_out_sec: 1,
      },
    ];
    manifest.audio_summary.sfx_artifact_ids = ["artifact_sfx_001"];
    manifest.segment_routes[0]!.sfx_artifact_ids = ["artifact_sfx_001"];

    const timeline = buildComposeTimeline({
      assetManifestRecordId: "asset_manifest_record_001",
      assetPlanRecordId: "asset_plan_record_001",
      storyboardRecordId: "storyboard_record_001",
      scriptRecordId: "script_record_001",
      manifest,
    });

    expect(timeline.tracks.find((track) => track.track_type === "bgm")).toMatchObject({
      track_id: "track_bgm",
      track_type: "bgm",
      clips: [
        {
          clip_kind: "audio",
          artifact_id: "artifact_bgm_001",
        },
      ],
    });
    expect(timeline.tracks.find((track) => track.track_type === "sfx")).toMatchObject({
      track_id: "track_sfx",
      track_type: "sfx",
      clips: [
        {
          clip_kind: "audio",
          artifact_id: "artifact_sfx_001",
        },
      ],
    });
    expect(
      timeline.tracks
        .flatMap((track) => track.clips)
        .some((clip) => clip.artifact_id === "artifact_bgm_selection_001"),
    ).toBe(false);
  });
});
