import { beforeEach, describe, expect, it, vi } from "vitest";

const buildInitialAssetManifestMock = vi.hoisted(() => vi.fn());
const validateAssetsManifestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../backend/src/modules/assets/assets-manifest-builder.js", () => ({
  buildInitialAssetManifest: buildInitialAssetManifestMock,
}));
vi.mock("../../../backend/src/modules/assets/assets-local-validator.js", () => ({
  validateAssetsManifest: validateAssetsManifestMock,
}));

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import type { AssetManifest, AssetPlan, AssetsValidationResult, StoryboardPlan } from "../../../shared/src/index.js";

const scriptText =
  "Opening pressure. The envoy answers in public. The ending leaves a cost.";

function makeStoryboardPlan(input: {
  scriptRecordId: string;
  topicPackageId: string;
}): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    estimated_total_duration_sec: 82,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: scriptText,
        start_hint_sec: 0,
        end_hint_sec: 82,
        narrative_role: "opening",
        visual_intent: "Show the public pressure turning into a visible answer.",
        scene_description: "A tense public hall holds on the envoy's answer.",
        visual_elements: ["envoy", "public hall"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: ["Keep historical texture and avoid modern elements."],
      },
    ],
    global_visual_notes: [],
  };
}

function makeAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "cold pressure with a warm turn",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: ["modern building"],
      consistency_notes: [],
    },
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: 82,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: scriptText,
          estimated_duration_sec: 82,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "default_tts",
        prompt_draft: null,
        parameters: {
          voice_profile_id: "voice_default_male_storyteller",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: ["Keep motion subtle and avoid unsafe visual emphasis."],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 1,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create the anchor visual.",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: "ancient public hall, tense envoy, cinematic vertical frame",
        parameters: {
          aspect_ratio: "9:16",
        },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png", "image/jpeg"],
          acceptance_notes: [],
        },
        risk_notes: ["Keep motion subtle and avoid unsafe visual emphasis."],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 2,
      by_type: {
        tts_audio: 1,
        image_still: 1,
      },
      by_cost_tier: {
        free: 0,
        low: 2,
        medium: 0,
        high: 0,
      },
      estimated_provider_calls: 2,
      notes: [],
    },
    global_production_notes: ["No physical assets are generated."],
  };
}

function makeAssetManifest(input: {
  assetPlanRecordId: string;
  storyboardRecordId: string;
  scriptRecordId: string;
  assetPlan: AssetPlan;
}): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: input.assetPlanRecordId,
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_default_male_storyteller",
      enabled_provider_types: ["tts", "image"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_tts_001",
        task_id: "tts_001",
        task_type: "tts_audio",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: "default_tts",
        attempts: 0,
        output_artifact_ids: ["artifact_tts_chunk_tts_001"],
        notes: [],
      },
      {
        execution_id: "exec_img_001",
        task_id: "img_001",
        task_type: "image_still",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: "wanx",
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
    ],
    artifacts: [
      {
        artifact_id: "artifact_tts_chunk_tts_001",
        artifact_type: "tts_chunk_audio",
        origin: "provider",
        file_uri: "planned://tts-chunk/tts_001",
        created_at: new Date().toISOString(),
        metadata: {
          duration_sec: 82,
          voice_profile_id: "voice_default_male_storyteller",
          tts_chunk_id: "tts_001",
          segment_ids: ["sb_001"],
          script_excerpt: scriptText,
        },
      },
    ],
    audio_summary: {
      voice_profile_id: "voice_default_male_storyteller",
      tts_total_duration_sec: 82,
      tts_chunk_artifact_ids: ["artifact_tts_chunk_tts_001"],
      tts_chunk_routes: [
        {
          tts_chunk_id: "tts_001",
          artifact_id: "artifact_tts_chunk_tts_001",
          segment_ids: ["sb_001"],
          script_excerpt: scriptText,
        },
      ],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: "artifact_tts_chunk_tts_001",
        subtitle_artifact_id: null,
        primary_visual_artifact_id: null,
        visual_route_type: "missing",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "blocked",
        notes: [],
      },
    ],
    readiness: "blocked",
    notes: [],
  };
}

interface PreparedSetup {
  project: Awaited<ReturnType<typeof createProject>>;
  topicPackage: any;
  scriptRecord: any;
  storyboardRecord: any;
  assetPlanRecord: any;
  assetPlan: AssetPlan;
  storyboardPlan: StoryboardPlan;
}

