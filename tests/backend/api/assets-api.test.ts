import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
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

function makeImageToVideoAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
}): AssetPlan {
  const plan = makeAssetPlan(input);
  plan.tasks.push(
    {
      task_id: "motion_001",
      order: 2,
      task_type: "render_motion_cue",
      source_segment_id: "sb_001",
      source_excerpt: scriptText,
      production_intent: "Create fallback motion over the anchor image.",
      recommended_mode: "auto",
      provider_hint: "local_motion",
      prompt_draft: null,
      parameters: {
        recipe_type: "slow_push_in",
      },
      manual_upload_policy: {
        allowed: false,
        required: false,
        accepted_file_types: [],
        acceptance_notes: [],
      },
      risk_notes: ["Keep motion subtle."],
      cost_tier: "low",
      initial_status: "planned",
    },
    {
      task_id: "video_001",
      order: 3,
      task_type: "video_clip",
      source_segment_id: "sb_001",
      source_excerpt: scriptText,
      production_intent: "Create the segment video clip from the anchor image.",
      recommended_mode: "auto",
      provider_hint: "dashscope_image_to_video",
      prompt_draft: "A tense historical close-up, slow push-in.",
      parameters: {},
      manual_upload_policy: {
        allowed: false,
        required: false,
        accepted_file_types: [],
        acceptance_notes: [],
      },
      risk_notes: ["Keep video generation explicitly configured."],
      cost_tier: "high",
      initial_status: "planned",
    },
  );
  plan.cost_summary = {
    total_tasks: 4,
    by_type: {
      tts_audio: 1,
      image_still: 1,
      render_motion_cue: 1,
      video_clip: 1,
    },
    by_cost_tier: {
      free: 0,
      low: 3,
      medium: 0,
      high: 1,
    },
    estimated_provider_calls: 3,
    notes: [],
  };
  return plan;
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

function makeImageToVideoAssetManifest(input: {
  assetPlanRecordId: string;
  storyboardRecordId: string;
  scriptRecordId: string;
  assetPlan: AssetPlan;
}): AssetManifest {
  const manifest = makeAssetManifest(input);
  manifest.execution_options.enabled_provider_types = ["tts", "image", "video"];
  manifest.executions.push(
    {
      execution_id: "exec_motion_001",
      task_id: "motion_001",
      task_type: "render_motion_cue",
      status: "completed",
      origin: "local",
      started_at: null,
      completed_at: new Date().toISOString(),
      provider_id: "local_motion",
      attempts: 0,
      output_artifact_ids: ["artifact_motion_motion_001"],
      notes: [],
    },
    {
      execution_id: "exec_video_001",
      task_id: "video_001",
      task_type: "video_clip",
      status: "planned",
      origin: "provider",
      started_at: null,
      completed_at: null,
      provider_id: "dashscope_image_to_video",
      attempts: 0,
      output_artifact_ids: [],
      notes: [],
    },
  );
  manifest.artifacts.push({
    artifact_id: "artifact_motion_motion_001",
    artifact_type: "motion_recipe",
    origin: "inline",
    file_uri: "inline://motion-recipe/motion_001",
    created_at: new Date().toISOString(),
    metadata: {
      recipe_type: "slow_push_in",
      source_image_artifact_id: "pending-image-for-motion_001",
      parameters: {
        recipe_type: "slow_push_in",
      },
    },
  });
  manifest.segment_routes[0] = {
    ...manifest.segment_routes[0]!,
    visual_route_type: "video_clip",
    motion_artifact_id: "artifact_motion_motion_001",
    readiness: "blocked",
  };
  return manifest;
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
  let tempDir = "";

  beforeEach(() => {
    buildInitialAssetManifestMock.mockReset();
    validateAssetsManifestMock.mockReset();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      tempDir = "";
    }
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
    prepared.project.activeComposeRecordId = "compose_record_old";
    prepared.project.activeRenderJobRecordId = "render_job_record_old";
    prepared.project.latestComposeRunTraceJson = {
      phase: "compose",
      run_id: "compose_run_old",
      steps: [],
    };
    prepared.project.latestRenderRunTraceJson = {
      phase: "render",
      run_id: "render_run_old",
      steps: [],
    };

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
      graph_trace_summary: {
        phase: "assets",
      },
      runtime_diagnostics: null,
    });
    expect(body.asset_manifest_record_id).toBeDefined();

    // Verify builder was called with correct arguments
    expect(buildInitialAssetManifestMock).toHaveBeenCalledWith({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      assetPlan: prepared.assetPlan,
      segmentIds: ["sb_001"],
      executionOptions: {
        execution_mode: "auto_available",
        voice_profile_id: "voice_default_male_storyteller",
        enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
        allow_manual_placeholders: false,
      },
    });

    // Verify project state was updated
    expect(prepared.project.activeAssetManifestRecordId).toBe(
      body.asset_manifest_record_id,
    );
    expect(prepared.project.status).toBe("assets_ready");
    expect(prepared.project.latestAssetsRunTraceJson).toMatchObject({
      phase: "assets",
    });
    expect(prepared.project.activeComposeRecordId).toBeNull();
    expect(prepared.project.latestComposeRunTraceJson).toBeNull();
    expect(prepared.project.activeRenderJobRecordId).toBeNull();
    expect(prepared.project.latestRenderRunTraceJson).toBeNull();

    // Verify record was persisted
    const savedRecord = app.db.assetManifestRecords.get(
      body.asset_manifest_record_id,
    );
    expect(savedRecord).toBeDefined();
    expect(savedRecord!.projectId).toBe(prepared.project.id);
    expect(savedRecord!.assetPlanRecordId).toBe(prepared.assetPlanRecord.id);
    expect(savedRecord!.graphTraceSummaryJson).toMatchObject({
      phase: "assets",
    });
  });

  it("passes explicit DashScope provider mode from API payload to assets execution", async () => {
    const app = buildApp();
    const prepared = await prepareActiveAssetPlan(app);
    tempDir = join(tmpdir(), `assets-api-dashscope-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    prepared.project.storageRootDir = tempDir;

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
        artifact_count: 4,
        segment_route_count: 1,
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const urlText = String(url);
        const headers = new Headers(init?.headers);
        if (urlText.startsWith("https://dashscope.test/")) {
          expect(headers.get("authorization")).toBe("Bearer test-key");
        }

        if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
          return new Response(
            JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
          return new Response(
            JSON.stringify({ output: { task_id: "task_dashscope_api_image" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText.endsWith("/api/v1/tasks/task_dashscope_api_image")) {
          return new Response(
            JSON.stringify({
              output: {
                task_status: "SUCCEEDED",
                results: [{ url: "https://example.test/image.png" }],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText === "https://example.test/audio.wav") {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "audio/wav" },
          });
        }

        if (urlText === "https://example.test/image.png") {
          return new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }

        throw new Error(`unexpected fetch: ${urlText}`);
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_default_male_storyteller",
        execution_mode: "auto_available",
        provider_mode: "dashscope",
        dashscope: {
          api_key: "test-key",
          base_url: "https://dashscope.test",
          image_model: "wan2.6-t2i",
          tts_model: "qwen3-tts-instruct-flash",
          image_poll_interval_ms: 0,
          image_max_poll_attempts: 1,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.manifest.artifacts.some(
      (artifact: AssetManifest["artifacts"][number]) =>
        (artifact.metadata as Record<string, unknown>).provider_name === "dashscope_tts",
    )).toBe(true);
    expect(body.manifest.artifacts.some(
      (artifact: AssetManifest["artifacts"][number]) =>
        (artifact.metadata as Record<string, unknown>).provider_name === "dashscope_image",
    )).toBe(true);
  });

  it("passes DashScope image-to-video config from API payload to assets execution", async () => {
    const app = buildApp();
    const prepared = await prepareActiveAssetPlan(app);
    const assetPlan = makeImageToVideoAssetPlan({
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      topicPackageId: prepared.topicPackage.id,
    });
    prepared.assetPlanRecord.planJson = assetPlan;
    tempDir = join(tmpdir(), `assets-api-dashscope-i2v-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    prepared.project.storageRootDir = tempDir;

    const manifest = makeImageToVideoAssetManifest({
      assetPlanRecordId: prepared.assetPlanRecord.id,
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      assetPlan,
    });

    buildInitialAssetManifestMock.mockReturnValueOnce(manifest);
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 4,
        execution_count: 4,
        artifact_count: 5,
        segment_route_count: 1,
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const urlText = String(url);
        const headers = new Headers(init?.headers);
        if (urlText.startsWith("https://dashscope.test/")) {
          expect(headers.get("authorization")).toBe("Bearer test-key");
        }

        if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
          return new Response(
            JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
          return new Response(
            JSON.stringify({ output: { task_id: "task_dashscope_api_image" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText.endsWith("/api/v1/tasks/task_dashscope_api_image")) {
          return new Response(
            JSON.stringify({
              output: {
                task_status: "SUCCEEDED",
                results: [{ url: "https://example.test/image.png" }],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText.endsWith("/api/v1/services/aigc/video-generation/video-synthesis")) {
          const body = JSON.parse(String(init?.body)) as {
            model: string;
            parameters: {
              resolution: string;
              duration: number;
            };
          };
          expect(body.model).toBe("wan2.7-i2v-api-test");
          expect(body.parameters.resolution).toBe("1080P");
          expect(body.parameters.duration).toBe(7);
          return new Response(
            JSON.stringify({ output: { task_id: "task_dashscope_api_i2v" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText.endsWith("/api/v1/tasks/task_dashscope_api_i2v")) {
          return new Response(
            JSON.stringify({
              output: {
                task_id: "task_dashscope_api_i2v",
                task_status: "SUCCEEDED",
                video_url: "https://example.test/video.mp4",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (urlText === "https://example.test/audio.wav") {
          return new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-type": "audio/wav" },
          });
        }

        if (urlText === "https://example.test/image.png") {
          return new Response(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { "content-type": "image/png" },
          });
        }

        if (urlText === "https://example.test/video.mp4") {
          return new Response(new Uint8Array([0, 0, 0, 24]), {
            status: 200,
            headers: { "content-type": "video/mp4" },
          });
        }

        throw new Error(`unexpected fetch: ${urlText}`);
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_default_male_storyteller",
        execution_mode: "auto_available",
        provider_mode: "dashscope",
        dashscope: {
          api_key: "test-key",
          base_url: "https://dashscope.test",
          image_model: "wan2.6-t2i",
          tts_model: "qwen3-tts-instruct-flash",
          image_poll_interval_ms: 0,
          image_max_poll_attempts: 1,
          image_to_video_model: "wan2.7-i2v-api-test",
          image_to_video_resolution: "1080P",
          image_to_video_duration_sec: 7,
          image_to_video_poll_interval_ms: 0,
          image_to_video_max_poll_attempts: 1,
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.manifest.artifacts.some(
      (artifact: AssetManifest["artifacts"][number]) =>
        artifact.artifact_type === "video",
    )).toBe(true);
    expect(body.manifest.segment_routes[0]?.visual_route_type).toBe("video_clip");
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
