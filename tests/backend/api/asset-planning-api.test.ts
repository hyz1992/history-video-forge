import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateAssetPlanMock = vi.hoisted(() => vi.fn());
const repairAssetPlanStructureMock = vi.hoisted(() => vi.fn());
const actualGenerationState = vi.hoisted(() => ({
  enabled: false,
  gateway: null as unknown,
}));

vi.mock("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js")>();
  return {
    ...actual,
    generateAssetPlan: (input: Parameters<typeof actual.generateAssetPlan>[0]) => {
      if (!actualGenerationState.enabled) return generateAssetPlanMock(input);
      generateAssetPlanMock(input);
      return actual.generateAssetPlan({
        ...input,
        llmGateway: actualGenerationState.gateway as Parameters<typeof actual.generateAssetPlan>[0]["llmGateway"],
      });
    },
  };
});
vi.mock("../../../backend/src/modules/asset-planning/asset-planning-structural-repair.service.js", () => ({
  repairAssetPlanStructure: repairAssetPlanStructureMock,
}));

import { buildApp } from "../../../backend/src/app.js";
import { LegacyChunkResilienceError } from "../../../backend/src/modules/asset-planning/legacy-chunk-resilience.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { ExternalServiceError } from "../../../backend/src/runtime/llm/external-errors.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";
import type { AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";
import { buildTestAuth } from "../auth/test-utils.js";

const scriptText =
  "Opening pressure. The envoy answers in public. The ending leaves a cost.";
const storageRoots: string[] = [];
const originalStorageRootDir = process.env.STORAGE_ROOT_DIR;
const originalAssetPlanningGenerationMode =
  process.env.ASSET_PLANNING_GENERATION_MODE;

/** 与 storyboard 快照同源：resolver 需要每 capability 一个 active 默认项才能成功解析。 */
function seedGenerationCatalog(app: ReturnType<typeof buildApp>) {
  const now = new Date();
  const catalogSeed: Array<[string, string]> = [
    ["llm.smart", "dashscope.qwen-max"],
    ["llm.flash", "dashscope.qwen-flash"],
    ["image.generate", "dashscope.wanx-v1"],
    ["video.image_to_video", "dashscope.video-v1"],
    ["tts.synthesize", "dashscope.tts"],
  ];
  for (const [capability, id] of catalogSeed) {
    app.db.providerModelCatalog.set(id, {
      id,
      capability: capability as never,
      providerKey: "dashscope",
      modelId: id,
      modelVersion: null,
      displayName: id,
      qualityTier: null,
      speedTier: null,
      parameterCapabilitiesJson: {},
      pricingVersion: "v1",
      pricingJson: { bounded: true },
      status: "active",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

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
        api_video_suitability: "remotion_sufficient",
      },
    ],
    global_visual_notes: [],
  };
}

function makeAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
  sourceScriptOverride?: string;
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.sourceScriptOverride ?? input.scriptRecordId,
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
        task_id: "subtitle_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate subtitle timing from TTS.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          source_tts_task_id: "tts_001",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: ["Keep historical texture and avoid modern elements."],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create the anchor visual for the pressure scene.",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: "ancient public hall, tense envoy, cinematic vertical frame",
        parameters: {
          aspect_ratio: "9:16",
          image_role: "anchor",
          support_reason: null,
          video_prompt_reserve: "slow push-in on the envoy",
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
      {
        task_id: "motion_001",
        order: 3,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Push in on the anchor still.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          recipe_type: "push_in",
          source_image_task_id: "img_001",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: ["Keep motion subtle and avoid unsafe visual emphasis."],
        cost_tier: "free",
        initial_status: "planned",
      },
    ],
    dependencies: [
      {
        dependency_id: "dep_subtitle_after_tts",
        task_id: "subtitle_001",
        depends_on_task_id: "tts_001",
        dependency_type: "requires_timing",
      },
      {
        dependency_id: "dep_motion_after_image",
        task_id: "motion_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      },
    ],
    cost_summary: {
      total_tasks: 4,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        render_motion_cue: 1,
      },
      by_cost_tier: {
        free: 2,
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

async function prepareActiveStoryboard(app: ReturnType<typeof buildApp>) {
  seedGenerationCatalog(app);
  const project = await createProject(app.db, {
    name: "Asset Planning API Flow",
    ownerId: "owner-1",
  });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "Asset Planning Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: {
      label: "medium",
    },
    narrativeTensionMapJson: {
      hook_claim: "A public pressure scene begins.",
      pressure_escalation: "The insult keeps rising.",
      mid_reveal: "The answer is guarding the state's face.",
      peak_payoff: "The reply reverses the pressure.",
      ending_residue: "Retreat would cost more than silence.",
    },
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: ["Do not invent physical assets."],
    riskHintsJson: ["Plan only; do not generate files."],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptRecord = await saveScriptRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText,
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 82,
    beatTraceJson: [
      {
        beat: "public answer",
        excerpt: "The envoy answers in public.",
        confidence: 0.95,
      },
    ],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: {
      stage: "script_local_validation",
      decision: "pass",
    },
    semanticReviewResultJson: {
      stage: "script_semantic_review",
      decision: "pass",
      patch_intent: null,
    },
    executionStateJson: {
      patch_used: false,
      regenerate_used: false,
    },
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

  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.status = "storyboard_ready";

  return {
    project,
    topicPackage,
    scriptRecord,
    storyboardRecord,
    storyboardPlan,
  };
}

describe("asset planning api", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  beforeEach(() => {
    actualGenerationState.enabled = false;
    actualGenerationState.gateway = null;
    generateAssetPlanMock.mockReset();
    repairAssetPlanStructureMock.mockReset();
    repairAssetPlanStructureMock.mockImplementation(async (input) => ({
      plan: input.plan,
      repairUsed: false,
    }));
  });

  it("redacts invalid intent metadata across the real generation and API failure boundary", async () => {
    const previousMode = process.env.ASSET_PLANNING_GENERATION_MODE;
    const rawSecret = `RAW_SECRET_FROM_MODEL_${"x".repeat(300)}`;
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-intent-invalid-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    process.env.ASSET_PLANNING_GENERATION_MODE = "intent_compiler";
    try {
      const calls: string[] = [];
      actualGenerationState.enabled = true;
      actualGenerationState.gateway = {
        invokeStructuredPrompt: vi.fn(async (options: { promptId: string }) => {
          calls.push(options.promptId);
          if (options.promptId === "asset-planning.planner") {
            return {
              planning_mode: "global",
              art_bible: {
                era_style: "ancient court", visual_tone: "restrained realism",
                characters: [], locations: [], props: [],
                global_prompt_prefix: "historical realism",
                global_negative_prompts: ["modern objects"],
                consistency_notes: ["consistent visual style"],
              },
              visual_budget: { mode: "balanced" },
              downgrade_policy: { video_to_image: true },
              global_audio_strategy: {},
              manual_review_notes: [],
            };
          }
          if (options.promptId === "asset-planning.segment-intent-planner") {
            return {
              planning_mode: "segment_intent_batch",
              segments: [{ source_segment_id: rawSecret, intents: [], [rawSecret]: rawSecret }],
              budget_notes: [],
              [rawSecret]: rawSecret,
            };
          }
          if (options.promptId === "asset-planning.segment-intent-repair") {
            return { operations: [] };
          }
          throw new Error(`unexpected_prompt:${options.promptId}`);
        }),
        invokeStrictStructured: vi.fn(),
      };
      const app = buildApp();
      const prepared = await prepareActiveStoryboard(app);
      const previousActiveId = "asset_plan_record_previous";
      prepared.project.activeAssetPlanRecordId = previousActiveId;
      prepared.project.status = "asset_plan_ready";

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
        auth,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ error: "asset_segment_intent_invalid" });
      expect(response.json()).not.toHaveProperty("message");
      expect(calls).toEqual([
        "asset-planning.planner",
        "asset-planning.segment-intent-planner",
        "asset-planning.segment-intent-repair",
        "asset-planning.segment-intent-planner",
      ]);
      expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
      expect(repairAssetPlanStructureMock).not.toHaveBeenCalled();
      expect(prepared.project.activeAssetPlanRecordId).toBe(previousActiveId);
      expect(prepared.project.status).toBe("asset_plan_ready");
      const failed = [...app.db.assetPlanRecords.values()].at(-1)!;
      expect(failed.id).not.toBe(previousActiveId);
      expect(failed.executionStateJson).toMatchObject({ generating: false, error: "asset_segment_intent_invalid" });
      const persisted = JSON.stringify({
        api: response.json(),
        execution: failed.executionStateJson,
        diagnostics: failed.runtimeDiagnosticsJson,
      });
      expect(persisted).not.toContain("RAW_SECRET_FROM_MODEL");
      const profile = getProjectStorageProfile(prepared.project)!;
      const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
      expect(trace).not.toContain("RAW_SECRET_FROM_MODEL");
      expect(trace).toContain('"issue_paths"');
      expect(trace).toContain("segments[0]");
      expect(trace).not.toContain('"issues":');
    } finally {
      actualGenerationState.enabled = false;
      actualGenerationState.gateway = null;
      if (previousMode === undefined) delete process.env.ASSET_PLANNING_GENERATION_MODE;
      else process.env.ASSET_PLANNING_GENERATION_MODE = previousMode;
    }
  });

  it("freezes generation mode once for the whole request without exposing it in the API", async () => {
    const previousMode = process.env.ASSET_PLANNING_GENERATION_MODE;
    process.env.ASSET_PLANNING_GENERATION_MODE = "intent_compiler";
    try {
      const app = buildApp();
      const prepared = await prepareActiveStoryboard(app);
      generateAssetPlanMock
        .mockImplementationOnce(async () => {
          process.env.ASSET_PLANNING_GENERATION_MODE = "legacy";
          return makeAssetPlan({
            storyboardRecordId: prepared.storyboardRecord.id,
            scriptRecordId: prepared.scriptRecord.id,
            topicPackageId: prepared.topicPackage.id,
          });
        });

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
        auth,
      });

      expect(response.statusCode).toBe(200);
      expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
      for (const [generationInput] of generateAssetPlanMock.mock.calls) {
        expect(generationInput).toEqual(
          expect.objectContaining({ generationMode: "intent_compiler" }),
        );
      }
      expect(response.json()).not.toHaveProperty("generation_mode");
      expect(response.json()).not.toHaveProperty("mode");
    } finally {
      if (previousMode === undefined) delete process.env.ASSET_PLANNING_GENERATION_MODE;
      else process.env.ASSET_PLANNING_GENERATION_MODE = previousMode;
    }
  });

  afterEach(() => {
    if (originalStorageRootDir === undefined) {
      delete process.env.STORAGE_ROOT_DIR;
    } else {
      process.env.STORAGE_ROOT_DIR = originalStorageRootDir;
    }
    if (originalAssetPlanningGenerationMode === undefined) {
      delete process.env.ASSET_PLANNING_GENERATION_MODE;
    } else {
      process.env.ASSET_PLANNING_GENERATION_MODE =
        originalAssetPlanningGenerationMode;
    }
    for (const root of storageRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 404 when the project does not exist", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/missing/asset-plan/generate",
      auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "project_not_found",
    });
  });

  it("returns 409 when active storyboard is missing", async () => {
    const app = buildApp();
    const project = await createProject(app.db, {
      name: "Asset Plan Missing Storyboard",
      ownerId: "owner-1",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "active_storyboard_missing",
    });
  });

  it("returns 404 when the active storyboard record was deleted", async () => {
    const app = buildApp();
    const project = await createProject(app.db, {
      name: "Asset Plan Deleted Storyboard",
      ownerId: "owner-1",
    });
    project.activeStoryboardRecordId = "storyboard_missing";

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "storyboard_record_not_found",
    });
  });

  it("returns 404 when the storyboard source script was deleted", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    app.db.scriptRecords.delete(prepared.scriptRecord.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "source_record_not_found",
    });
  });

  it("returns 500 before invoking LLM or persisting any record when route resolution fails", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    // 破坏 catalog：resolver 无法解析任何 capability 默认项 → 结构化失败
    app.db.providerModelCatalog.clear();
    const recordsBefore = app.db.assetPlanRecords.size;

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "asset_plan_route_resolution_failed" });
    expect(response.json().detail).toEqual(expect.any(String));
    expect(generateAssetPlanMock).not.toHaveBeenCalled();
    expect(repairAssetPlanStructureMock).not.toHaveBeenCalled();
    expect(app.db.assetPlanRecords.size).toBe(recordsBefore);
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
  });

  it("returns 404 when the storyboard source topic was deleted", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    app.db.topicPackages.delete(prepared.topicPackage.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "source_record_not_found",
    });
  });

  it("generates, validates, persists, and activates an asset plan from active storyboard", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    prepared.project.activeAssetManifestRecordId = "asset_manifest_record_old";
    prepared.project.activeComposeRecordId = "compose_record_old";
    prepared.project.activeRenderJobRecordId = "render_job_record_old";
    prepared.project.latestAssetsRunTraceJson = {
      phase: "assets",
      run_id: "assets_run_old",
      steps: [],
    };
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
    generateAssetPlanMock.mockResolvedValueOnce(
      makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      project_id: prepared.project.id,
      run_mode: "sync_runtime",
      asset_plan_record_id: expect.any(String),
      source_storyboard_record_id: prepared.storyboardRecord.id,
      source_script_record_id: prepared.scriptRecord.id,
      source_topic_package_id: prepared.topicPackage.id,
      plan: {
        source_storyboard_record_id: prepared.storyboardRecord.id,
        source_script_record_id: prepared.scriptRecord.id,
        source_topic_package_id: prepared.topicPackage.id,
      },
      local_validation: {
        stage: "asset_planning_local_validation",
        decision: "pass",
      },
      execution_state: {
        regenerate_used: false,
      },
      graph_trace_summary: {
        phase: "asset_planning",
        run_id: expect.any(String),
      },
      runtime_diagnostics: {
        checks: [
          {
            code: "asset_planning_local_validation_passed",
            level: "info",
          },
        ],
      },
    });
    expect(prepared.project.status).toBe("asset_plan_ready");
    expect(prepared.project.activeAssetPlanRecordId).toBe(body.asset_plan_record_id);
    expect(prepared.project.activeAssetManifestRecordId).toBeNull();
    expect(prepared.project.latestAssetsRunTraceJson).toBeNull();
    expect(prepared.project.activeComposeRecordId).toBeNull();
    expect(prepared.project.latestComposeRunTraceJson).toBeNull();
    expect(prepared.project.activeRenderJobRecordId).toBeNull();
    expect(prepared.project.latestRenderRunTraceJson).toBeNull();
    expect(prepared.project.latestAssetPlanRunTraceJson).toMatchObject({
      phase: "asset_planning",
    });

    const snapshot = await getProjectSnapshot(app.db, prepared.project.id);
    expect(snapshot?.active_asset_plan).toMatchObject({
      asset_plan_record_id: body.asset_plan_record_id,
      source_storyboard_record_id: prepared.storyboardRecord.id,
    });
  });

  it("restores every pre-activation project field when asset plan activation rejects", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const oldUpdatedAt = new Date("2025-01-02T03:04:05.000Z");
    const oldAssetPlanTrace = { phase: "asset_planning", run_id: "old_plan_run" };
    const oldAssetsTrace = { phase: "assets", run_id: "old_assets_run" };
    const oldComposeTrace = { phase: "compose", run_id: "old_compose_run" };
    const oldRenderTrace = { phase: "render", run_id: "old_render_run" };
    Object.assign(prepared.project, {
      status: "render_ready",
      activeAssetPlanRecordId: "asset_plan_old",
      activeAssetManifestRecordId: "asset_manifest_old",
      activeComposeRecordId: "compose_old",
      activeRenderJobRecordId: "render_old",
      activePublishPackageRecordId: "publish_old",
      latestAssetPlanRunTraceJson: oldAssetPlanTrace,
      latestAssetsRunTraceJson: oldAssetsTrace,
      latestComposeRunTraceJson: oldComposeTrace,
      latestRenderRunTraceJson: oldRenderTrace,
      updatedAt: oldUpdatedAt,
    });
    app.db.secondAggregateWriter = {
      async saveScript() {},
      async saveStoryboard() {},
      async saveAssetPlan() {},
      async activateScript() {},
      async activateStoryboard() {},
      async activateAssetPlan() {
        throw new Error("activation_rejected");
      },
    };
    generateAssetPlanMock.mockResolvedValueOnce(
      makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "internal_server_error" });
    expect(response.json()).not.toHaveProperty("message");
    expect(prepared.project).toMatchObject({
      status: "render_ready",
      activeAssetPlanRecordId: "asset_plan_old",
      activeAssetManifestRecordId: "asset_manifest_old",
      activeComposeRecordId: "compose_old",
      activeRenderJobRecordId: "render_old",
      activePublishPackageRecordId: "publish_old",
      latestAssetPlanRunTraceJson: oldAssetPlanTrace,
      latestAssetsRunTraceJson: oldAssetsTrace,
      latestComposeRunTraceJson: oldComposeTrace,
      latestRenderRunTraceJson: oldRenderTrace,
    });
    expect(prepared.project.updatedAt).toEqual(oldUpdatedAt);
  });

  it("persists redacted successful intent chunk diagnostics in API, DB, and service trace", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-intent-success-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const rawSecret = `RAW_SUCCESS_CHUNK_SECRET_${"x".repeat(200)}`;
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onIntentChunkSettled?.({
        type: "intent_chunk_settled",
        chunk_id: "chunk_001",
        chunk_index: 0,
        outcome: "success",
        status: "compiled",
        stage: "repaired",
        compiler_actions: ["visual_strategy_applied", rawSecret],
        visual_route_decisions: [
          { segment_id: "sb_001", route: "remotion", reason_code: "strategy_matrix_remotion" },
          { segment_id: "sb_002", route: "api_video", reason_code: "strategy_matrix_api_video" },
          { segment_id: rawSecret, route: "api_video", reason_code: "strategy_matrix_api_video" },
          { segment_id: "sb_003", route: "api_video", reason_code: rawSecret },
          { segment_id: "sb_004", route: "api_video", reason_code: "strategy_matrix_api_video", [rawSecret]: rawSecret },
        ],
        accounting: {
          chunk_id: "chunk_001",
          business_slot: 2,
          logical_invocation: 2,
          safety_invocation: 0,
          provider_attempts: 4,
          network_request_count: 4,
        },
        prompt: rawSecret,
        raw_response: rawSecret,
        issues: [{ message: rawSecret, value: rawSecret }],
      });
      return makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      });
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const expected = {
      chunk_count: 1,
      chunks: [expect.objectContaining({
        chunk_id: "chunk_001",
        chunk_index: 0,
        status: "compiled",
        stage: "repaired",
        compiler_actions: ["visual_strategy_applied"],
        visual_route_decisions: [
          { segment_id: "sb_001", route: "remotion", reason_code: "strategy_matrix_remotion" },
          { segment_id: "sb_002", route: "api_video", reason_code: "strategy_matrix_api_video" },
          { segment_id: "sb_004", route: "api_video", reason_code: "strategy_matrix_api_video" },
        ],
        accounting: expect.objectContaining({
          business_invocation: 2,
          logical_invocation: 2,
          safety_invocation: 0,
          provider_attempts: 4,
          network_request_count: 4,
        }),
      })],
    };
    expect(body.execution_state.intent_chunk_diagnostics).toMatchObject(expected);
    expect(body.runtime_diagnostics.intent_chunk_diagnostics).toMatchObject(expected);
    const record = app.db.assetPlanRecords.get(body.asset_plan_record_id)!;
    expect(record.executionStateJson).toMatchObject({ intent_chunk_diagnostics: expected });
    expect(record.runtimeDiagnosticsJson).toMatchObject({ intent_chunk_diagnostics: expected });
    const serialized = JSON.stringify({ body, execution: record.executionStateJson, diagnostics: record.runtimeDiagnosticsJson });
    expect(serialized).not.toContain("RAW_SUCCESS_CHUNK_SECRET");
    expect(serialized).not.toContain('"issues":');
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("asset-planning.intent-chunks");
    expect(trace).not.toContain("RAW_SUCCESS_CHUNK_SECRET");
    expect(trace).not.toContain('"issues":');
  });

  it("returns 422 in legacy mode without full regeneration when local validation remains invalid", async () => {
    process.env.ASSET_PLANNING_GENERATION_MODE = "legacy";
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockResolvedValue(
      makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        sourceScriptOverride: "script_record_other",
        topicPackageId: prepared.topicPackage.id,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: "asset_plan_local_validation_failed",
      local_validation: {
        stage: "asset_planning_local_validation",
        decision: "regen_once",
        errors: ["asset_plan_source_script_mismatch"],
      },
    });
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
    expect(generateAssetPlanMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ regenerationContext: expect.anything() }),
    );
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
    const generatingRecords = [...app.db.assetPlanRecords.values()].filter(
      (record) =>
        (record.executionStateJson as Record<string, unknown> | null)
          ?.generating === true,
    );
    expect(generatingRecords).toHaveLength(0);
  });

  it("classifies intent compiler mechanical validation failures as compiler invariants without repair or regeneration", async () => {
    const previousMode = process.env.ASSET_PLANNING_GENERATION_MODE;
    process.env.ASSET_PLANNING_GENERATION_MODE = "intent_compiler";
    try {
      const app = buildApp();
      const prepared = await prepareActiveStoryboard(app);
      generateAssetPlanMock.mockResolvedValueOnce(
        makeAssetPlan({
          storyboardRecordId: prepared.storyboardRecord.id,
          scriptRecordId: prepared.scriptRecord.id,
          sourceScriptOverride: "script_record_other",
          topicPackageId: prepared.topicPackage.id,
        }),
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
        auth,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: "asset_plan_compiler_invariant_failed",
      });
      expect(response.json()).not.toHaveProperty("message");
      expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
      expect(repairAssetPlanStructureMock).not.toHaveBeenCalled();
      const failed = [...app.db.assetPlanRecords.values()].at(-1)!;
      expect(failed.runtimeDiagnosticsJson).toMatchObject({
        compiler_invariant_failure: {
          issue_count: 1,
          issue_codes: ["asset_plan_source_script_mismatch"],
          issue_paths: ["<root>"],
          issues_truncated: false,
        },
      });
    } finally {
      if (previousMode === undefined) delete process.env.ASSET_PLANNING_GENERATION_MODE;
      else process.env.ASSET_PLANNING_GENERATION_MODE = previousMode;
    }
  });

  it("repairs a structurally invalid legacy asset plan once without full regeneration", async () => {
    process.env.ASSET_PLANNING_GENERATION_MODE = "legacy";
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const invalidPlan = makeAssetPlan({
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      topicPackageId: prepared.topicPackage.id,
    });
    invalidPlan.tasks[2].risk_notes = [];
    const repairedPlan = makeAssetPlan({
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      topicPackageId: prepared.topicPackage.id,
    });
    generateAssetPlanMock.mockResolvedValueOnce(invalidPlan);
    repairAssetPlanStructureMock.mockResolvedValueOnce({
      plan: repairedPlan,
      repairUsed: true,
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(200);
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
    expect(repairAssetPlanStructureMock).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: invalidPlan,
        storyboard: prepared.storyboardPlan,
        validation: expect.objectContaining({
          errors: ["asset_visual_risk_notes_missing"],
        }),
      }),
    );
    expect(response.json()).toMatchObject({
      execution_state: {
        regenerate_used: false,
        plan_structural_repair_used: true,
      },
      runtime_diagnostics: {
        checks: expect.arrayContaining([
          {
            code: "asset_planning_plan_structural_repair_used",
            level: "warning",
          },
        ]),
      },
    });
  });

  it("persists normalized global structure diagnostics and writes the event to trace", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-diagnostic-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({
        type: "normalization_applied",
        actions: [
          { type: "default_inserted", path: "tasks[2].risk_notes" },
          { type: "default_inserted", path: "art_bible.props[0].consistency_notes" },
          { type: "default_inserted", path: "tasks[2].risk_notes" },
          { type: "forbidden_chunk_key_removed", path: "tasks", key: "tasks" },
        ],
      });
      return makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      });
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      execution_state: {
        global_structure_normalization_used: true,
        global_structure_normalized_paths: [
          "art_bible.props[0].consistency_notes",
          "tasks[2].risk_notes",
        ],
        global_structure_normalized_path_count: 2,
        global_structure_paths_truncated: false,
        global_structural_repair_used: false,
      },
      runtime_diagnostics: {
        checks: expect.arrayContaining([
          { code: "asset_global_structure_normalization_used", level: "warning" },
          { code: "asset_global_plan_mode_contamination_normalized", level: "warning" },
        ]),
      },
    });
    const record = app.db.assetPlanRecords.get(response.json().asset_plan_record_id)!;
    expect(record.executionStateJson).toMatchObject(response.json().execution_state);
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("asset-planning.global-structure");
    expect(trace).toContain('"type": "normalization_applied"');
    expect(trace).toContain('"action_count": 4');
    expect(trace).toContain('"action_paths"');
    expect(trace).not.toContain('"actions"');
  });

  it("persists redacted wrapper and timing success diagnostics without changing the success contract", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-resilience-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({
        type: "legacy_chunk_patch_coerced",
        actions: [
          { type: "single_wrapper_unwrapped" },
          { type: "missing_discriminator_defaulted" },
        ],
      });
      await input.onGlobalStructureEvent?.({
        type: "legacy_audio_timing_canonicalized",
        actions: [
          {
            type: "audio_timing_rebound",
            dependency_id: "dep-secret",
            before_task_id: "motion-secret",
            after_task_id: "tts-secret",
            reason_code: "invalid_audio_timing_source",
          },
        ],
      });
      return makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      });
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      asset_plan_record_id: expect.any(String),
      execution_state: {
        legacy_chunk_patch_coercion_used: true,
        legacy_chunk_patch_action_types: [
          "missing_discriminator_defaulted",
          "single_wrapper_unwrapped",
        ],
        legacy_audio_timing_rebind_used: true,
        legacy_audio_timing_rebind_count: 1,
      },
      runtime_diagnostics: {
        checks: expect.arrayContaining([
          { code: "asset_legacy_chunk_patch_coerced", level: "warning" },
          { code: "asset_legacy_audio_timing_rebound", level: "warning" },
        ]),
      },
    });
    expect(JSON.stringify(body.execution_state)).not.toContain("dep-secret");
    expect(JSON.stringify(body.execution_state)).not.toContain("motion-secret");
    expect(JSON.stringify(body.runtime_diagnostics)).not.toContain("tts-secret");

    const record = app.db.assetPlanRecords.get(body.asset_plan_record_id)!;
    expect(record.executionStateJson).toMatchObject(body.execution_state);
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("asset-planning.resilience");
    expect(trace).toContain('"action_types"');
    expect(trace).not.toContain("dep-secret");
    expect(trace).not.toContain("motion-secret");
    expect(trace).not.toContain("tts-secret");
  });

  it("returns a bounded timing ambiguity error and restores project state", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-timing-failure-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({
        type: "legacy_audio_timing_canonicalization_failed",
        error_code: "asset_legacy_audio_timing_rebind_ambiguous",
        issues: [
          {
            code: "audio_timing_rebind_ambiguous",
            path: ["dependencies", 4, "depends_on_task_id"],
            tts_task_count: 2,
            dependency_id: "dep-secret",
            before_task_id: "motion-secret",
          },
        ],
      });
      throw new LegacyChunkResilienceError([
        {
          code: "audio_timing_rebind_ambiguous",
          path: ["dependencies", 4, "depends_on_task_id"],
          tts_task_count: 2,
        },
      ]);
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "asset_legacy_audio_timing_rebind_ambiguous",
      repair_used: false,
      failure_class: "deterministic_resilience",
      issue_count: 1,
      issue_paths: ["dependencies[4].depends_on_task_id"],
    });
    expect(response.json()).not.toHaveProperty("message");
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
    expect(prepared.project.status).toBe("storyboard_ready");
    const failed = [...app.db.assetPlanRecords.values()].at(-1)!;
    expect(failed.executionStateJson).toMatchObject({
      generating: false,
      error: "asset_legacy_audio_timing_rebind_ambiguous",
      legacy_audio_timing_rebind_failed: true,
    });
    expect(failed.runtimeDiagnosticsJson).toMatchObject({
      checks: expect.arrayContaining([
        {
          code: "asset_legacy_audio_timing_rebind_ambiguous",
          level: "error",
        },
      ]),
    });
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain('"issue_count": 1');
    expect(trace).not.toContain("dep-secret");
    expect(trace).not.toContain("motion-secret");
  });

  it("keeps the bounded timing error when resilience and error trace writes both fail", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-timing-trace-failure-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      const profile = getProjectStorageProfile(prepared.project)!;
      const traceDir = resolve(root, profile.trace_dir);
      rmSync(traceDir, { recursive: true, force: true });
      writeFileSync(traceDir, "block every trace write", "utf8");
      await input.onGlobalStructureEvent?.({
        type: "legacy_audio_timing_canonicalization_failed",
        error_code: "asset_legacy_audio_timing_rebind_ambiguous",
        issues: [
          {
            code: "audio_timing_rebind_ambiguous",
            path: ["dependencies", 1, "depends_on_task_id"],
            tts_task_count: 0,
          },
        ],
      });
      throw new LegacyChunkResilienceError([
        {
          code: "audio_timing_rebind_ambiguous",
          path: ["dependencies", 1, "depends_on_task_id"],
          tts_task_count: 0,
        },
      ]);
    });

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
        auth,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: "asset_legacy_audio_timing_rebind_ambiguous",
        failure_class: "deterministic_resilience",
        issue_count: 1,
      });
      expect(response.json()).not.toHaveProperty("message");
      expect(prepared.project.status).toBe("storyboard_ready");
      expect(prepared.project.activeAssetPlanRecordId).toBeNull();
      expect(warning).toHaveBeenCalledWith(
        "[asset-planning] global_structure_diagnostic_write_failed",
      );
      expect(warning).toHaveBeenCalledWith(
        "[asset-planning] trace_error_writer_failed",
      );
    } finally {
      warning.mockRestore();
      const profile = getProjectStorageProfile(prepared.project)!;
      const traceDir = resolve(root, profile.trace_dir);
      rmSync(traceDir, { force: true });
      mkdirSync(traceDir, { recursive: true });
    }
  });

  it("persists a redacted wrapper coercion failure without changing the chunk error boundary", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-wrapper-failure-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({
        type: "legacy_chunk_patch_coercion_failed",
        error_code: "asset_legacy_chunk_patch_coercion_failed",
        issues: [
          {
            code: "unrecognized_keys",
            path: ["patch_fields"],
            dependency_id: "dep-secret",
          },
        ],
      });
      throw new LlmOutputError("asset_chunk_plan_schema_invalid", {
        cause: [
          {
            code: "unrecognized_keys",
            path: ["patch_fields"],
            message: "secret-zod-message-for-task-secret",
            received: "dependency-secret-received-value",
            keys: ["secret_unknown_wrapper_key"],
          },
        ],
      });
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: "asset_chunk_plan_schema_invalid",
    });
    expect(response.json()).not.toHaveProperty("message");
    expect(response.json()).not.toHaveProperty("issue_paths");
    const failed = [...app.db.assetPlanRecords.values()].at(-1)!;
    expect(failed.executionStateJson).toMatchObject({
      legacy_chunk_patch_coercion_failed: true,
      legacy_chunk_patch_issue_count: 1,
      legacy_chunk_patch_issue_paths: ["patch_fields"],
    });
    expect(failed.runtimeDiagnosticsJson).toMatchObject({
      checks: expect.arrayContaining([
        {
          code: "asset_legacy_chunk_patch_coercion_failed",
          level: "error",
        },
      ]),
    });
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain('"issue_paths"');
    expect(trace).toContain('"error_code": "asset_chunk_plan_schema_invalid"');
    expect(trace).toContain('"failure_class": "deterministic_resilience"');
    expect(trace).not.toContain("dep-secret");
    expect(trace).not.toContain("secret-zod-message-for-task-secret");
    expect(trace).not.toContain("dependency-secret-received-value");
    expect(trace).not.toContain("secret_unknown_wrapper_key");
  });

  it("caps normalized paths at 50 while retaining the pre-truncation count", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({
        type: "normalization_applied",
        actions: Array.from({ length: 55 }, (_, index) => ({
          type: "default_inserted",
          path: `tasks[${String(index).padStart(2, "0")}].risk_notes`,
        })),
      });
      return makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      });
    });

    const response = await app.inject({ method: "POST", url: `/api/projects/${prepared.project.id}/asset-plan/generate`, auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().execution_state).toMatchObject({
      global_structure_normalized_path_count: 55,
      global_structure_paths_truncated: true,
    });
    expect(response.json().execution_state.global_structure_normalized_paths).toHaveLength(50);
  });

  it("persists repair success diagnostics without full regeneration", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const valid = makeAssetPlan({
      storyboardRecordId: prepared.storyboardRecord.id,
      scriptRecordId: prepared.scriptRecord.id,
      topicPackageId: prepared.topicPackage.id,
    });
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({ type: "repair_started", issues: [] });
      await input.onGlobalStructureEvent?.({ type: "repair_succeeded" });
      return valid;
    });

    const response = await app.inject({ method: "POST", url: `/api/projects/${prepared.project.id}/asset-plan/generate`, auth });
    expect(response.statusCode).toBe(200);
    expect(generateAssetPlanMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ onGlobalStructureEvent: expect.any(Function) }));
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
    expect(response.json()).toMatchObject({
      execution_state: { global_structural_repair_used: true },
      runtime_diagnostics: { checks: expect.arrayContaining([{ code: "asset_global_structural_repair_used", level: "warning" }]) },
    });
  });

  it("returns bounded structural issue paths and persists schema repair failure diagnostics", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-failure-trace-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const initial_issues = Array.from({ length: 22 }, (_, index) => ({ path: ["tasks", index, "risk_notes"], message: `RAW_GLOBAL_SECRET_${index}`, value: "secret_token_123" }));
    const patch_issues = [{ path: ["art_bible", "props", 0, "consistency_notes"], message: "RAW_GLOBAL_SECRET_PATCH", value: "secret_token_123" }];
    const final_issues = [{ path: [], message: "RAW_GLOBAL_SECRET_FINAL", value: "secret_token_123" }];
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({ type: "repair_started", issues: initial_issues });
      await input.onGlobalStructureEvent?.({ type: "repair_failed", initial_issues, patch_issues, final_issues });
      throw new LlmOutputError("asset_global_plan_structural_repair_failed", {
        cause: { initial_issues, patch_issues, final_issues },
      });
    });

    const response = await app.inject({ method: "POST", url: `/api/projects/${prepared.project.id}/asset-plan/generate`, auth });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body).toMatchObject({ error: "asset_global_plan_structural_repair_failed", repair_used: true });
    expect(body).not.toHaveProperty("message");
    expect(body.issue_paths).toHaveLength(20);
    expect(body.issue_paths).toEqual([...body.issue_paths].sort());
    expect(body.issue_paths).toContain("<root>");
    expect(JSON.stringify(body.issue_paths)).not.toContain("secret");
    expect(JSON.stringify(body.issue_paths)).not.toContain("narrative");
    const failed = [...app.db.assetPlanRecords.values()][0];
    expect(failed.executionStateJson).toMatchObject({ generating: false, global_structural_repair_used: true });
    expect(failed.runtimeDiagnosticsJson).toMatchObject({
      checks: expect.arrayContaining([{ code: "asset_global_structural_repair_failed", level: "error" }]),
    });
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain('"type": "repair_failed"');
    expect(trace).toContain('"issue_count"');
    expect(trace).toContain('"issue_paths"');
    expect(trace).not.toContain('"initial_issues"');
    expect(trace).not.toContain('"patch_issues"');
    expect(trace).not.toContain('"final_issues"');
    expect(trace).not.toContain("RAW_GLOBAL_SECRET");
    expect(trace).not.toContain("secret_token_123");
  });

  it("preserves the external error boundary while persisting provider repair failure diagnostics", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-provider-failure-trace-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      await input.onGlobalStructureEvent?.({ type: "repair_started", issues: [] });
      await input.onGlobalStructureEvent?.({ type: "repair_provider_failed", error_code: "llm_service_unavailable" });
      throw new ExternalServiceError({
        provider: "llm",
        operation: "asset-planning.global-structural-repair",
        retryable: true,
        code: "llm_service_unavailable",
        userMessage: "temporarily unavailable",
        debugMessage: "provider unavailable",
      });
    });

    const response = await app.inject({ method: "POST", url: `/api/projects/${prepared.project.id}/asset-plan/generate`, auth });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "internal_server_error", repair_used: true });
    expect(response.json()).not.toHaveProperty("message");
    expect(response.json()).not.toHaveProperty("attempt_count");
    const failed = [...app.db.assetPlanRecords.values()][0];
    const diagnostics = failed.runtimeDiagnosticsJson as { checks: Array<{ code: string }> };
    expect(diagnostics.checks).toContainEqual({ code: "asset_global_structural_repair_provider_failed", level: "error" });
    expect(diagnostics.checks.map((check) => check.code)).not.toContain("asset_global_structural_repair_failed");
    const profile = getProjectStorageProfile(prepared.project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain('"type": "repair_provider_failed"');
    expect(trace).toContain(
      '"error_code": "asset_global_structural_repair_provider_failed"',
    );
  });

  it("does not fail generation when the diagnostic trace callback cannot write", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-trace-failure-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    generateAssetPlanMock.mockImplementationOnce(async (input) => {
      const profile = getProjectStorageProfile(prepared.project)!;
      const traceDir = resolve(root, profile.trace_dir);
      rmSync(traceDir, { recursive: true, force: true });
      writeFileSync(traceDir, "temporarily block trace directory", "utf8");
      await input.onGlobalStructureEvent?.({
        type: "normalization_applied",
        actions: [{ type: "default_inserted", path: "art_bible.props[0].consistency_notes" }],
      });
      rmSync(traceDir, { force: true });
      mkdirSync(traceDir, { recursive: true });
      return makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      });
    });

    const response = await app.inject({ method: "POST", url: `/api/projects/${prepared.project.id}/asset-plan/generate`, auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().execution_state.global_structure_normalization_used).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "[asset-planning] global_structure_diagnostic_write_failed",
    );
    warning.mockRestore();
  });

  it("activates a successful plan when trace storage stays unavailable from writer initialization through artifact persistence", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-api-trace-unavailable-success-"));
    storageRoots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    const profile = getProjectStorageProfile(prepared.project)!;
    const traceDir = resolve(root, profile.trace_dir);
    mkdirSync(resolve(traceDir, ".."), { recursive: true });
    rmSync(traceDir, { recursive: true, force: true });
    writeFileSync(traceDir, "block trace storage for the whole request", "utf8");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    generateAssetPlanMock.mockResolvedValueOnce(
      makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      }),
    );

    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
        auth,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        asset_plan_record_id: expect.any(String),
        execution_state: { regenerate_used: false },
      });
      expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
      expect(prepared.project.status).toBe("asset_plan_ready");
      expect(prepared.project.activeAssetPlanRecordId).toBe(
        body.asset_plan_record_id,
      );
      expect(app.db.assetPlanRecords.get(body.asset_plan_record_id)).toMatchObject({
        id: body.asset_plan_record_id,
      });
      expect(warning).toHaveBeenCalledWith(
        "[asset-planning] trace_writer_initialization_failed",
      );
      expect(warning).toHaveBeenCalledWith(
        "[asset-planning] run_diagnostics_persistence_failed",
      );
    } finally {
      warning.mockRestore();
      rmSync(traceDir, { force: true });
      mkdirSync(traceDir, { recursive: true });
    }
  });

  it("returns 409 and does not activate when the active storyboard changes during generation", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    generateAssetPlanMock.mockImplementationOnce(async () => {
      prepared.project.activeStoryboardRecordId = "storyboard_record_new";
      return makeAssetPlan({
        storyboardRecordId: prepared.storyboardRecord.id,
        scriptRecordId: prepared.scriptRecord.id,
        topicPackageId: prepared.topicPackage.id,
      });
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "stale_asset_plan_source",
    });
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
    expect(app.db.assetPlanRecords.size).toBe(0);
  });
});
