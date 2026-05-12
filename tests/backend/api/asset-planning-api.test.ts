import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAssetPlanMock = vi.hoisted(() => vi.fn());
const repairAssetPlanStructureMock = vi.hoisted(() => vi.fn());

vi.mock("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js", () => ({
  generateAssetPlan: generateAssetPlanMock,
}));
vi.mock("../../../backend/src/modules/asset-planning/asset-planning-structural-repair.service.js", () => ({
  repairAssetPlanStructure: repairAssetPlanStructureMock,
}));

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import type { AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";

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
          motion: "push_in",
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
  const project = await createProject(app.db, {
    name: "Asset Planning API Flow",
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
  beforeEach(() => {
    generateAssetPlanMock.mockReset();
    repairAssetPlanStructureMock.mockReset();
    repairAssetPlanStructureMock.mockImplementation(async (input) => ({
      plan: input.plan,
      repairUsed: false,
    }));
  });

  it("returns 404 when the project does not exist", async () => {
    const app = buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/missing/asset-plan/generate",
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
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/asset-plan/generate`,
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
    });
    project.activeStoryboardRecordId = "storyboard_missing";

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/asset-plan/generate`,
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
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "source_record_not_found",
    });
  });

  it("returns 404 when the storyboard source topic was deleted", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
    app.db.topicPackages.delete(prepared.topicPackage.id);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/asset-plan/generate`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "source_record_not_found",
    });
  });

  it("generates, validates, persists, and activates an asset plan from active storyboard", async () => {
    const app = buildApp();
    const prepared = await prepareActiveStoryboard(app);
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
    expect(prepared.project.latestAssetPlanRunTraceJson).toMatchObject({
      phase: "asset_planning",
    });

    const snapshot = await getProjectSnapshot(app.db, prepared.project.id);
    expect(snapshot?.active_asset_plan).toMatchObject({
      asset_plan_record_id: body.asset_plan_record_id,
      source_storyboard_record_id: prepared.storyboardRecord.id,
    });
  });

  it("returns 422 and does not activate when local validation fails after regen once", async () => {
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
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(2);
    expect(generateAssetPlanMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        regenerationContext: expect.objectContaining({
          reason: "asset_planning_local_validation_regen_once",
        }),
      }),
    );
    expect(prepared.project.status).toBe("storyboard_ready");
    expect(prepared.project.activeAssetPlanRecordId).toBeNull();
  });

  it("repairs a structurally invalid asset plan before using full regen", async () => {
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
