import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildRemotionInputProps } from "../../../backend/src/modules/render/remotion-input-builder.js";
import type { AssetManifest, ComposeTimeline } from "../../../shared/src/index.js";

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const DEFAULT_SUBTITLE_CONTENT =
  "1\n00:00:00,000 --> 00:00:02,000\nHello.\n";

type SubtitleTimingSource =
  | "estimated"
  | "audio_probe"
  | "audio_probe_proportional"
  | "provider_timestamp"
  | "forced_alignment"
  | "mixed"
  | "provider"
  | "aligned";

interface SubtitleFixtureOptions {
  subtitleContent?: string;
  subtitleTimingSource?: SubtitleTimingSource;
}

async function writeFixtureFiles(
  rootDir: string,
  options?: SubtitleFixtureOptions,
) {
  const mediaDir = join(rootDir, "media");
  await mkdir(mediaDir, { recursive: true });

  const imagePath = join(mediaDir, "still.png");
  const videoPath = join(mediaDir, "clip.mp4");
  const narrationPath = join(mediaDir, "narration.wav");
  const bgmPath = join(mediaDir, "bgm.wav");
  const sfxPath = join(mediaDir, "sfx.wav");
  const subtitlePath = join(mediaDir, "subtitle.srt");

  await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));
  await writeFile(videoPath, "fake video bytes", "utf8");
  await writeFile(narrationPath, "fake audio bytes", "utf8");
  await writeFile(bgmPath, "fake bgm bytes", "utf8");
  await writeFile(sfxPath, "fake sfx bytes", "utf8");
  await writeFile(
    subtitlePath,
    options?.subtitleContent ?? DEFAULT_SUBTITLE_CONTENT,
    "utf8",
  );

  return { imagePath, videoPath, narrationPath, bgmPath, sfxPath, subtitlePath };
}

