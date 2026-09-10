import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 复审整改 P2-4：asset-planning run-service 级快照派生测试（repair 可达分支）。
 *
 * 复审指出旧测试的探针在 planner 首次调用即抛错，repair（仅在 legacy +
 * regen_once 下执行）从未到达。本文件：
 * - env mock `assetPlanningGenerationMode: "legacy"`；
 * - `generateAssetPlan` 被 mock 返回**缺 prompt_draft 的 plan**（image_still 的
 *   prompt_draft 为空 → 校验错误全部属于 REPAIRABLE_ERRORS → decision=regen_once）；
 * - 真实 `repairAssetPlanStructure` 被触发 → gateway 构造 → 工厂（mock 探针）。
 * 断言 repair gateway 收到快照 capabilities（有/无 billingContext 两路径）。
 */

const { generateAssetPlanMock, factoryOptionsMock } = vi.hoisted(() => ({
  generateAssetPlanMock: vi.fn(),
  factoryOptionsMock: vi.fn(),
}));

vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",

    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    assetPlanningGenerationMode: "legacy",
    llm: {
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5",
      timeoutMs: 45000,
    },
  };
  return {
    env,
    getValidatedRuntimeEnv: () => env,
  };
});

// 仅 mock generateAssetPlan：保留 generation service 其余导出
vi.mock(
  "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js",
  async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js")>();
    return { ...actual, generateAssetPlan: generateAssetPlanMock };
  },
);

// 工厂 mock：记录 options（repair gateway 构造断言）
vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: (options?: unknown) => {
    factoryOptionsMock(options);
    return {
      invokeStructuredPrompt: async () => {
        throw new Error("S2-2C_SNAPSHOT_PROBE");
      },
      invokeStrictStructured: async () => {
        throw new Error("S2-2C_SNAPSHOT_PROBE");
      },
    };
  },
  resolveTierProviderSnapshot: vi.fn(),
}));

import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { runAssetPlanningGeneration } from "../../../backend/src/modules/asset-planning/asset-planning-run.service.js";
import type { ResolvedCapabilityMap, StoryboardPlan } from "../../../shared/src/index.js";

const SNAPSHOT_CAPABILITIES: ResolvedCapabilityMap = {
  "llm.smart": {
    mode: "fixed",
    provider_model_id: "llm.smart.deepseek.deepseek-v4-pro",
    provider_key: "deepseek",
    model_id: "deepseek-v4-pro",
  },
  "llm.flash": { mode: "auto", provider_model_id: "f", provider_key: "zhipu", model_id: "glm-4" },
  "image.generate": { mode: "auto", provider_model_id: "img", provider_key: "dashscope", model_id: "wanx" },
  "video.image_to_video": { mode: "auto", provider_model_id: "vid", provider_key: "dashscope", model_id: "wan" },
  "tts.synthesize": { mode: "auto", provider_model_id: "tts", provider_key: "dashscope", model_id: "qwen" },
};

/**
 * 触发 regen_once 的 plan（fixture 复用 structural-repair 测试形状）：
 * img_001.prompt_draft 为空 → asset_visual_prompt_missing；
 * motion_001.risk_notes 为空 → asset_visual_risk_notes_missing；
 * video_001 无 static_fallback → asset_video_missing_static_fallback。
 * 三类错误全部属于 REPAIRABLE_ERRORS → isRepairableValidation=true。
 */
function makeRepairablePlan(
  scriptText: string,
  sourceIds: { storyboardRecordId: string; scriptRecordId: string; topicPackageId: string },
) {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: sourceIds.storyboardRecordId,
    source_script_record_id: sourceIds.scriptRecordId,
    source_topic_package_id: sourceIds.topicPackageId,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "cold pressure",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: ["modern building"],
      consistency_notes: [],
    },
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: 60,
      chunking_strategy: "segment_boundary",
      chunks: [{ chunk_id: "tts_001", order: 0, script_excerpt: scriptText, estimated_duration_sec: 60 }],
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
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
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
        parameters: { source_tts_task_id: "tts_001" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create the anchor visual.",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: null,
        parameters: { aspect_ratio: "9:16", image_role: "anchor" },
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png"], acceptance_notes: [] },
        risk_notes: ["Avoid modern elements."],
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
        parameters: { motion: "push_in", source_image_task_id: "img_001" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "video_001",
        order: 4,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create the key physical action clip.",
        recommended_mode: "manual_preferred",
        provider_hint: "video_provider",
        prompt_draft: "Ancient public hall, pressure turns into action.",
        parameters: {},
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["video/mp4"], acceptance_notes: [] },
        risk_notes: ["Avoid graphic content."],
        cost_tier: "high",
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
        dependency_id: "dep_motion_after_img",
        task_id: "motion_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      },
    ],
    cost_summary: {
      total_tasks: 5,
      by_type: { tts_audio: 1, subtitle_track: 1, image_still: 1, render_motion_cue: 1, video_clip: 1 },
      by_cost_tier: { free: 2, low: 2, medium: 0, high: 1 },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: ["No physical assets are generated."],
  };
}

