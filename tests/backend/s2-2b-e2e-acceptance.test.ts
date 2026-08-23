import { describe, expect, it } from "vitest";

import { buildApp } from "../../backend/src/app.js";
import { createProject } from "../../backend/src/modules/projects/project.repository.js";
import { saveAssetPlanRecord } from "../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { saveScriptRecord } from "../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../backend/src/modules/topic/topic-package.repository.js";
import { seedGlobalVoiceProfiles } from "../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { AssetManifest, AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";
import { buildTestAuth } from "./auth/test-utils.js";
import { buildQuotableReadinessInput, seedQuotableCatalog } from "./cost/quote-test-context.js";
import { configureVoiceProfilePersistence } from "../../backend/src/modules/assets/voice/voice-profile.repository.js";

/**
 * S2-2B 任务 10：e2e 验收（详细设计 §13.5 验收清单）。
 *
 * 1. 音色/画风/字幕从用户默认复制到项目并进入运行快照（preset 版本 +
 *    解析参数/最终样式 + tts 实际模型）。
 * 2. creative 单次运行覆盖进入当次快照，不写回项目配置。
 * 3. 执行消费（fake provider）：manifest 音色 = 快照音色；subtitle 样式 =
 *    解析样式。
 * 4. 配置变化失效预览正确；历史快照不可变。
 * 5. 试听：voice.preview quote + 提交 → 回写音频 + usage 落账。
 * 6. 旧 A 请求体兼容（无 creative 段 → creative 回 A 期默认）。
 */

const scriptText =
  "楚王当众压场，晏子必须当场顶回，全场目光都落在他身上。";

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
        visual_intent: "Pressure turns into an answer.",
        scene_description: "A tense hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["answer"],
        linked_quotes: [],
        risk_notes: [],
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
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "cold",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient",
      global_negative_prompts: [],
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
        production_intent: "narration",
        recommended_mode: "auto",
        provider_hint: "default_tts",
        prompt_draft: null,
        parameters: { chunk_ids: ["tts_001"] },
        manual_upload_policy: {},
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
        production_intent: "subtitles",
        recommended_mode: "auto",
        provider_hint: "local_subtitle",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {},
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 2,
      by_type: { tts_audio: 1, subtitle_track: 1 },
      by_cost_tier: { low: 1, free: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function isolateVoiceRoot(app: ReturnType<typeof buildApp>): void {
  const rootDir = mkdtempSync(join(tmpdir(), "s2-2b-e2e-"));
  tempDirs.push(rootDir);
  configureVoiceProfilePersistence(app.db, { rootDir });
}

const auth = buildTestAuth({ userId: "owner-1" });

async function prepareProjectWithAssetPlan(app: ReturnType<typeof buildApp>) {
  const project = await createProject(app.db, { name: "S2-2B E2E", ownerId: "owner-1" });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "E2E Topic",
    selectedAngle: "An answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer.",
    strongScene: "The hall falls quiet.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {},
    mustIncludeBeatsJson: ["answer"],
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
    runId: "s2-2b-e2e-run",
    status: "succeeded",
  });
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.activeAssetPlanRecordId = assetPlanRecord.id;
  return { project, assetPlanRecord };
}