function makeTimelineWithTwoVisualsAndNarration(): ComposeTimeline {
  return {
    timeline_version: "compose_timeline_v1",
    source_asset_manifest_record_id: "asset_manifest_001",
    source_asset_plan_record_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    output_profile: {
      aspect_ratio: "9:16",
      width: 540,
      height: 960,
      fps: 30,
    },
    duration_sec: 4,
    tracks: [
      {
        track_id: "track_visual",
        track_type: "visual",
        clips: [
          {
            clip_id: "clip_visual_001",
            segment_id: "sb_001",
            artifact_id: "artifact_img_001",
            start_sec: 0,
            duration_sec: 2,
            clip_kind: "image_with_motion",
            motion_artifact_id: "artifact_motion_001",
            notes: [],
          },
          {
            clip_id: "clip_visual_002",
            segment_id: "sb_002",
            artifact_id: "artifact_video_001",
            start_sec: 2,
            duration_sec: 2,
            clip_kind: "video",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
      {
        track_id: "track_narration",
        track_type: "narration",
        clips: [
          {
            clip_id: "clip_narration",
            segment_id: null,
            artifact_id: "artifact_tts_merged",
            start_sec: 0,
            duration_sec: 4,
            clip_kind: "audio",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
      {
        track_id: "track_subtitle",
        track_type: "subtitle",
        clips: [
          {
            clip_id: "clip_subtitle",
            segment_id: null,
            artifact_id: "artifact_subtitle",
            start_sec: 0,
            duration_sec: 4,
            clip_kind: "subtitle",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
      {
        track_id: "track_bgm",
        track_type: "bgm",
        clips: [
          {
            clip_id: "clip_bgm_001",
            segment_id: null,
            artifact_id: "artifact_bgm_001",
            start_sec: 0,
            duration_sec: 4,
            clip_kind: "audio",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
      {
        track_id: "track_sfx",
        track_type: "sfx",
        clips: [
          {
            clip_id: "clip_sfx_001",
            segment_id: "sb_002",
            artifact_id: "artifact_sfx_001",
            start_sec: 2,
            duration_sec: 1,
            clip_kind: "audio",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
    ],
    segments: [
      {
        segment_id: "sb_001",
        start_sec: 0,
        duration_sec: 2,
        visual_clip_ids: ["clip_visual_001"],
        narration_clip_ids: ["clip_narration"],
        subtitle_clip_ids: ["clip_subtitle"],
        notes: [],
      },
      {
        segment_id: "sb_002",
        start_sec: 2,
        duration_sec: 2,
        visual_clip_ids: ["clip_visual_002"],
        narration_clip_ids: ["clip_narration"],
        subtitle_clip_ids: ["clip_subtitle"],
        notes: [],
      },
    ],
    readiness: "ready_for_render",
    notes: [],
  };
}

function makeManifestWithImageMotionNarrationSubtitle(
  input: {
    imagePath: string;
    videoPath: string;
    narrationPath: string;
    bgmPath: string;
    sfxPath: string;
    subtitlePath: string;
  },
  options?: SubtitleFixtureOptions,
): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_1",
      enabled_provider_types: ["tts", "image", "video"],
      allow_manual_placeholders: false,
    },
    executions: [],
    artifacts: [
      {
        artifact_id: "artifact_img_001",
        artifact_type: "image",
        origin: "local",
        file_uri: input.imagePath,
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: { width: 540, height: 960 },
      },
      {
        artifact_id: "artifact_video_001",
        artifact_type: "video",
        origin: "local",
        file_uri: input.videoPath,
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: { duration_sec: 2, width: 540, height: 960, fps: 30 },
      },
      {
        artifact_id: "artifact_motion_001",
        artifact_type: "motion_recipe",
        origin: "inline",
        file_uri: "inline://motion-recipe/motion_001",
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          recipe_type: "slow_push_in",
          source_image_artifact_id: "artifact_img_001",
          parameters: { distance_pct: 3 },
        },
      },
      {
        artifact_id: "artifact_tts_merged",
        artifact_type: "tts_merged_audio",
        origin: "local",
        file_uri: input.narrationPath,
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          duration_sec: 4,
          voice_profile_id: "voice_1",
          chunk_artifact_ids: ["artifact_tts_chunk_001"],
        },
      },
      {
        artifact_id: "artifact_subtitle",
        artifact_type: "subtitle_track",
        origin: "local",
        file_uri: input.subtitlePath,
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          format: "srt",
          source_tts_artifact_id: "artifact_tts_merged",
          caption_count: 1,
          ...(options?.subtitleTimingSource
            ? { timing_source: options.subtitleTimingSource }
            : {}),
        },
      },
      {
        artifact_id: "artifact_bgm_001",
        artifact_type: "bgm_audio",
        origin: "library",
        file_uri: input.bgmPath,
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          duration_sec: 4,
          loopable: true,
        },
      },
      {
        artifact_id: "artifact_sfx_001",
        artifact_type: "sfx_audio",
        origin: "library",
        file_uri: input.sfxPath,
        created_at: "2026-05-20T00:00:00.000Z",
        metadata: {
          duration_sec: 1,
        },
      },
    ],
    audio_summary: {
      voice_profile_id: "voice_1",
      tts_total_duration_sec: 4,
      tts_chunk_artifact_ids: ["artifact_tts_chunk_001"],
      tts_chunk_routes: [],
      tts_merged_artifact_id: "artifact_tts_merged",
      subtitle_artifact_id: "artifact_subtitle",
      bgm_placements: [
        {
          bgm_placement_id: "bgm_place_001",
          scope: "global",
          artifact_id: "artifact_bgm_001",
          start_policy: "timeline_start",
          end_policy: "timeline_end",
          segment_ids: [],
          volume: 0.22,
          fade_in_sec: 1.5,
          fade_out_sec: 2,
        },
      ],
      sfx_artifact_ids: ["artifact_sfx_001"],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: "artifact_tts_merged",
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
      {
        segment_id: "sb_002",
        tts_artifact_id: "artifact_tts_merged",
        subtitle_artifact_id: "artifact_subtitle",
        primary_visual_artifact_id: "artifact_video_001",
        visual_route_type: "video_clip",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: ["artifact_sfx_001"],
        bgm_placement_ids: [],
        readiness: "ready",
        notes: [],
      },
    ],
    readiness: "ready_for_compose",
    notes: [],
  };
}

describe("buildRemotionInputProps", () => {
  it("normalizes visual, narration, subtitle, and motion props", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "remotion-input-builder-"));
    const files = await writeFixtureFiles(tempDir, {
      // 显式声明为 forced_alignment 以避免触发字幕缩放，让本用例聚焦 visual/audio 提取
      subtitleTimingSource: "forced_alignment",
    });

    const props = await buildRemotionInputProps({
      timeline: makeTimelineWithTwoVisualsAndNarration(),
      manifest: makeManifestWithImageMotionNarrationSubtitle(files, {
        subtitleTimingSource: "forced_alignment",
      }),
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    expect(props.visualClips).toMatchObject([
      {
        clipId: "clip_visual_001",
        artifactId: "artifact_img_001",
        mediaType: "image",
        startSec: 0,
        durationSec: 2,
        motion: {
          recipeType: "slow_push_in",
          parameters: { distance_pct: 3 },
        },
      },
      {
        clipId: "clip_visual_002",
        artifactId: "artifact_video_001",
        mediaType: "video",
        startSec: 2,
        durationSec: 2,
        transition: { type: "crossfade", durationSec: 0.25 },
      },
    ]);
    expect(props.visualClips[0]?.src).toBe("remotion-static://media/still.png");
    expect(props.visualClips[1]?.src).toBe("remotion-static://media/clip.mp4");
    expect(props.audioClips).toMatchObject([
      {
        clipId: "clip_narration",
        artifactId: "artifact_tts_merged",
        role: "narration",
        startSec: 0,
        durationSec: 4,
        volume: 1,
      },
      {
        clipId: "clip_bgm_001",
        artifactId: "artifact_bgm_001",
        role: "bgm",
        startSec: 0,
        durationSec: 4,
        volume: 0.22,
        fadeInSec: 1.5,
        fadeOutSec: 2,
        loop: true,
        sourceDurationSec: 4,
      },
      {
        clipId: "clip_sfx_001",
        artifactId: "artifact_sfx_001",
        role: "sfx",
        startSec: 2,
        durationSec: 1,
        volume: 0.8,
      },
    ]);
    expect(props.audioClips[0]?.src).toMatch(/^data:audio\/wav;base64,/);
    expect(props.audioClips[1]?.src).toMatch(/^data:audio\/wav;base64,/);
    expect(props.audioClips[2]?.src).toMatch(/^data:audio\/wav;base64,/);
    expect(props.audioClips).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: "artifact_bgm_001",
          role: "bgm",
          volume: 0.22,
        }),
        expect.objectContaining({
          artifactId: "artifact_sfx_001",
          role: "sfx",
          volume: 0.8,
        }),
      ]),
    );
    expect(
      props.audioClips
        .filter((clip) => clip.role === "bgm" || clip.role === "sfx")
        .every((clip) => clip.src.startsWith("data:audio/")),
    ).toBe(true);
    expect(
      (props.assetManifest as AssetManifest).artifacts.some((artifact) =>
        artifact.file_uri.startsWith("data:"),
      ),
    ).toBe(false);
    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 2, text: "Hello." },
    ]);
    expect(props.subtitleStyle).toMatchObject({
      position: "bottom",
      text_align: "center",
    });
  });

  it("keeps overlong persisted video clip as a single clip and relies on Remotion last-frame freeze", async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), "remotion-input-builder-video-tail-"),
    );
    const files = await writeFixtureFiles(tempDir, {
      subtitleTimingSource: "forced_alignment",
    });
    const manifest = makeManifestWithImageMotionNarrationSubtitle(files, {
      subtitleTimingSource: "forced_alignment",
    });
    const videoArtifact = manifest.artifacts.find(
      (artifact) => artifact.artifact_id === "artifact_video_001",
    );
    if (videoArtifact?.artifact_type === "video") {
      videoArtifact.metadata.duration_sec = 1;
    }
    manifest.segment_routes[1] = {
      ...manifest.segment_routes[1]!,
      fallback_visual_artifact_id: "artifact_img_001",
    };

    const props = await buildRemotionInputProps({
      timeline: makeTimelineWithTwoVisualsAndNarration(),
      manifest,
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    expect(props.visualClips).toMatchObject([
      {
        clipId: "clip_visual_001",
        artifactId: "artifact_img_001",
        mediaType: "image",
        startSec: 0,
        durationSec: 2,
      },
      {
        clipId: "clip_visual_002",
        artifactId: "artifact_video_001",
        mediaType: "video",
        startSec: 2,
        durationSec: 2,
      },
    ]);
    expect(
      props.audioClips?.find((clip) => clip.role === "narration"),
    ).toMatchObject({
      startSec: 0,
      durationSec: 4,
    });
    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 2, text: "Hello." },
    ]);
  });

  it("按比例缩放字幕 cue 到 narration 真实时长（estimated timing_source，drift 超过阈值）", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "remotion-input-builder-scale-"));
    const subtitleContent =
      "1\n00:00:00,000 --> 00:00:02,500\n第一句。\n\n2\n00:00:02,500 --> 00:00:05,000\n第二句。\n";
    const files = await writeFixtureFiles(tempDir, {
      subtitleContent,
      subtitleTimingSource: "estimated",
    });

    const props = await buildRemotionInputProps({
      timeline: makeTimelineWithTwoVisualsAndNarration(),
      manifest: makeManifestWithImageMotionNarrationSubtitle(files, {
        subtitleTimingSource: "estimated",
      }),
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    // narration clip duration = 4s，cue 总时长 = 5s，缩放系数 = 4/5 = 0.8
    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 2, text: "第一句。" },
      { start_sec: 2, end_sec: 4, text: "第二句。" },
    ]);
  });

  it("drift 小于阈值时不缩放字幕 cue", async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), "remotion-input-builder-no-scale-drift-"),
    );
    // narration duration = 4s，cue 总时长 = 4.05s，drift = 0.05s < 0.1s
    const subtitleContent =
      "1\n00:00:00,000 --> 00:00:04,050\n整段。\n";
    const files = await writeFixtureFiles(tempDir, {
      subtitleContent,
      subtitleTimingSource: "estimated",
    });

    const props = await buildRemotionInputProps({
      timeline: makeTimelineWithTwoVisualsAndNarration(),
      manifest: makeManifestWithImageMotionNarrationSubtitle(files, {
        subtitleTimingSource: "estimated",
      }),
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 4.05, text: "整段。" },
    ]);
  });

  it("timing_source 为 forced_alignment 时即使 drift 超过阈值也不缩放", async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), "remotion-input-builder-forced-align-"),
    );
    // narration duration = 4s，cue 总时长 = 5s，drift = 1s，但 timing_source 是 forced_alignment
    const subtitleContent =
      "1\n00:00:00,000 --> 00:00:05,000\n已对齐。\n";
    const files = await writeFixtureFiles(tempDir, {
      subtitleContent,
      subtitleTimingSource: "forced_alignment",
    });

    const props = await buildRemotionInputProps({
      timeline: makeTimelineWithTwoVisualsAndNarration(),
      manifest: makeManifestWithImageMotionNarrationSubtitle(files, {
        subtitleTimingSource: "forced_alignment",
      }),
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 5, text: "已对齐。" },
    ]);
  });
});
