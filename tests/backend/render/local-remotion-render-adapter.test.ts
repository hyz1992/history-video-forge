import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createLocalRemotionRenderAdapter,
  resolveLocalRemotionRenderConcurrency,
} from "../../../backend/src/modules/render/local-remotion-render-adapter.js";
import { buildRemotionInputProps } from "../../../backend/src/modules/render/remotion-input-builder.js";
import type {
  AssetManifestRecord,
  ComposeRecord,
} from "../../../backend/src/db/client.js";
import type { AssetManifest, ComposeTimeline } from "../../../shared/src/index.js";

const ONE_BY_ONE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const TINY_WAV_BASE64 =
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";

async function writeFixtureFiles(rootDir: string) {
  const mediaDir = join(rootDir, "media");
  await mkdir(mediaDir, { recursive: true });

  const imagePath = join(mediaDir, "still.png");
  const narrationPath = join(mediaDir, "narration.wav");
  const subtitlePath = join(mediaDir, "subtitle.srt");

  await writeFile(imagePath, Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64"));
  await writeFile(narrationPath, Buffer.from(TINY_WAV_BASE64, "base64"));
  await writeFile(
    subtitlePath,
    "1\n00:00:00,000 --> 00:00:02,000\nOpening pressure.\n",
    "utf8",
  );

  return { imagePath, narrationPath, subtitlePath };
}

function makeReadyComposeTimeline(durationSec: number): ComposeTimeline {
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
    duration_sec: durationSec,
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
            duration_sec: durationSec,
            clip_kind: "image_only",
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
            duration_sec: durationSec,
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
            duration_sec: durationSec,
            clip_kind: "subtitle",
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
        duration_sec: durationSec,
        visual_clip_ids: ["clip_visual_001"],
        narration_clip_ids: ["clip_narration"],
        subtitle_clip_ids: ["clip_subtitle"],
        notes: [],
      },
    ],
    readiness: "ready_for_render",
    notes: [],
  };
}