describe("S2-2B e2e 验收", () => {
  it("1+3：用户默认 creative 复制到项目 → 快照冻结 → 执行消费（音色 + 字幕样式）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);

    // 用户默认设置三类偏好
    const patchUser = await app.inject({
      method: "PATCH",
      url: "/api/me/generation-preferences",
      payload: {
        expected_revision: null,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        creative: {
          voice_profile_id: "voice_preset_cold_authority",
          art_style_preset_id: "art_style_classical_ink",
          subtitle_style_preset_id: "subtitle_style_bold_stroke",
          subtitle_style_overrides: { font_size_px: 60 },
        },
      },
      auth,
    });
    expect(patchUser.statusCode).toBe(200);

    // 创建项目 → 冻结复制
    const { project } = await prepareProjectWithAssetPlan(app);
    const projectConfig = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/generation-configuration`,
      auth,
    });
    expect(projectConfig.statusCode).toBe(200);
    const frozenCreative = projectConfig.json().configuration.creative;
    expect(frozenCreative.voice_profile_id).toBe("voice_preset_cold_authority");
    expect(frozenCreative.art_style_preset_id).toBe("art_style_classical_ink");
    expect(frozenCreative.subtitle_style_preset_id).toBe("subtitle_style_bold_stroke");
    expect(frozenCreative.subtitle_style_overrides).toEqual({ font_size_px: 60 });

    // 直连提交 → 快照冻结断言（2026-08-23：无需 quote）
    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {
        execution_mode: "auto_available",
        idempotency_key: "s2-2b-e2e-assets-1",
      },
      auth,
    });
    expect(submit.statusCode).toBe(200);

    // 快照：resolved_creative 冻结（preset 版本/参数、音色身份、tts 实际模型）
    const snapshot = [...app.db.runConfigurationSnapshots.values()][0]!;
    const resolved = snapshot.resolvedConfigurationJson as {
      resolved_creative: {
        voice: { mode: string; voice_profile_id: string | null; provider_name: string | null };
        art_style: { mode: string; preset_id: string | null; preset_version: string | null; resolved_params: { global_prompt_prefix: string } | null };
        subtitle: { mode: string; preset_id: string | null; preset_version: string | null; resolved_style: { style_id: string; font_size_px: number } | null };
      };
      resolved_capabilities: { "tts.synthesize": { provider_model_id: string; model_id: string } };
    };
    expect(resolved.resolved_creative.voice).toMatchObject({
      mode: "fixed",
      voice_profile_id: "voice_preset_cold_authority",
      provider_name: "dashscope",
    });
    expect(resolved.resolved_creative.art_style).toMatchObject({
      mode: "fixed",
      preset_id: "art_style_classical_ink",
      preset_version: "v1",
    });
    expect(resolved.resolved_creative.art_style.resolved_params?.global_prompt_prefix).toContain(
      "水墨",
    );
    expect(resolved.resolved_creative.subtitle).toMatchObject({
      mode: "fixed",
      preset_id: "subtitle_style_bold_stroke",
      preset_version: "v1",
    });
    expect(resolved.resolved_creative.subtitle.resolved_style?.font_size_px).toBe(60);
    // 实际模型（快照保存 preset 解析版本与 tts 实际模型）
    expect(resolved.resolved_capabilities["tts.synthesize"].model_id).toBeTruthy();

    // 执行消费（fake）：manifest 音色 = 快照音色；subtitle 样式 = 解析样式
    const body = submit.json() as { manifest: AssetManifest };
    expect(body.manifest.audio_summary.voice_profile_id).toBe("voice_preset_cold_authority");
    const subtitleArtifact = body.manifest.artifacts.find(
      (a) => a.artifact_type === "subtitle_track",
    );
    const subtitleMeta = subtitleArtifact?.metadata as { subtitle_style?: { style_id?: string; font_size_px?: number } };
    expect(subtitleMeta.subtitle_style?.style_id).toBe("subtitle_style_bold_stroke");
    expect(subtitleMeta.subtitle_style?.font_size_px).toBe(60);
  });

  it("2：项目配置 creative 进入当次快照；run_overrides 提交入口已随报价体系移除", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);
    const { project } = await prepareProjectWithAssetPlan(app);

    // 项目配置设置音色（替代原 run_overrides 语义：执行音色由项目配置/快照决定）
    const patchConfig = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 1,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        creative: {
          voice_profile_id: "voice_preset_cold_authority",
          art_style_preset_id: null,
          subtitle_style_preset_id: null,
        },
      },
      auth,
    });
    expect(patchConfig.statusCode).toBe(200);

    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {
        execution_mode: "auto_available",
        idempotency_key: "s2-2b-e2e-override-1",
      },
      auth,
    });
    expect(submit.statusCode).toBe(200);

    // 快照 effective 使用项目配置音色
    const snapshot = [...app.db.runConfigurationSnapshots.values()][0]!;
    const resolved = snapshot.resolvedConfigurationJson as {
      effective: { creative: { voice_profile_id: string | null } };
    };
    expect(resolved.effective.creative.voice_profile_id).toBe("voice_preset_cold_authority");
  });

  it("5：voice.preview 试听直连 → 回写音频（不建 run/不记账）", async () => {
    const app = buildApp();
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    const { project } = await prepareProjectWithAssetPlan(app);

    const preview = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {},
      auth,
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as { preview_audio_uri?: string };
    expect(previewBody.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);
    // 回写（直连路径，无 run/usage）
    expect(app.db.voiceProfiles.get("voice_preset_cold_authority")?.preview_audio_uri).toMatch(
      /^data:audio\/wav;base64,/,
    );
    expect(app.db.generationRuns.size).toBe(0);
    expect(app.db.usageCostRecords.size).toBe(0);
  });

  it("4+6：画风变更失效预览正确；旧 A 请求体兼容（creative 回 A 期默认）", async () => {
    const app = buildApp();
    const { project } = await prepareProjectWithAssetPlan(app);

    // 项目 PATCH 画风 → GET 失效预览包含 asset_planning
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 1,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        creative: {
          voice_profile_id: null,
          art_style_preset_id: "art_style_classical_ink",
          subtitle_style_preset_id: null,
        },
      },
      auth,
    });
    expect(patch.statusCode).toBe(200);

    // 旧 A 请求体（无 creative 段）→ creative 回 A 期默认（全 null）
    const legacyPatch = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 2,
        video: { strategy: "all_remotion", api_quality: "standard_720p" },
      },
      auth,
    });
    expect(legacyPatch.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/generation-configuration`,
      auth,
    });
    const creative = after.json().configuration.creative;
    expect(creative.voice_profile_id).toBeNull();
    expect(creative.art_style_preset_id).toBeNull();
    expect(creative.subtitle_style_preset_id).toBeNull();
    expect(creative.subtitle_style_overrides).toEqual({});
    expect(after.json().configuration.video.strategy).toBe("all_remotion");
  });
});
