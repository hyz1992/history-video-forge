import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import type { AssetManifest } from "../../../shared/src/index.js";

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

describe("compose API", () => {
  it("returns 404 for a missing project", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/missing-project/compose/generate",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "project_not_found" });
  });

  it("returns 409 when active assets are missing", async () => {
    const app = buildApp();
    const project = await createProject(app.db, { name: "Compose Missing Assets" });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/compose/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "active_assets_missing" });
  });

  it("creates, validates, persists, and activates a compose timeline", async () => {
    const app = buildApp();
    const project = await createProject(app.db, { name: "Compose Happy Path" });
    const manifestRecord = await saveAssetManifestRecord(app.db, {
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
    project.activeAssetManifestRecordId = manifestRecord.id;
    project.activeRenderJobRecordId = "render_job_record_old";
    project.latestRenderRunTraceJson = {
      phase: "render",
      run_id: "render_run_old",
      steps: [],
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/compose/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      project_id: project.id,
      source_asset_manifest_record_id: manifestRecord.id,
      timeline: {
        timeline_version: "compose_timeline_v1",
        duration_sec: 15,
        readiness: "ready_for_render",
      },
      local_validation: {
        stage: "compose_local_validation",
        decision: "ready_for_render",
      },
      graph_trace_summary: {
        phase: "compose",
      },
    });
    expect(project.activeComposeRecordId).toBe(body.compose_record_id);
    expect(project.activeRenderJobRecordId).toBeNull();
    expect(project.latestRenderRunTraceJson).toBeNull();
    expect(project.status).toBe("compose_ready");
    expect(app.db.composeRecords.get(body.compose_record_id)).toMatchObject({
      assetManifestRecordId: manifestRecord.id,
    });
  });

  it("persists blocked compose validation without activating it as ready", async () => {
    const app = buildApp();
    const project = await createProject(app.db, { name: "Compose Blocked" });
    const manifest = makeReadyManifest();
    manifest.segment_routes[0].primary_visual_artifact_id = null;
    manifest.segment_routes[0].visual_route_type = "missing";
    manifest.segment_routes[0].readiness = "blocked";
    manifest.readiness = "blocked";
    const manifestRecord = await saveAssetManifestRecord(app.db, {
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetPlanRecordId: "asset_plan_001",
      manifestJson: manifest,
      validationResultJson: {
        stage: "assets_local_validation",
        decision: "partial",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: { phase: "assets", steps: [] },
      runtimeDiagnosticsJson: null,
    });
    project.activeAssetManifestRecordId = manifestRecord.id;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/compose/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      timeline: {
        readiness: "blocked",
      },
      local_validation: {
        decision: "blocked",
        errors: ["compose_asset_manifest_not_ready", "compose_segment_visual_missing"],
      },
    });
    expect(project.status).toBe("compose_blocked");
    expect(project.activeComposeRecordId).toBe(response.json().compose_record_id);
    expect(
      app.db.composeRecords.get(response.json().compose_record_id)?.timelineJson,
    ).toMatchObject({
      readiness: "blocked",
    });
  });

  it("returns 409 when active assets change during compose generation", async () => {
    const app = buildApp();
    const project = await createProject(app.db, { name: "Compose Stale Source" });
    const manifestRecord = await saveAssetManifestRecord(app.db, {
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
    project.activeAssetManifestRecordId = manifestRecord.id;
    const originalGet = app.db.assetManifestRecords.get.bind(
      app.db.assetManifestRecords,
    );
    let shouldMutate = true;
    app.db.assetManifestRecords.get = ((id: string) => {
      const result = originalGet(id);
      if (shouldMutate) {
        shouldMutate = false;
        project.activeAssetManifestRecordId = "asset_manifest_record_newer";
      }
      return result;
    }) as typeof app.db.assetManifestRecords.get;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/compose/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stale_compose_source" });
    expect(project.activeComposeRecordId).toBeNull();
    expect(app.db.composeRecords.size).toBe(0);
  });

  it("generates compose timeline when manifest contains Date objects (normalized)", async () => {
    const app = buildApp();
    const project = await createProject(app.db, { name: "Date Normalize" });

    // Build manifest with ISO-date strings in executions/artifacts
    const manifest = makeReadyManifest();
    // Simulate the db persistence layer reviving dates: replace ISO strings
    // with actual Date objects to test the normalizer
    for (const exec of manifest.executions) {
      if (exec.started_at) (exec as Record<string, unknown>).started_at = new Date(exec.started_at);
      if (exec.completed_at) (exec as Record<string, unknown>).completed_at = new Date(exec.completed_at);
    }
    for (const art of manifest.artifacts) {
      (art as Record<string, unknown>).created_at = new Date(art.created_at);
    }

    const record = await saveAssetManifestRecord(app.db, {
      projectId: project.id,
      topicPackageId: "tp_001",
      scriptRecordId: "scr_001",
      storyboardRecordId: "sb_001",
      assetPlanRecordId: "ap_001",
      manifestJson: manifest as unknown as Record<string, unknown>,
      validationResultJson: { stage: "assets_local_validation", decision: "ready_for_compose", errors: [], warnings: [], metrics: {} },
      executionStateJson: {},
    });

    project.activeAssetManifestRecordId = record.id;
    project.status = "assets_ready";

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/compose/generate`,
      payload: {},
    });

    // Should NOT 500 — dates should be normalized by the record repository
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    // Optional BGM only → should be partial or ready_for_render, not blocked
    const validation = body.local_validation as Record<string, unknown> | undefined;
    expect(validation).toBeDefined();
    expect(
      validation?.decision === "ready_for_render" || validation?.decision === "partial",
    ).toBe(true);
  });
});