function makeReadyComposeRecord(durationSec: number): ComposeRecord {
  return {
    id: "compose_001",
    projectId: "project_001",
    assetManifestRecordId: "asset_manifest_001",
    timelineJson: makeReadyComposeTimeline(durationSec),
    validationResultJson: {
      stage: "compose_local_validation",
      decision: "ready_for_render",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
  };
}

function makeReadyAssetManifestRecordWithFixtureFiles(input: {
  imagePath: string;
  narrationPath: string;
  subtitlePath: string;
  durationSec: number;
}): AssetManifestRecord {
  const manifest: AssetManifest = {
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
        artifact_id: "artifact_tts_merged",
        artifact_type: "tts_merged_audio",
        origin: "local",
        file_uri: input.narrationPath,
        created_at: "2026-05-18T00:00:00.000Z",
        metadata: {
          duration_sec: input.durationSec,
          voice_profile_id: "voice_1",
          chunk_artifact_ids: ["artifact_tts_chunk_001"],
        },
      },
      {
        artifact_id: "artifact_subtitle",
        artifact_type: "subtitle_track",
        origin: "local",
        file_uri: input.subtitlePath,
        created_at: "2026-05-18T00:00:00.000Z",
        metadata: {
          format: "srt",
          source_tts_artifact_id: "artifact_tts_merged",
          caption_count: 1,
        },
      },
      {
        artifact_id: "artifact_img_001",
        artifact_type: "image",
        origin: "local",
        file_uri: input.imagePath,
        created_at: "2026-05-18T00:00:00.000Z",
        metadata: {
          width: 1,
          height: 1,
        },
      },
    ],
    audio_summary: {
      voice_profile_id: "voice_1",
      tts_total_duration_sec: input.durationSec,
      tts_chunk_artifact_ids: ["artifact_tts_chunk_001"],
      tts_chunk_routes: [],
      tts_merged_artifact_id: "artifact_tts_merged",
      subtitle_artifact_id: "artifact_subtitle",
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: "artifact_tts_merged",
        subtitle_artifact_id: "artifact_subtitle",
        primary_visual_artifact_id: "artifact_img_001",
        visual_route_type: "image_only",
        motion_artifact_id: null,
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

  return {
    id: "asset_manifest_001",
    projectId: "project_001",
    topicPackageId: "topic_001",
    scriptRecordId: "script_001",
    storyboardRecordId: "storyboard_001",
    assetPlanRecordId: "asset_plan_001",
    manifestJson: manifest,
    validationResultJson: {
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
  };
}

describe("local Remotion render adapter", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  it("uses single-frame render concurrency by default to avoid browser tab cycling", () => {
    expect(resolveLocalRemotionRenderConcurrency()).toBe(1);
    expect(resolveLocalRemotionRenderConcurrency(3)).toBe(3);
  });

  it("passes subtitle cues and style into Remotion input props", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "local-remotion-props-"));
    const fixtureFiles = await writeFixtureFiles(tempDir);
    const props = await buildRemotionInputProps({
      timeline: makeReadyComposeTimeline(2),
      manifest: makeReadyAssetManifestRecordWithFixtureFiles({
        ...fixtureFiles,
        durationSec: 2,
      }).manifestJson as AssetManifest,
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 2, text: "Opening pressure." },
    ]);
    expect(props.subtitleStyle).toMatchObject({
      position: "bottom",
      text_align: "center",
    });
  });

  it("renders a fixture timeline to a local MP4 artifact", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "local-remotion-render-"));
    const fixtureFiles = await writeFixtureFiles(tempDir);
    const adapter = createLocalRemotionRenderAdapter();

    const result = await adapter.render({
      projectId: "project_001",
      composeRecord: makeReadyComposeRecord(2),
      assetManifestRecord: makeReadyAssetManifestRecordWithFixtureFiles({
        ...fixtureFiles,
        durationSec: 2,
      }),
      outputDir: tempDir,
      profile: { width: 540, height: 960, fps: 30 },
    });

    expect(result.outputArtifact.mime_type).toBe("video/mp4");
    expect(result.outputArtifact.file_uri).toContain("output.mp4");
    expect(result.outputArtifact.source_compose_record_id).toBe("compose_001");
    expect(result.outputArtifact.source_asset_manifest_record_id).toBe(
      "asset_manifest_001",
    );
    expect(result.probe.duration_sec).toBeGreaterThan(1.8);
    expect(result.probe.width).toBe(540);
    expect(result.probe.height).toBe(960);
    expect(result.probe.fps).toBe(30);
    // file_size_bytes must be present and > 0 for real rendered videos
    expect((result.outputArtifact.metadata as Record<string,unknown>).file_size_bytes).toBeGreaterThan(0);
    expect(result.diagnostics).toMatchObject({
      renderer: "remotion",
      composition_id: "TimelineVideo",
      render_concurrency: 1,
    });
    await expect(stat(result.outputArtifact.file_uri)).resolves.toBeTruthy();
  }, 120_000);

  it("renders successfully even when manifest contains Date objects in artifacts/executions", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "local-remotion-date-"));
    const fixtureFiles = await writeFixtureFiles(tempDir);
    const adapter = createLocalRemotionRenderAdapter();

    const record = makeReadyAssetManifestRecordWithFixtureFiles({
      ...fixtureFiles,
      durationSec: 2,
    });
    // Simulate db persistence reviving ISO strings back to Date objects
    const manifestWithDates = JSON.parse(
      JSON.stringify(record.manifestJson),
      (_key, value) => {
        if (
          typeof value === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
        ) {
          return new Date(value);
        }
        return value;
      },
    );
    record.manifestJson = manifestWithDates;

    const result = await adapter.render({
      projectId: "project_date_001",
      composeRecord: makeReadyComposeRecord(2),
      assetManifestRecord: record,
      outputDir: tempDir,
      profile: { width: 540, height: 960, fps: 30 },
    });

    // Should NOT fail with Zod schema error — dates are normalized before parse
    expect(result.outputArtifact.mime_type).toBe("video/mp4");
    expect(result.probe.duration_sec).toBeGreaterThan(1.8);
  }, 120_000);
});
