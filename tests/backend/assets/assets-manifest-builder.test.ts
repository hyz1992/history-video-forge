import { describe, expect, it } from "vitest";

import type {
  AssetManifest,
  AssetPlan,
  AssetTask,
} from "../../../shared/src/index.js";
import { validateAssetsManifest } from "../../../backend/src/modules/assets/assets-local-validator.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSET_PLAN_ID = "ap_001";
const STORYBOARD_RECORD_ID = "storyboard_record_1";
const SCRIPT_RECORD_ID = "script_record_1";
const TOPIC_PACKAGE_ID = "topic_package_1";

// Segment IDs from the storyboard — these are NOT on the AssetPlan,
// they are passed separately as the builder needs them for TTS chunk alignment.
const SEGMENT_IDS = ["sb_001", "sb_002", "sb_003"];

// ─── Shared task helpers ──────────────────────────────────────────────────────

function makeManualUploadPolicy(overrides: {
  allowed?: boolean;
  required?: boolean;
} = {}) {
  return {
    allowed: overrides.allowed ?? false,
    required: overrides.required ?? false,
    accepted_file_types: [] as string[],
    acceptance_notes: [] as string[],
  };
}

function ttsTask(): AssetTask {
  return {
    task_id: "task_tts",
    order: 0,
    task_type: "tts_audio",
    source_segment_id: null,
    source_excerpt: "全片口播",
    production_intent: "生成全片 TTS",
    recommended_mode: "auto",
    provider_hint: "default_tts",
    prompt_draft: null,
    parameters: {},
    manual_upload_policy: makeManualUploadPolicy(),
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function subtitleTask(): AssetTask {
  return {
    task_id: "task_subtitle",
    order: 1,
    task_type: "subtitle_track",
    source_segment_id: null,
    source_excerpt: "全片字幕",
    production_intent: "生成字幕",
    recommended_mode: "auto",
    provider_hint: null,
    prompt_draft: null,
    parameters: {},
    manual_upload_policy: makeManualUploadPolicy(),
    risk_notes: [],
    cost_tier: "free",
    initial_status: "planned",
  };
}

function imageTask(segmentId: string): AssetTask {
  return {
    task_id: "task_img_1",
    order: 2,
    task_type: "image_still",
    source_segment_id: segmentId,
    source_excerpt: "画面描述",
    production_intent: "生成静态图",
    recommended_mode: "auto",
    provider_hint: "wanx",
    prompt_draft: "战国宫门前画面",
    parameters: {},
    manual_upload_policy: makeManualUploadPolicy(),
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function motionTask(segmentId: string): AssetTask {
  return {
    task_id: "task_motion_1",
    order: 3,
    task_type: "render_motion_cue",
    source_segment_id: segmentId,
    source_excerpt: "动效描述",
    production_intent: "生成运动指令",
    recommended_mode: "auto",
    provider_hint: null,
    prompt_draft: null,
    parameters: { recipe_type: "push_in" },
    manual_upload_policy: makeManualUploadPolicy(),
    risk_notes: [],
    cost_tier: "free",
    initial_status: "planned",
  };
}

function videoTask(segmentId: string): AssetTask {
  return {
    task_id: "task_video_opt",
    order: 4,
    task_type: "video_clip",
    source_segment_id: segmentId,
    source_excerpt: "视频片段",
    production_intent: "生成视频片段（可选）",
    recommended_mode: "manual_allowed",
    provider_hint: "video_provider",
    prompt_draft: "战国大殿全景",
    parameters: {},
    manual_upload_policy: makeManualUploadPolicy({ allowed: true, required: false }),
    risk_notes: [],
    cost_tier: "high",
    initial_status: "planned",
  };
}

function sfxTask(): AssetTask {
  return {
    task_id: "task_sfx",
    order: 5,
    task_type: "sfx_cue",
    source_segment_id: null,
    source_excerpt: "音效",
    production_intent: "音效提示",
    recommended_mode: "auto",
    provider_hint: null,
    prompt_draft: null,
    parameters: {},
    manual_upload_policy: makeManualUploadPolicy(),
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function bgmTask(): AssetTask {
  return {
    task_id: "task_bgm",
    order: 6,
    task_type: "bgm_cue",
    source_segment_id: null,
    source_excerpt: "背景音乐",
    production_intent: "选择/生成背景音乐",
    recommended_mode: "auto",
    provider_hint: null,
    prompt_draft: null,
    parameters: {},
    manual_upload_policy: makeManualUploadPolicy(),
    risk_notes: [],
    cost_tier: "medium",
    initial_status: "planned",
  };
}

// ─── Plan builders ────────────────────────────────────────────────────────────

function makeBaseAssetPlan(tasks: AssetTask[]): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: {
      era_style: "战国宫廷",
      visual_tone: "冷色压迫",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "古代中国历史短视频画面",
      global_negative_prompts: ["现代建筑"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 60,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "chunk_1", order: 0, script_excerpt: "第一段旁白", estimated_duration_sec: 20 },
        { chunk_id: "chunk_2", order: 1, script_excerpt: "第二段旁白", estimated_duration_sec: 20 },
        { chunk_id: "chunk_3", order: 2, script_excerpt: "第三段旁白", estimated_duration_sec: 20 },
      ],
    },
    tasks,
    dependencies: [],
    cost_summary: {
      total_tasks: tasks.length,
      by_type: {},
      by_cost_tier: {},
      estimated_provider_calls: tasks.length,
      notes: [],
    },
    global_production_notes: [],
  };
}

/** Full plan with tts + subtitle + image + motion + video + sfx + bgm */
function makeFullPlan(): AssetPlan {
  return makeBaseAssetPlan([
    ttsTask(),
    subtitleTask(),
    imageTask("sb_001"),
    motionTask("sb_001"),
    videoTask("sb_002"),
    sfxTask(),
    bgmTask(),
  ]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildInitialAssetManifest", () => {
  // ── 1. One execution per task ────────────────────────────────────────────────

  it("creates one AssetTaskExecution per plan task", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    expect(manifest.executions).toHaveLength(plan.tasks.length);

    const taskIds = manifest.executions.map((e) => e.task_id).sort();
    const planTaskIds = plan.tasks.map((t) => t.task_id).sort();
    expect(taskIds).toEqual(planTaskIds);
  });

  // ── 2. Motion recipe inline artifact ────────────────────────────────────────

  it("creates motion_recipe inline artifact for render_motion_cue tasks", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    const motionArtifacts = manifest.artifacts.filter(
      (a) => a.artifact_type === "motion_recipe",
    );
    expect(motionArtifacts).toHaveLength(1);

    const motionArtifact = motionArtifacts[0]!;
    expect(motionArtifact.origin).toBe("inline");
    expect(motionArtifact.file_uri).toContain("task_motion_1");
    expect(motionArtifact.metadata).toHaveProperty("recipe_type");
    expect(motionArtifact.metadata).toHaveProperty("parameters");

    // The motion execution should reference this artifact
    const motionExec = manifest.executions.find(
      (e) => e.task_type === "render_motion_cue",
    );
    expect(motionExec).toBeDefined();
    expect(motionExec!.output_artifact_ids).toContain(motionArtifact.artifact_id);
  });

  // ── 3. TTS chunk routes via order alignment ──────────────────────────────────

  it("records tts_chunk_routes using order alignment: chunks[i] maps to segmentIds[i]", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    const { tts_chunk_routes } = manifest.audio_summary;
    expect(tts_chunk_routes).toHaveLength(3);

    // chunk_1 -> sb_001, chunk_2 -> sb_002, chunk_3 -> sb_003
    expect(tts_chunk_routes[0]!.tts_chunk_id).toBe("chunk_1");
    expect(tts_chunk_routes[0]!.segment_ids).toEqual(["sb_001"]);
    expect(tts_chunk_routes[0]!.script_excerpt).toBe("第一段旁白");

    expect(tts_chunk_routes[1]!.tts_chunk_id).toBe("chunk_2");
    expect(tts_chunk_routes[1]!.segment_ids).toEqual(["sb_002"]);

    expect(tts_chunk_routes[2]!.tts_chunk_id).toBe("chunk_3");
    expect(tts_chunk_routes[2]!.segment_ids).toEqual(["sb_003"]);
  });

  // ── 4. TTS chunk metadata with segment_ids ───────────────────────────────────

  it("records tts_chunk_audio.metadata.segment_ids when TTS chunk artifacts exist", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    // The builder should create placeholder TTS chunk artifacts for each chunk
    const ttsArtifacts = manifest.artifacts.filter(
      (a) => a.artifact_type === "tts_chunk_audio",
    );
    expect(ttsArtifacts).toHaveLength(3);

    // Each TTS chunk artifact should have segment_ids in metadata
    for (const artifact of ttsArtifacts) {
      expect(artifact.metadata).toHaveProperty("segment_ids");
      expect(artifact.metadata).toHaveProperty("tts_chunk_id");
      expect(artifact.metadata).toHaveProperty("script_excerpt");
      expect(artifact.metadata).toHaveProperty("voice_profile_id");
    }

    // Verify alignment: first artifact should map to sb_001
    const firstTts = ttsArtifacts.find(
      (a) => a.metadata.tts_chunk_id === "chunk_1",
    );
    expect(firstTts).toBeDefined();
    expect(firstTts!.metadata.segment_ids).toEqual(["sb_001"]);
  });

  // ── 5. Blocked routes when chunk count != segment count ──────────────────────

  it("marks routes blocked instead of guessing when TTS chunk count and segment count differ", () => {
    // Use segment IDs longer than chunks to create a mismatch
    const plan = makeBaseAssetPlan([ttsTask()]);
    // Plan has 3 chunks, but we pass 5 segment IDs
    const mismatchedSegmentIds = ["sb_001", "sb_002", "sb_003", "sb_004", "sb_005"];

    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: mismatchedSegmentIds,
    });

    // Routes should exist for all segments but be marked as blocked
    // because TTS chunk alignment is uncertain
    const blockedRoutes = manifest.segment_routes.filter(
      (r) => r.readiness === "blocked",
    );
    // At minimum, segments beyond the chunk count should be blocked
    expect(blockedRoutes.length).toBeGreaterThan(0);
  });

  // ── 6. Segment route image_with_motion ──────────────────────────────────────

  it("creates segment route image_with_motion when image + motion exist for same segment", () => {
    const plan = makeBaseAssetPlan([
      imageTask("sb_001"),
      motionTask("sb_001"),
    ]);
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: ["sb_001"],
    });

    const route = manifest.segment_routes.find((r) => r.segment_id === "sb_001");
    expect(route).toBeDefined();
    expect(route!.visual_route_type).toBe("image_with_motion");
    // Motion artifact should be linked
    expect(route!.motion_artifact_id).toBeTruthy();
  });

  // ── 7. Manual upload policy ─────────────────────────────────────────────────

  it("marks provider-dependent tasks as planned or waiting_manual_upload according to manual_upload_policy.required", () => {
    // Create a task that requires manual upload
    const manualImageTask: AssetTask = {
      task_id: "task_manual_img",
      order: 0,
      task_type: "image_still",
      source_segment_id: "sb_001",
      source_excerpt: "需要手上传",
      production_intent: "手动上传图片",
      recommended_mode: "manual_preferred",
      provider_hint: null,
      prompt_draft: "用户自选图",
      parameters: {},
      manual_upload_policy: makeManualUploadPolicy({ allowed: true, required: true }),
      risk_notes: [],
      cost_tier: "free",
      initial_status: "planned",
    };

    const plan = makeBaseAssetPlan([manualImageTask]);
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: ["sb_001"],
    });

    const manualExec = manifest.executions.find(
      (e) => e.task_id === "task_manual_img",
    );
    expect(manualExec).toBeDefined();
    expect(manualExec!.status).toBe("waiting_manual_upload");

    // Also verify the auto task stays planned
    const autoPlan = makeBaseAssetPlan([imageTask("sb_001")]);
    const autoManifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: autoPlan,
      segmentIds: ["sb_001"],
    });
    const autoExec = autoManifest.executions.find(
      (e) => e.task_id === "task_img_1",
    );
    expect(autoExec!.status).toBe("planned");
  });

  // ── 8. BgmPlacement from bgm_cue tasks ──────────────────────────────────────

  it("creates BgmPlacement from bgm_cue tasks", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    expect(manifest.audio_summary.bgm_placements.length).toBeGreaterThan(0);

    const bgmPlacement = manifest.audio_summary.bgm_placements[0]!;
    expect(bgmPlacement.scope).toBe("global");
    expect(bgmPlacement.artifact_id).toBeNull(); // no audio file yet
    expect(bgmPlacement.start_policy).toBe("timeline_start");
    expect(bgmPlacement.end_policy).toBe("timeline_end");
    expect(typeof bgmPlacement.volume).toBe("number");
  });

  // ── 9. Readiness blocked when artifacts incomplete ───────────────────────────

  it("sets readiness blocked when TTS/subtitle/image artifacts are not complete", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    // The initial manifest should not be ready_for_compose
    expect(manifest.readiness).not.toBe("ready_for_compose");
    // It should be blocked or partial since no real artifacts exist
    expect(["blocked", "partial"]).toContain(manifest.readiness);

    // Segment routes should reflect incomplete state
    for (const route of manifest.segment_routes) {
      // At initial build, most routes should be blocked since we have no real images/videos
      expect(route.readiness).not.toBe("ready");
    }
  });

  // ── 10. Validate with validator ─────────────────────────────────────────────

  it("validates the builder output with validateAssetsManifest and expects decision blocked or partial", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    const result = validateAssetsManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      topicPackageId: TOPIC_PACKAGE_ID,
      assetPlan: plan,
      manifest,
    });

    // Should not fail with a schema validation error (that would throw).
    // Decision should be blocked or partial, not a runtime crash.
    expect(["blocked", "partial"]).toContain(result.decision);
    expect(result.stage).toBe("assets_local_validation");
  });

  it("uses caller-provided execution options instead of hard-coded defaults", () => {
    const plan = makeBaseAssetPlan([imageTask("sb_001")]);
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
      executionOptions: {
        execution_mode: "dry_run",
        voice_profile_id: "voice_custom",
        enabled_provider_types: ["image"],
        allow_manual_placeholders: true,
      },
    });

    expect(manifest.execution_options).toEqual({
      execution_mode: "dry_run",
      voice_profile_id: "voice_custom",
      enabled_provider_types: ["image"],
      allow_manual_placeholders: true,
    });
  });

  // ── 11. Manifest structure ──────────────────────────────────────────────────

  it("produces a manifest with correct source IDs and version", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    expect(manifest.manifest_version).toBe("asset_manifest_v1");
    expect(manifest.source_asset_plan_id).toBe(ASSET_PLAN_ID);
    expect(manifest.source_storyboard_record_id).toBe(STORYBOARD_RECORD_ID);
    expect(manifest.source_script_record_id).toBe(SCRIPT_RECORD_ID);
  });

  // ── 12. Audio summary structure ─────────────────────────────────────────────

  it("builds audio_summary from tts_plan, sfx_cue, bgm_cue, and global_audio_strategy", () => {
    const plan = makeFullPlan();
    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });

    const { audio_summary } = manifest;
    expect(audio_summary.voice_profile_id).toBe("voice_001");
    expect(audio_summary.tts_chunk_routes).toHaveLength(3);
    expect(audio_summary.bgm_placements.length).toBeGreaterThan(0);
    expect(audio_summary.sfx_artifact_ids).toEqual([]); // no real SFX artifacts yet
    expect(audio_summary.tts_merged_artifact_id).toBeNull(); // not merged yet
    expect(audio_summary.subtitle_artifact_id).toBeNull(); // no subtitle artifact yet
  });
});