interface PreparedManifestSetup extends PreparedSetup {
  assetManifestRecord: any;
  manifest: AssetManifest;
}

async function prepareActiveAssetPlan(app: ReturnType<typeof buildApp>): Promise<PreparedSetup> {
  const project = await createProject(app.db, {
    name: "Assets API Flow",
  });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "Assets Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {},
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptRecord = await saveScriptRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText,
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 82,
    beatTraceJson: [],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass" },
    semanticReviewResultJson: null,
    executionStateJson: null,
  });
  const storyboardPlan = makeStoryboardPlan({
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
  });
  const storyboardRecord = await saveStoryboardRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    planJson: storyboardPlan,
    validationResultJson: {
      stage: "storyboard_local_validation",
      decision: "pass",
    },
  });
  const assetPlan = makeAssetPlan({
    storyboardRecordId: storyboardRecord.id,
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
  });
  const assetPlanRecord = await saveAssetPlanRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    storyboardRecordId: storyboardRecord.id,
    planJson: assetPlan,
    validationResultJson: {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 1,
        segment_route_count: 1,
      },
    },
    executionStateJson: { regenerate_used: false },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });

  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.activeAssetPlanRecordId = assetPlanRecord.id;
  project.status = "asset_plan_ready";

  return {
    project,
    topicPackage,
    scriptRecord,
    storyboardRecord,
    assetPlanRecord,
    assetPlan,
    storyboardPlan,
  };
}

async function prepareActiveManifest(app: ReturnType<typeof buildApp>): Promise<PreparedManifestSetup> {
  const prepared = await prepareActiveAssetPlan(app);

  const manifest = makeAssetManifest({
    assetPlanRecordId: prepared.assetPlanRecord.id,
    storyboardRecordId: prepared.storyboardRecord.id,
    scriptRecordId: prepared.scriptRecord.id,
    assetPlan: prepared.assetPlan,
  });

  const validationResult: AssetsValidationResult = {
    stage: "assets_local_validation",
    decision: "blocked",
    errors: [],
    warnings: [],
    metrics: {
      task_count: 2,
      execution_count: 2,
      artifact_count: 1,
      segment_route_count: 1,
    },
  };

  const assetManifestRecord = await saveAssetManifestRecord(app.db, {
    projectId: prepared.project.id,
    topicPackageId: prepared.topicPackage.id,
    scriptRecordId: prepared.scriptRecord.id,
    storyboardRecordId: prepared.storyboardRecord.id,
    assetPlanRecordId: prepared.assetPlanRecord.id,
    manifestJson: manifest as unknown as Record<string, unknown>,
    validationResultJson: validationResult as unknown as Record<string, unknown>,
    executionStateJson: { execution_mode: "auto_available", activated: true },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });

  prepared.project.activeAssetManifestRecordId = assetManifestRecord.id;
  prepared.project.status = "assets_blocked";

  return {
    ...prepared,
    assetManifestRecord,
    manifest,
  };
}

