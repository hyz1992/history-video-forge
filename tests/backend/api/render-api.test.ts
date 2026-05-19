import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { saveComposeRecord } from "../../../backend/src/modules/compose/compose-record.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { createFakeRenderAdapter } from "../../../backend/src/modules/render/fake-render-adapter.js";
import type { RenderAdapter } from "../../../backend/src/modules/render/render-adapter.js";
import type {
  AssetManifest,
  ComposeTimeline,
} from "../../../shared/src/index.js";

function makeReadyTimeline(
  overrides: Partial<ComposeTimeline> = {},
): ComposeTimeline {
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
    ...overrides,
  };
}

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
        artifact_id: "artifact_tts_merged",
        artifact_type: "tts_merged_audio",
        origin: "provider",
        file_uri: "memory://tts-merged.wav",
        created_at: "2026-05-18T00:00:00.000Z",
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
        origin: "provider",
        file_uri: "memory://image-001.png",
        created_at: "2026-05-18T00:00:00.000Z",
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
        created_at: "2026-05-18T00:00:00.000Z",
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

async function seedActiveCompose(input: {
  app: ReturnType<typeof buildApp>;
  name: string;
  timeline?: ComposeTimeline;
}) {
  const project = await createProject(input.app.db, { name: input.name });
  const manifestRecord = await saveAssetManifestRecord(input.app.db, {
    projectId: project.id,
    topicPackageId: "topic_001",
    scriptRecordId: "script_001",
    storyboardRecordId: "storyboard_001",
    assetPlanRecordId: "asset_plan_001",
    manifestJson: makeReadyManifest(),
    validationResultJson: {
      stage: "assets_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: { activated: true },
    graphTraceSummaryJson: { phase: "assets", steps: [] },
    runtimeDiagnosticsJson: null,
  });
  const timeline = input.timeline ?? makeReadyTimeline();
  const composeRecord = await saveComposeRecord(input.app.db, {
    projectId: project.id,
    assetManifestRecordId: manifestRecord.id,
    timelineJson: {
      ...timeline,
      source_asset_manifest_record_id: manifestRecord.id,
    },
    validationResultJson: {
      stage: "compose_local_validation",
      decision: timeline.readiness,
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: { activated: true },
    graphTraceSummaryJson: { phase: "compose", steps: [] },
    runtimeDiagnosticsJson: null,
  });

  project.activeAssetManifestRecordId = manifestRecord.id;
  project.activeComposeRecordId = composeRecord.id;
  project.status = "compose_ready";

  return { project, manifestRecord, composeRecord };
}

describe("render API", () => {
  it("returns 404 for a missing project", async () => {
    const app = buildApp({ renderAdapter: createFakeRenderAdapter() });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/missing-project/render/generate",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("returns 409 when active compose is missing", async () => {
    const app = buildApp({ renderAdapter: createFakeRenderAdapter() });
    const project = await createProject(app.db, { name: "Render Missing Compose" });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/render/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "active_compose_missing" });
  });

  it("returns 409 when compose timeline is not ready for render", async () => {
    const app = buildApp({ renderAdapter: createFakeRenderAdapter() });
    const { project } = await seedActiveCompose({
      app,
      name: "Render Blocked Compose",
      timeline: makeReadyTimeline({ readiness: "blocked" }),
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/render/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "render_timeline_not_ready",
      local_validation: {
        decision: "blocked",
        errors: ["render_timeline_not_ready"],
      },
    });
    expect(project.status).toBe("render_blocked");
    expect(project.activeRenderJobRecordId).toBeNull();
  });

  it("validates, renders, persists, and activates a render record", async () => {
    const app = buildApp({ renderAdapter: createFakeRenderAdapter() });
    const { project, composeRecord } = await seedActiveCompose({
      app,
      name: "Render Happy Path",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/render/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      project_id: project.id,
      source_compose_record_id: composeRecord.id,
      render_job: {
        status: "completed",
      },
      output_artifact: {
        artifact_type: "rendered_video",
        mime_type: "video/mp4",
      },
      local_validation: {
        stage: "render_local_validation",
        decision: "rendered",
      },
    });
    expect(project.activeRenderJobRecordId).toBe(body.render_job_record_id);
    expect(project.status).toBe("render_ready");
    expect(app.db.renderJobRecords.get(body.render_job_record_id)).toMatchObject({
      status: "completed",
      composeRecordId: composeRecord.id,
    });
  });

  it("returns 409 for stale active compose and does not activate the render", async () => {
    const fakeAdapter = createFakeRenderAdapter();
    const app = buildApp({
      renderAdapter: {
        async render(input) {
          app.db.projects.get(input.projectId)!.activeComposeRecordId =
            "compose_newer";
          return fakeAdapter.render(input);
        },
      },
    });
    const { project } = await seedActiveCompose({
      app,
      name: "Render Stale Compose",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/render/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "stale_render_source",
    });
    expect(project.activeRenderJobRecordId).toBeNull();
    expect([...app.db.renderJobRecords.values()][0]).toMatchObject({
      status: "stale_source",
    });
  });

  it("sets render_failed and persists diagnostics when the adapter fails", async () => {
    const failingAdapter: RenderAdapter = {
      async render() {
        throw new Error("adapter exploded");
      },
    };
    const app = buildApp({ renderAdapter: failingAdapter });
    const { project } = await seedActiveCompose({
      app,
      name: "Render Failed Adapter",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/render/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toMatchObject({
      error: "render_failed",
      render_job: {
        status: "failed",
      },
      runtime_diagnostics: {
        error_message: "adapter exploded",
      },
    });
    expect(project.status).toBe("render_failed");
    expect(project.activeRenderJobRecordId).toBeNull();
    expect(app.db.renderJobRecords.get(body.render_job_record_id)).toMatchObject({
      status: "failed",
      runtimeDiagnosticsJson: {
        error_message: "adapter exploded",
      },
    });
  });
});
