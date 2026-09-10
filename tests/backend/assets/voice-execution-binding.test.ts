import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { seedGenerationCatalog } from "../helpers/seed-generation-catalog.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import type { AssetManifest, AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { buildQuotableReadinessInput, seedQuotableCatalog } from "../cost/quote-test-context.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

/**
 * S2-2B 任务 5：assets 音色执行绑定（详细设计 §6.2，外部审查 P1-5）。
 *
 * - 快照是唯一权威：fixed → 指定档案；auto → intent 匹配。
 * - 客户端 voice_profile_id 与快照不一致 → 422，且**先于 quote 消费**：
 *   quote 未消费、无 snapshot/run 创建、无 provider 调用。
 * - legacy 免 quote 路径忽略客户端值，改用项目配置 creative。
 */

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
        visual_intent: "Public pressure turns into a visible answer.",
        scene_description: "A tense public hall holds on the envoy's answer.",
        visual_elements: ["envoy", "public hall"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: [],
        api_video_suitability: "api_video_strongly_recommended",
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
      visual_tone: "cold pressure",
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
        { chunk_id: "tts_001", order: 0, script_excerpt: scriptText, estimated_duration_sec: 82 },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "generate narration audio",
        recommended_mode: "auto",
        provider_hint: "default_tts",
        prompt_draft: null,
        parameters: { voice_profile_id: "voice_default_male_storyteller", chunk_ids: ["tts_001"] },
        manual_upload_policy: {},
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { tts_audio: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

interface PreparedSetup {
  app: ReturnType<typeof buildApp>;
  project: Awaited<ReturnType<typeof createProject>>;
  assetPlanRecord: Awaited<ReturnType<typeof saveAssetPlanRecord>>;
}

async function prepare(app: ReturnType<typeof buildApp>, ownerId = "owner-voice"): Promise<PreparedSetup> {
  const project = await createProject(app.db, { name: "Voice Binding", ownerId });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "Voice Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {},
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: [],
  });
  const scriptRecord = await saveScriptRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText,
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 82,
  });
  const storyboardRecord = await saveStoryboardRecord(app.db, {
    projectId: project.id,
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
    planJson: makeStoryboardPlan({ scriptRecordId: scriptRecord.id, topicPackageId: topicPackage.id }),
  });
  const assetPlan = makeAssetPlan({
    storyboardRecordId: storyboardRecord.id,
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
  });
  const assetPlanRecord = await saveAssetPlanRecord(app.db, {
    projectId: project.id,
    storyboardRecordId: storyboardRecord.id,
    planJson: assetPlan,
    runId: "voice-binding-run",
    status: "succeeded",
  });
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.activeAssetPlanRecordId = assetPlanRecord.id;
  return { app, project, assetPlanRecord };
}

/** 测试态直接种入项目配置 creative（PATCH creative 由任务 8 开放）。 */
function setProjectCreative(
  app: ReturnType<typeof buildApp>,
  projectId: string,
  creative: { voice_profile_id: string | null; art_style_preset_id?: string | null; subtitle_style_preset_id?: string | null },
): void {
  for (const record of app.db.projectGenerationConfigurations.values()) {
    if (record.projectId === projectId) {
      record.configurationJson = {
        ...record.configurationJson,
        creative: {
          voice_profile_id: creative.voice_profile_id,
          art_style_preset_id: creative.art_style_preset_id ?? null,
          subtitle_style_preset_id: creative.subtitle_style_preset_id ?? null,
          subtitle_style_overrides: {},
        },
      };
      return;
    }
  }
  throw new Error(`project config not found for ${projectId}`);
}

const auth = buildTestAuth({ userId: "owner-voice" });

describe("S2-2B assets 音色执行绑定", () => {
  it("提交路径 fixed：快照音色进入 manifest（voice_profile_id 与快照一致时放行）", async () => {
    const app = buildApp();
    const prepared = await prepare(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);
    setProjectCreative(app, prepared.project.id, {
      voice_profile_id: "voice_preset_cold_authority",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_preset_cold_authority",
        execution_mode: "auto_available",
        idempotency_key: "voice-binding-fixed-1",
      },
      auth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { manifest: AssetManifest };
    expect(body.manifest.audio_summary.voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );
  });

  it("提交路径 auto：不携带 voice_profile_id → 快照 auto 触发 intent 匹配", async () => {
    const app = buildApp();
    const prepared = await prepare(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        execution_mode: "auto_available",
        idempotency_key: "voice-binding-auto-1",
      },
      auth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { manifest: AssetManifest };
    expect(body.manifest.audio_summary.voice_profile_id).toBeTruthy();
  });

  it("冲突先于 quote 消费：客户端 voice_profile_id 与快照不一致 → 422，quote 未消费、无 snapshot/run、无 provider 调用", async () => {
    const app = buildApp();
    const prepared = await prepare(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);
    setProjectCreative(app, prepared.project.id, {
      voice_profile_id: "voice_preset_cold_authority",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        voice_profile_id: "voice_preset_crisp_storyteller",
        execution_mode: "auto_available",
        idempotency_key: "voice-binding-conflict-1",
      },
      auth,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: "generation_voice_profile_conflict" });

    // 冲突先于 run 创建：无 snapshot / run / provider 调用
    expect(app.db.runConfigurationSnapshots.size).toBe(0);
    expect(app.db.generationRuns.size).toBe(0);
  });

  it("直连提交：执行音色来自快照 resolved creative（项目配置），客户端不再携带", async () => {
    const app = buildApp({});
    seedGenerationCatalog(app);
    const prepared = await prepare(app);
    await seedGlobalVoiceProfiles(app.db);
    setProjectCreative(app, prepared.project.id, {
      voice_profile_id: "voice_preset_cold_authority",
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${prepared.project.id}/assets/generate`,
      payload: {
        execution_mode: "dry_run",
      },
      auth,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { manifest: AssetManifest };
    // 快照 resolved creative（项目配置 cold_authority）生效
    expect(body.manifest.audio_summary.voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );
  });
});