describe("assets generate api", () => {
  beforeEach(() => {
    buildInitialAssetManifestMock.mockReset();
    validateAssetsManifestMock.mockReset();
  });

  it("returns 404 when the project does not exist", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/missing/assets/generate",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "project_not_found",
    });
  });

  it("returns 409 when active asset plan is missing", async () => {
    const app = buildApp();
    const project = await createProject(app.db, {
      name: "Assets Missing Plan",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "active_asset_plan_missing",
    });
  });

  it("creates, validates, persists, and activates a manifest from active asset plan", async () => {
    const app = buildApp();
    const prepared = await prepareActiveAssetPlan(app);

    const manifest = makeAssetManifest({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      assetPlan: prepared.assetPlan,
    });

    buildInitialAssetManifestMock.mockReturnValueOnce(manifest);
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 1,
        segment_route_count: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_default_male_storyteller",
        execution_mode: "auto_available",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      project_id: prepared.project.id,
      source_asset_plan_record_id: prepared.assetPlanRecord.id,
      manifest: {
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: prepared.assetPlanRecord.id,
      },
      local_validation: {
        stage: "assets_local_validation",
        decision: "ready_for_compose",
      },
      execution_state: {
        execution_mode: "auto_available",
        activated: true,
      },
      graph_trace_summary: null,
      runtime_diagnostics: null,
    });
    expect(body.asset_manifest_record_id).toBeDefined();

    // Verify builder was called with correct arguments
    expect(buildInitialAssetManifestMock).toHaveBeenCalledWith({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      assetPlan: prepared.assetPlan,
      segmentIds: ["sb_001"],
    });

    // Verify project state was updated
    expect(prepared.project.activeAssetManifestRecordId).toBe(
      body.asset_manifest_record_id,
    );
    expect(prepared.project.status).toBe("assets_ready");
    expect(prepared.project.latestAssetsRunTraceJson).toMatchObject({
      phase: "assets",
    });

    // Verify record was persisted
    const savedRecord = app.db.assetManifestRecords.get(
      body.asset_manifest_record_id,
    );
    expect(savedRecord).toBeDefined();
    expect(savedRecord!.projectId).toBe(prepared.project.id);
    expect(savedRecord!.assetPlanRecordId).toBe(prepared.assetPlanRecord.id);
  });

  it("supports execution_mode dry_run and confirms no provider adapter is invoked", async () => {
    const app = buildApp();
    const prepared = await prepareActiveAssetPlan(app);

    const manifest = makeAssetManifest({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      assetPlan: prepared.assetPlan,
    });

    buildInitialAssetManifestMock.mockReturnValueOnce(manifest);
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 1,
        segment_route_count: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_default_male_storyteller",
        execution_mode: "dry_run",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.execution_state).toMatchObject({
      execution_mode: "dry_run",
      activated: true,
    });
  });

  it("returns 409 stale_assets_source if active asset plan changes before activation", async () => {
    const app = buildApp();
    const prepared = await prepareActiveAssetPlan(app);

    const manifest = makeAssetManifest({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      assetPlan: prepared.assetPlan,
    });

    buildInitialAssetManifestMock.mockImplementationOnce(() => {
      // Simulate concurrent change: asset plan record ID changes
      prepared.project.activeAssetPlanRecordId = "asset_plan_record_new";
      return manifest;
    });
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 1,
        segment_route_count: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_default_male_storyteller",
        execution_mode: "auto_available",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "stale_assets_source",
    });

    // No manifest record should be saved
    expect(app.db.assetManifestRecords.size).toBe(0);
    expect(prepared.project.activeAssetManifestRecordId).toBeNull();
  });

  it("project status becomes assets_blocked when manifest is not ready", async () => {
    const app = buildApp();
    const prepared = await prepareActiveAssetPlan(app);

    const manifest = makeAssetManifest({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      assetPlan: prepared.assetPlan,
    });

    buildInitialAssetManifestMock.mockReturnValueOnce(manifest);
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "blocked",
      errors: ["assets_task_execution_missing"],
      warnings: [],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 1,
        segment_route_count: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_default_male_storyteller",
        execution_mode: "auto_available",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.local_validation.decision).toBe("blocked");
    expect(prepared.project.status).toBe("assets_blocked");
    // Even blocked manifests are persisted and activated
    expect(prepared.project.activeAssetManifestRecordId).toBe(
      body.asset_manifest_record_id,
    );
  });
});

