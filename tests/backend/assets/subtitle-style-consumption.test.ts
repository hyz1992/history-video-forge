import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { createLocalSubtitleProvider } from "../../../backend/src/modules/assets/providers/local-subtitle-provider.js";
import {
  DEFAULT_SUBTITLE_STYLE,
  type AssetManifest,
  type AssetPlan,
  type StoryboardPlan,
  type SubtitleStyle,
} from "../../../shared/src/index.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { buildQuotableReadinessInput, seedQuotableCatalog } from "../cost/quote-test-context.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { configureVoiceProfilePersistence } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

/**
 * S2-2B 任务 7：字幕 preset 解析与 provider 消费（详细设计 §8）。
 * - 提交路径：快照 fixed subtitle → manifest execution_options 投影 →
 *   subtitle artifact metadata.subtitle_style = 最终解析样式。
 * - none → 系统默认样式。
 * - provider 级：自定义 execution_options.subtitle_style 被 artifact 消费。
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
  const rootDir = mkdtempSync(join(tmpdir(), "subtitle-consumption-"));
  tempDirs.push(rootDir);
  configureVoiceProfilePersistence(app.db, { rootDir });
}

async function prepare(app: ReturnType<typeof buildApp>) {
  const project = await createProject(app.db, { name: "Subtitle", ownerId: "owner-1" });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "Subtitle Topic",
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
    runId: "subtitle-run",
    status: "succeeded",
  });
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.activeAssetPlanRecordId = assetPlanRecord.id;
  return { project, assetPlanRecord };
}

function setProjectSubtitle(
  app: ReturnType<typeof buildApp>,
  projectId: string,
  subtitle: { subtitle_style_preset_id: string | null; subtitle_style_overrides?: Record<string, unknown> },
): void {
  for (const record of app.db.projectGenerationConfigurations.values()) {
    if (record.projectId === projectId) {
      record.configurationJson = {
        ...record.configurationJson,
        creative: {
          voice_profile_id: null,
          art_style_preset_id: null,
          subtitle_style_preset_id: subtitle.subtitle_style_preset_id,
          subtitle_style_overrides: subtitle.subtitle_style_overrides ?? {},
        },
      };
      return;
    }
  }
  throw new Error(`project config not found for ${projectId}`);
}

const auth = buildTestAuth({ userId: "owner-1" });

describe("S2-2B 字幕样式消费", () => {
  it("提交路径 fixed：快照解析样式进入 subtitle artifact metadata", async () => {
    const app = buildApp();
    const { project } = await prepare(app);
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);
    setProjectSubtitle(app, project.id, {
      subtitle_style_preset_id: "subtitle_style_bold_stroke",
      subtitle_style_overrides: { font_size_px: 60 },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {
        execution_mode: "auto_available",
        idempotency_key: "subtitle-consumption-1",
      },
      auth,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { manifest: AssetManifest };
    const subtitleArtifact = body.manifest.artifacts.find(
      (a) => a.artifact_type === "subtitle_track",
    );
    expect(subtitleArtifact).toBeDefined();
    const meta = subtitleArtifact!.metadata as { subtitle_style?: SubtitleStyle };
    expect(meta.subtitle_style?.style_id).toBe("subtitle_style_bold_stroke");
    // 安全覆盖生效
    expect(meta.subtitle_style?.font_size_px).toBe(60);
    // preset 基础值保留
    expect(meta.subtitle_style?.stroke_width_px).toBe(5);
    // execution_options 投影（renderer 消费同一来源）
    const options = body.manifest.execution_options as { subtitle_style?: SubtitleStyle };
    expect(options.subtitle_style?.style_id).toBe("subtitle_style_bold_stroke");
  });

  it("提交路径 none：subtitle artifact 使用系统默认样式", async () => {
    const app = buildApp();
    const { project } = await prepare(app);
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {
        execution_mode: "auto_available",
        idempotency_key: "subtitle-consumption-none-1",
      },
      auth,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { manifest: AssetManifest };
    const subtitleArtifact = body.manifest.artifacts.find(
      (a) => a.artifact_type === "subtitle_track",
    );
    const meta = subtitleArtifact!.metadata as { subtitle_style?: SubtitleStyle };
    expect(meta.subtitle_style?.style_id).toBe(DEFAULT_SUBTITLE_STYLE.style_id);
  });

  it("provider 级：execution_options.subtitle_style 被 artifact metadata 消费（含非法值回退默认）", async () => {
    const provider = createLocalSubtitleProvider();
    // 自定义样式
    const custom: SubtitleStyle = {
      ...DEFAULT_SUBTITLE_STYLE,
      style_id: "subtitle_style_custom",
      font_size_px: 52,
      text_align: "left",
    };
    const manifest = {
      audio_summary: {
        tts_chunk_artifact_ids: [],
        tts_merged_artifact_id: null,
        voice_profile_id: "v",
      },
      artifacts: [],
      execution_options: { subtitle_style: custom },
    } as unknown as AssetManifest;
    const ctx = {
      manifest,
      assetPlan: makeAssetPlan({ storyboardRecordId: "s", scriptRecordId: "s", topicPackageId: "t" }),
      execution: { task_id: "subtitle_001" } as never,
      planTask: {} as never,
      assetManifestRecordId: "r",
      assetRunId: "run",
      projectStorageRootDir: mkdtempSync(join(tmpdir(), "subtitle-provider-")),
    } as never;
    tempDirs.push((ctx as { projectStorageRootDir: string }).projectStorageRootDir);
    const result = await provider.normalizeResult({ ctx });
    const artifact = result.artifacts.find((a) => a.artifact_type === "subtitle_track")!;
    const meta = artifact.metadata as { subtitle_style?: SubtitleStyle };
    expect(meta.subtitle_style?.style_id).toBe("subtitle_style_custom");
    expect(meta.subtitle_style?.font_size_px).toBe(52);
    expect(meta.subtitle_style?.text_align).toBe("left");

    // 非法值回退默认
    const badManifest = {
      ...manifest,
      execution_options: { subtitle_style: { style_id: "x" } },
    } as unknown as AssetManifest;
    const badResult = await provider.normalizeResult({
      ctx: { ...(ctx as object), manifest: badManifest },
    } as never);
    const badMeta = badResult.artifacts.find((a) => a.artifact_type === "subtitle_track")!
      .metadata as { subtitle_style?: SubtitleStyle };
    expect(badMeta.subtitle_style?.style_id).toBe(DEFAULT_SUBTITLE_STYLE.style_id);
  });
});