function makeStoryboardPlan(input: { scriptRecordId: string; topicPackageId: string }): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    estimated_total_duration_sec: 40,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: "The envoy answers in public.",
        start_hint_sec: 0,
        end_hint_sec: 40,
        narrative_role: "opening",
        visual_intent: "Show the public pressure.",
        scene_description: "A tense public hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        api_video_suitability: "api_video_strongly_recommended",
        motion_hint: "static",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: [],
      },
    ],
    global_visual_notes: [],
  };
}

function seedGenerationCatalog(db: ReturnType<typeof createDbClient>) {
  const now = new Date();
  const catalogSeed: Array<[string, string]> = [
    ["llm.smart", "dashscope.qwen-max"],
    ["llm.flash", "dashscope.qwen-flash"],
    ["image.generate", "dashscope.wanx-v1"],
    ["video.image_to_video", "dashscope.video-v1"],
    ["tts.synthesize", "dashscope.tts"],
  ];
  for (const [capability, id] of catalogSeed) {
    db.providerModelCatalog.set(id, {
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

async function prepareActiveStoryboard() {
  const db = createDbClient();
  seedGenerationCatalog(db);
  const project = await createProject(db, { name: "Asset Plan Repair Snapshot" });
  const topicPackage = await saveTopicPackage(db, {
    projectId: project.id,
    title: "Asset Plan Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "A public pressure scene begins.",
      pressure_escalation: "The insult keeps rising.",
      mid_reveal: "The answer is guarding the state's face.",
      peak_payoff: "The reply reverses the pressure.",
      ending_residue: "Retreat would cost more than silence.",
    },
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptText = "The envoy answers in public.";
  const scriptRecord = await saveScriptRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText,
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 40,
    beatTraceJson: [{ beat: "public answer", excerpt: "The envoy answers in public.", confidence: 0.95 }],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass" },
    semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
    executionStateJson: { patch_used: false, regenerate_used: false },
  });
  const storyboardPlan = makeStoryboardPlan({
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
  });
  const storyboardRecord = await saveStoryboardRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    planJson: storyboardPlan,
    validationResultJson: { stage: "storyboard_local_validation", decision: "pass" },
  });
  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.status = "storyboard_ready";
  return { db, project, scriptText, storyboardRecord, scriptRecord, topicPackage };
}

function buildBillingContext(db: ReturnType<typeof createDbClient>, project: { id: string; ownerId: string }) {
  const now = new Date();
  const snapshot = {
    id: "snap_ap_repair_001",
    projectId: project.id,
    userId: project.ownerId,
    stage: "asset_planning",
    operation: "asset_plan.generate",
    runId: "run_ap_repair_001",
    projectConfigurationRevision: 1,
    schemaVersion: "run_configuration_snapshot_v1",
    configurationHash: "fnv1a64:1111111111111111",
    resolvedConfigurationJson: {
      schema_version: "resolved_generation_configuration_v1",
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as unknown as Record<string, unknown>,
    resolutionTraceJson: [],
    quoteId: null,
    quoteFingerprint: null,
    estimatedCostMicros: null,
    authorizationCostMicros: null,
    containsUnboundedItem: false,
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: null,
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
  };
  db.runConfigurationSnapshots.set(snapshot.id, snapshot as never);
  return {
    db,
    snapshot: snapshot as never,
    runId: "run_ap_repair_001",
    operation: "asset_plan.generate" as const,
    resolved: {
      resolved_capabilities: SNAPSHOT_CAPABILITIES,
    } as never,
  };
}

describe("asset-planning run-service 快照派生：repair 可达分支（S2-2C 复审 P2-4）", () => {
  beforeEach(() => {
    generateAssetPlanMock.mockReset();
    factoryOptionsMock.mockReset();
  });

  it("billingContext 提供 → legacy regen_once 触发 repair，repair gateway 收到快照 capabilities", async () => {
    const { db, project, scriptText, storyboardRecord, scriptRecord, topicPackage } =
      await prepareActiveStoryboard();
    generateAssetPlanMock.mockImplementation(async () =>
      makeRepairablePlan(scriptText, {
        storyboardRecordId: storyboardRecord.id,
        scriptRecordId: scriptRecord.id,
        topicPackageId: topicPackage.id,
      }),
    );
    const billingContext = buildBillingContext(db, project);
    const response = await runAssetPlanningGeneration({
      db,
      project,

      billingContext: billingContext as never,
    });
    // repair 的 gateway 探针抛错 → run service 失败响应；repair 分支确实被执行
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const body = response.body as Record<string, unknown>;
    expect(factoryOptionsMock).toHaveBeenCalledWith({
      snapshotCapabilities: SNAPSHOT_CAPABILITIES,
    });
  });

  it("无 billingContext（免 quote 本地路径）→ repair gateway 收到 undefined", async () => {
    const { db, project, scriptText, storyboardRecord, scriptRecord, topicPackage } =
      await prepareActiveStoryboard();
    generateAssetPlanMock.mockImplementation(async () =>
      makeRepairablePlan(scriptText, {
        storyboardRecordId: storyboardRecord.id,
        scriptRecordId: scriptRecord.id,
        topicPackageId: topicPackage.id,
      }),
    );
    const response = await runAssetPlanningGeneration({ db, project });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(factoryOptionsMock).toHaveBeenCalledWith(undefined);
  });
});
