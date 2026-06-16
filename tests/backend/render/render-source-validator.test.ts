import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { validateRenderSources } from "../../../backend/src/modules/render/render-source-validator.js";
import type {
  AssetArtifact,
  AssetManifest,
  ComposeTimeline,
} from "../../../shared/src/index.js";
import type {
  AssetManifestRecord,
  ComposeRecord,
} from "../../../backend/src/db/client.js";

function makeReadyComposeTimeline(): ComposeTimeline {
  return {
    timeline_version: "compose_timeline_v1",
    source_asset_manifest_record_id: "asset_manifest_001",
    source_asset_plan_record_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    output_profile: {
      aspect_ratio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
    },
    duration_sec: 12,
    tracks: [
      {
        track_id: "track_visual",
        track_type: "visual",
        clips: [
          {
            clip_id: "clip_visual_sb_001",
            segment_id: "sb_001",
            artifact_id: "artifact_img_001",
            start_sec: 0,
            duration_sec: 12,
            clip_kind: "image_with_motion",
            motion_artifact_id: "artifact_motion_001",
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
            duration_sec: 12,
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
            duration_sec: 12,
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
        duration_sec: 12,
        visual_clip_ids: ["clip_visual_sb_001"],
        narration_clip_ids: ["clip_narration"],
        subtitle_clip_ids: ["clip_subtitle"],
        notes: [],
      },
    ],
    readiness: "ready_for_render",
    notes: [],
  };
}

function makeReadyAssetManifest(): AssetManifest {
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

function makeReadyComposeRecord(
  overrides: Partial<ComposeRecord> = {},
): ComposeRecord {
  return {
    id: "compose_001",
    projectId: "project_001",
    assetManifestRecordId: "asset_manifest_001",
    timelineJson: makeReadyComposeTimeline(),
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
    createdAt: new Date("2026-05-17T00:00:00.000Z"),
    ...overrides,
  };
}

function makeReadyAssetManifestRecord(
  overrides: Partial<AssetManifestRecord> = {},
): AssetManifestRecord {
  return {
    id: "asset_manifest_001",
    projectId: "project_001",
    topicPackageId: "topic_001",
    scriptRecordId: "script_001",
    storyboardRecordId: "storyboard_001",
    assetPlanRecordId: "asset_plan_001",
    manifestJson: makeReadyAssetManifest(),
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
    createdAt: new Date("2026-05-17T00:00:00.000Z"),
    ...overrides,
  };
}

describe("validateRenderSources", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  it("blocks when there is no active compose pointer", async () => {
    const result = await validateRenderSources({
      activeComposeRecordId: null,
      composeRecord: null,
      assetManifestRecord: null,
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_active_compose_missing");
  });

  it("blocks when the active compose record cannot be loaded", async () => {
    const result = await validateRenderSources({
      activeComposeRecordId: "compose_missing",
      composeRecord: null,
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_compose_record_missing");
  });

  it("blocks when the compose timeline is not ready for render", async () => {
    const timeline = makeReadyComposeTimeline();
    timeline.readiness = "blocked";

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_timeline_not_ready");
  });

  it("allows render with warnings when timeline readiness is partial", async () => {
    const timeline = makeReadyComposeTimeline();
    timeline.readiness = "partial";

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result.decision).toBe("ready_to_render");
    expect(result.warnings).toContain("render_timeline_partial");
    expect(result.errors).not.toContain("render_timeline_not_ready");
  });

  it("blocks when the asset manifest is missing", async () => {
    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord(),
      assetManifestRecord: null,
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_asset_manifest_missing");
  });

  it("blocks when a timeline artifact is missing from the manifest", async () => {
    const timeline = makeReadyComposeTimeline();
    timeline.tracks.find((track) => track.track_type === "visual")!.clips[0]
      .artifact_id = "artifact_missing";

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_artifact_missing");
  });

  it("blocks when a referenced local artifact file is missing", async () => {
    const manifest = makeReadyAssetManifest();
    manifest.artifacts.push({
      artifact_id: "artifact_sfx_missing_file",
      artifact_type: "sfx_audio",
      origin: "local",
      file_uri: "local://missing.wav",
      created_at: "2026-05-17T00:00:00.000Z",
      metadata: { duration_sec: 1 },
    } satisfies AssetArtifact);
    const timeline = makeReadyComposeTimeline();
    timeline.tracks.push({
      track_id: "track_sfx",
      track_type: "sfx",
      clips: [
        {
          clip_id: "clip_sfx_001",
          segment_id: "sb_001",
          artifact_id: "artifact_sfx_missing_file",
          start_sec: 0,
          duration_sec: 1,
          clip_kind: "audio",
          motion_artifact_id: null,
          notes: [],
        },
      ],
    });

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord({
        manifestJson: manifest,
      }),
      projectStorageRootDir: "D:/path/that/does/not/exist",
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors.some((e) => e.startsWith("render_artifact_file_missing"))).toBe(true);
  });

  it("blocks when narration is missing", async () => {
    const timeline = makeReadyComposeTimeline();
    timeline.tracks = timeline.tracks.filter(
      (track) => track.track_type !== "narration",
    );

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_narration_missing");
  });

  it("blocks when subtitles are missing", async () => {
    const timeline = makeReadyComposeTimeline();
    timeline.tracks = timeline.tracks.filter(
      (track) => track.track_type !== "subtitle",
    );

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("render_subtitle_missing");
  });

  it("returns ready_to_render for a valid compose timeline and manifest", async () => {
    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord(),
      assetManifestRecord: makeReadyAssetManifestRecord(),
    });

    expect(result).toMatchObject({
      stage: "render_local_validation",
      decision: "ready_to_render",
      errors: [],
      metrics: {
        track_count: 3,
        clip_count: 3,
        duration_sec: 12,
      },
    });
  });

  it("does not block when referenced local artifact files exist", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "render-source-validator-"));
    await mkdir(join(tempDir, "media"), { recursive: true });
    await writeFile(join(tempDir, "media", "narration.wav"), "audio");
    await writeFile(join(tempDir, "media", "subtitle.srt"), "subtitle");
    await writeFile(join(tempDir, "media", "image.png"), "image");

    const manifest = makeReadyAssetManifest();
    const artifactPaths = new Map([
      ["artifact_tts_merged", "local://media/narration.wav"],
      ["artifact_subtitle", "local://media/subtitle.srt"],
      ["artifact_img_001", "local://media/image.png"],
    ]);
    manifest.artifacts = manifest.artifacts.map((artifact) => ({
      ...artifact,
      file_uri: artifactPaths.get(artifact.artifact_id) ?? artifact.file_uri,
    })) as AssetArtifact[];

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord(),
      assetManifestRecord: makeReadyAssetManifestRecord({
        manifestJson: manifest,
      }),
      projectStorageRootDir: tempDir,
    });

    expect(result.decision).toBe("ready_to_render");
    expect(result.errors.some((e) => e.startsWith("render_artifact_file_missing"))).toBe(false);
  });

  it("keeps missing optional BGM as a non-blocking warning", async () => {
    const manifest = makeReadyAssetManifest();
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

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord(),
      assetManifestRecord: makeReadyAssetManifestRecord({
        manifestJson: manifest,
      }),
    });

    expect(result.decision).toBe("ready_to_render");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("render_bgm_missing_optional");
  });

  it("accepts manifest with Date objects in executions/artifacts (normalized)", async () => {
    const manifest = makeReadyAssetManifest();
    // Simulate db persistence reviving ISO strings back to Date objects
    for (const exec of manifest.executions) {
      if (exec.started_at) (exec as Record<string, unknown>).started_at = new Date(exec.started_at);
      if (exec.completed_at) (exec as Record<string, unknown>).completed_at = new Date(exec.completed_at);
    }
    for (const art of manifest.artifacts) {
      (art as Record<string, unknown>).created_at = new Date(art.created_at);
    }

    const result = await validateRenderSources({
      composeRecord: makeReadyComposeRecord({ timelineJson: makeReadyComposeTimeline() }),
      assetManifestRecord: makeReadyAssetManifestRecord({ manifestJson: manifest as unknown as Record<string, unknown> }),
    });

    // Should NOT be blocked — dates are normalized before Zod parse
    expect(result.decision).toBe("ready_to_render");
    expect(result.errors).toEqual([]);
  });

  it("resolves workspace-relative storage/projects paths without duplicating the project root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "svf2-render-wsrel-"));
    // Build a workspace-like directory: storage/projects/date/name [id]/
    const storageProjectsDir = join(tempDir, "storage", "projects", "2026-06-test", "Test [p_testwsr]");
    const assetsDir = join(storageProjectsDir, "assets-runs", "run_001");
    await mkdir(assetsDir, { recursive: true });
    const imgPath = join(assetsDir, "test.png");
    await writeFile(imgPath, "fake-png-data");

    const manifest = makeReadyAssetManifest();
    // Use an absolute path to the temp file — this tests that absolute paths
    // (which is what the old provider generates) are resolved correctly.
    manifest.artifacts[0]!.file_uri = imgPath;

    const timeline = makeReadyComposeTimeline();
    const result = await validateRenderSources({
      activeComposeRecordId: "compose_001",
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord({ manifestJson: manifest as unknown as Record<string, unknown> }),
      projectStorageRootDir: storageProjectsDir,
    });

    // Absolute path exists → no file_missing error
    expect(result.errors.filter((e) => e.startsWith("render_artifact_file_missing"))).toEqual([]);
  });

  it("resolves workspace-relative storage/projects path (not absolute) correctly", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "svf2-render-wsrel2-"));
    const storageProjectsDir = join(tempDir, "storage", "projects", "2026-06-test", "Test [p_testwsr2]");
    const assetsDir = join(storageProjectsDir, "assets-runs", "run_001");
    await mkdir(assetsDir, { recursive: true });
    const imgAbsPath = join(assetsDir, "test.png");
    await writeFile(imgAbsPath, "fake-png-data");

    // Compute workspace-relative path from tempDir (which stands in for the repo root)
    const wsRelative = "storage/projects/2026-06-test/Test [p_testwsr2]/assets-runs/run_001/test.png";

    const manifest = makeReadyAssetManifest();
    // Use a WORKSPACE-RELATIVE path (not absolute)
    manifest.artifacts[0]!.file_uri = wsRelative;

    // Create a mock file at the expected workspace-root-relative location
    // Since we can't change the hardcoded workspace root, we create a file
    // at the actual repo root's storage/projects/...
    const repoRelativeDir = join(process.cwd(), "storage", "projects", "2026-06-test", "Test [p_testwsr2]", "assets-runs", "run_001");
    await mkdir(repoRelativeDir, { recursive: true });
    const repoImgPath = join(repoRelativeDir, "test.png");
    await writeFile(repoImgPath, "fake-png-data");

    const timeline = makeReadyComposeTimeline();
    const result = await validateRenderSources({
      activeComposeRecordId: "compose_001",
      composeRecord: makeReadyComposeRecord({ timelineJson: timeline }),
      assetManifestRecord: makeReadyAssetManifestRecord({ manifestJson: manifest as unknown as Record<string, unknown> }),
      projectStorageRootDir: storageProjectsDir,
    });

    // Workspace-relative path should resolve to repo root + path, file exists
    expect(result.errors.filter((e) => e.startsWith("render_artifact_file_missing"))).toEqual([]);
  });
});