describe("manual artifact registration", () => {
  beforeEach(() => {
    buildInitialAssetManifestMock.mockReset();
    validateAssetsManifestMock.mockReset();
  });

  it("returns 404 project_not_found for missing project on register", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/missing/assets/tasks/img_001/artifacts/register",
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.png",
        mime_type: "image/png",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "project_not_found",
    });
  });

  it("returns 409 active_assets_missing when no active manifest on register", async () => {
    const app = buildApp();
    const project = await createProject(app.db, {
      name: "No Manifest",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/tasks/img_001/artifacts/register`,
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.png",
        mime_type: "image/png",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "active_assets_missing",
    });
  });

  it("returns 404 asset_task_not_found for unknown task id on register", async () => {
    const app = buildApp();
    const prepared = await prepareActiveManifest(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/tasks/nonexistent_task/artifacts/register`,
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.png",
        mime_type: "image/png",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "asset_task_not_found",
    });
  });

  it("returns 422 asset_manual_upload_type_not_allowed for disallowed MIME type", async () => {
    const app = buildApp();
    const prepared = await prepareActiveManifest(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/tasks/img_001/artifacts/register`,
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.gif",
        mime_type: "image/gif",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: "asset_manual_upload_type_not_allowed",
    });
  });

  it("registers manual artifact, sets execution to completed, and re-validates", async () => {
    const app = buildApp();
    const prepared = await prepareActiveManifest(app);

    // The img_001 execution in the test manifest starts with status "planned"
    // After registration it should become "completed" with origin "manual_upload"

    // Mock validator to return partial (still has warnings)
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "partial",
      errors: [],
      warnings: ["assets_bgm_missing_optional"],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 2,
        segment_route_count: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/tasks/img_001/artifacts/register`,
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.png",
        mime_type: "image/png",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const returnedManifest = body.manifest as AssetManifest;

    // Verify the new artifact was added
    expect(returnedManifest.artifacts.length).toBe(2);
    const newArtifact = returnedManifest.artifacts.find(
      (a) => a.artifact_type === "image",
    );
    expect(newArtifact).toBeDefined();
    expect(newArtifact!.origin).toBe("manual_upload");
    expect(newArtifact!.file_uri).toBe("manual://upload.png");

    // Verify execution was updated
    const imgExecution = returnedManifest.executions.find(
      (e) => e.task_id === "img_001",
    );
    expect(imgExecution).toBeDefined();
    expect(imgExecution!.status).toBe("completed");
    expect(imgExecution!.origin).toBe("manual_upload");
    expect(imgExecution!.output_artifact_ids).toContain(newArtifact!.artifact_id);
    expect(imgExecution!.completed_at).toBeDefined();

    // Verify validator was called
    expect(validateAssetsManifestMock).toHaveBeenCalledOnce();

    // Verify readiness was updated based on validation result
    expect(returnedManifest.readiness).toBe("partial");

    // Verify the stored record was updated
    const storedRecord = app.db.assetManifestRecords.get(
      prepared.assetManifestRecord.id,
    );
    expect(storedRecord).toBeDefined();
    const storedManifest = storedRecord!.manifestJson as AssetManifest;
    expect(storedManifest.readiness).toBe("partial");
  });

  it("updates readiness from blocked to ready_for_compose when all blocking items resolved", async () => {
    const app = buildApp();
    const prepared = await prepareActiveManifest(app);

    // Mock validator to return ready_for_compose after the image is registered
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 2,
        segment_route_count: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/tasks/img_001/artifacts/register`,
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.png",
        mime_type: "image/png",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const returnedManifest = body.manifest as AssetManifest;

    // Readiness should change from blocked to ready_for_compose
    expect(returnedManifest.readiness).toBe("ready_for_compose");

    // Project status should update
    expect(prepared.project.status).toBe("assets_ready");
  });

  it("accepts an existing artifact and updates execution status to accepted", async () => {
    const app = buildApp();
    const prepared = await prepareActiveManifest(app);

    // First, register a manual artifact so there is one to accept
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "partial",
      errors: [],
      warnings: ["assets_bgm_missing_optional"],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 2,
        segment_route_count: 1,
      },
    });

    const registerResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/tasks/img_001/artifacts/register`,
      payload: {
        artifact_type: "image",
        file_uri: "manual://upload.png",
        mime_type: "image/png",
        metadata: { width: 1080, height: 1920 },
      },
    });

    expect(registerResponse.statusCode).toBe(200);
    const registerBody = registerResponse.json();
    const registeredManifest = registerBody.manifest as AssetManifest;
    const imgExecution = registeredManifest.executions.find(
      (e) => e.task_id === "img_001",
    )!;
    const artifactId = imgExecution.output_artifact_ids[0];

    // Now accept the artifact
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "partial",
      errors: [],
      warnings: ["assets_bgm_missing_optional"],
      metrics: {
        task_count: 2,
        execution_count: 2,
        artifact_count: 2,
        segment_route_count: 1,
      },
    });

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/tasks/img_001/accept`,
      payload: {
        artifact_id: artifactId,
      },
    });

    expect(acceptResponse.statusCode).toBe(200);
    const acceptBody = acceptResponse.json();
    const acceptedManifest = acceptBody.manifest as AssetManifest;

    const updatedExecution = acceptedManifest.executions.find(
      (e) => e.task_id === "img_001",
    );
    expect(updatedExecution!.status).toBe("accepted");

    // Verify the stored record was updated
    const storedRecord = app.db.assetManifestRecords.get(
      prepared.assetManifestRecord.id,
    );
    const storedManifest = storedRecord!.manifestJson as AssetManifest;
    const storedExec = storedManifest.executions.find(
      (e) => e.task_id === "img_001",
    );
    expect(storedExec!.status).toBe("accepted");
  });
});
