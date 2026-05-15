import { describe, expect, it } from "vitest";

import type {
  AssetArtifact,
  AssetManifest,
  AssetPlan,
  AssetTaskExecution,
  SegmentAssetRoute,
} from "../../../shared/src/index.js";
import { validateAssetsManifest } from "../../../backend/src/modules/assets/assets-local-validator.js";

// ─── Test fixture helpers ────────────────────────────────────────────────────

const ASSET_PLAN_ID = "ap_001";
const STORYBOARD_RECORD_ID = "storyboard_record_1";
const SCRIPT_RECORD_ID = "script_record_1";
const TOPIC_PACKAGE_ID = "topic_package_1";

function makeBaseAssetPlan(overrides: Partial<AssetPlan> = {}): AssetPlan {
  const base: AssetPlan = {
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
      estimated_total_duration_sec: 70,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "chunk_1", order: 0, script_excerpt: "第一段", estimated_duration_sec: 20 },
        { chunk_id: "chunk_2", order: 1, script_excerpt: "第二段", estimated_duration_sec: 30 },
      ],
    },
    tasks: [
      {
        task_id: "task_tts_1",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "全片口播",
        production_intent: "生成全片 TTS",
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
        task_id: "task_img_1",
        order: 1,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "画面描述",
        production_intent: "生成分镜1的静态图",
        recommended_mode: "auto",
        provider_hint: "wanx",
        prompt_draft: "战国宫门前画面",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: ["保持战国质感"],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "task_video_1",
        order: 2,
        task_type: "video_clip",
        source_segment_id: "sb_002",
        source_excerpt: "视频画面描述",
        production_intent: "生成分镜2的视频片段",
        recommended_mode: "auto",
        provider_hint: "video_provider",
        prompt_draft: "战国大殿对峙",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: ["避免夸张表现"],
        cost_tier: "high",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 3,
      by_type: { tts_audio: 1, image_still: 1, video_clip: 1 },
      by_cost_tier: { low: 2, high: 1 },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: [],
  };
  return { ...base, ...overrides };
}

function makeBaseExecution(overrides: Partial<AssetTaskExecution> = {}): AssetTaskExecution {
  return {
    execution_id: "exec_1",
    task_id: "task_tts_1",
    task_type: "tts_audio",
    status: "completed",
    origin: "provider",
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:10Z",
    provider_id: "provider_1",
    attempts: 1,
    output_artifact_ids: ["artifact_tts_1"],
    notes: [],
    ...overrides,
  };
}

function makeBaseArtifact(overrides: Partial<AssetArtifact> = {}): AssetArtifact {
  return {
    artifact_id: "artifact_tts_1",
    artifact_type: "tts_chunk_audio",
    origin: "provider",
    file_uri: "file:///audio/chunk1.wav",
    created_at: "2026-01-01T00:00:10Z",
    metadata: {
      duration_sec: 20,
      voice_profile_id: "voice_001",
      tts_chunk_id: "chunk_1",
      segment_ids: ["sb_001"],
      script_excerpt: "第一段",
    },
    ...overrides,
  } as AssetArtifact;
}

function makeImageArtifact(id: string): AssetArtifact {
  return {
    artifact_id: id,
    artifact_type: "image",
    origin: "provider",
    file_uri: `file:///images/${id}.png`,
    created_at: "2026-01-01T00:01:00Z",
    metadata: {
      width: 1024,
      height: 1792,
    },
  };
}

function makeVideoArtifact(id: string): AssetArtifact {
  return {
    artifact_id: id,
    artifact_type: "video",
    origin: "provider",
    file_uri: `file:///videos/${id}.mp4`,
    created_at: "2026-01-01T00:02:00Z",
    metadata: {
      duration_sec: 5,
      width: 1024,
      height: 1792,
      fps: 24,
    },
  };
}

function makeMotionArtifact(id: string, sourceImageId: string): AssetArtifact {
  return {
    artifact_id: id,
    artifact_type: "motion_recipe",
    origin: "provider",
    file_uri: `file:///motion/${id}.json`,
    created_at: "2026-01-01T00:02:00Z",
    metadata: {
      recipe_type: "push_in",
      source_image_artifact_id: sourceImageId,
      parameters: {},
    },
  };
}

function makeBgmArtifact(id: string): AssetArtifact {
  return {
    artifact_id: id,
    artifact_type: "bgm_audio",
    origin: "provider",
    file_uri: `file:///bgm/${id}.mp3`,
    created_at: "2026-01-01T00:03:00Z",
    metadata: {
      duration_sec: 60,
      loopable: true,
    },
  };
}

function makeBaseSegmentRoute(overrides: Partial<SegmentAssetRoute> = {}): SegmentAssetRoute {
  return {
    segment_id: "sb_001",
    tts_artifact_id: "artifact_tts_1",
    subtitle_artifact_id: null,
    primary_visual_artifact_id: "artifact_img_1",
    visual_route_type: "image_only",
    motion_artifact_id: null,
    fallback_visual_artifact_id: null,
    sfx_artifact_ids: [],
    bgm_placement_ids: [],
    readiness: "ready",
    notes: [],
    ...overrides,
  };
}

function makeBaseManifest(overrides: Partial<AssetManifest> = {}): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: ASSET_PLAN_ID,
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["tts", "image", "video"],
      allow_manual_placeholders: false,
    },
    executions: [
      makeBaseExecution(),
      makeBaseExecution({
        execution_id: "exec_img_1",
        task_id: "task_img_1",
        task_type: "image_still",
        output_artifact_ids: ["artifact_img_1"],
      }),
      makeBaseExecution({
        execution_id: "exec_video_1",
        task_id: "task_video_1",
        task_type: "video_clip",
        output_artifact_ids: ["artifact_video_1"],
      }),
    ],
    artifacts: [
      makeBaseArtifact(),
      makeImageArtifact("artifact_img_1"),
      makeVideoArtifact("artifact_video_1"),
    ],
    audio_summary: {
      voice_profile_id: "voice_001",
      tts_total_duration_sec: 50,
      tts_chunk_artifact_ids: ["artifact_tts_1"],
      tts_chunk_routes: [
        {
          tts_chunk_id: "chunk_1",
          artifact_id: "artifact_tts_1",
          segment_ids: ["sb_001"],
          script_excerpt: "第一段",
        },
      ],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      makeBaseSegmentRoute(),
      makeBaseSegmentRoute({
        segment_id: "sb_002",
        primary_visual_artifact_id: "artifact_video_1",
        visual_route_type: "video_clip",
      }),
    ],
    readiness: "ready_for_compose",
    notes: [],
    ...overrides,
  };
}

function runValidation(
  manifestOverrides: Partial<AssetManifest> = {},
  planOverrides: Partial<AssetPlan> = {},
) {
  const manifest = makeBaseManifest(manifestOverrides);
  const plan = makeBaseAssetPlan(planOverrides);
  return validateAssetsManifest({
    assetPlanRecordId: ASSET_PLAN_ID,
    storyboardRecordId: STORYBOARD_RECORD_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    topicPackageId: TOPIC_PACKAGE_ID,
    assetPlan: plan,
    manifest,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("validateAssetsManifest", () => {
  // ── Passing case ──────────────────────────────────────────────────────────

  it("passes a structurally valid manifest", () => {
    const bgmArtifact = makeBgmArtifact("artifact_bgm_1");
    const result = runValidation({
      artifacts: [
        makeBaseArtifact(),
        makeImageArtifact("artifact_img_1"),
        makeVideoArtifact("artifact_video_1"),
        bgmArtifact,
      ],
      audio_summary: {
        voice_profile_id: "voice_001",
        tts_total_duration_sec: 50,
        tts_chunk_artifact_ids: ["artifact_tts_1"],
        tts_chunk_routes: [
          {
            tts_chunk_id: "chunk_1",
            artifact_id: "artifact_tts_1",
            segment_ids: ["sb_001"],
            script_excerpt: "第一段",
          },
        ],
        tts_merged_artifact_id: null,
        subtitle_artifact_id: null,
        bgm_placements: [
          {
            bgm_placement_id: "bgm_place_1",
            scope: "global",
            artifact_id: "artifact_bgm_1",
            start_policy: "timeline_start",
            end_policy: "timeline_end",
            segment_ids: [],
            volume: 0.3,
            fade_in_sec: 0,
            fade_out_sec: 0,
          },
        ],
        sfx_artifact_ids: [],
      },
    });

    expect(result.decision).toBe("ready_for_compose");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.stage).toBe("assets_local_validation");
    expect(result.metrics).toMatchObject({
      task_count: 3,
      execution_count: 3,
      artifact_count: 4,
      segment_route_count: 2,
    });
  });

  // ── Source ID mismatches ──────────────────────────────────────────────────

  it("reports assets_source_asset_plan_mismatch when plan id does not match", () => {
    const result = runValidation({ source_asset_plan_id: "wrong_plan_id" });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("assets_source_asset_plan_mismatch");
  });

  it("reports assets_source_storyboard_mismatch when storyboard id does not match", () => {
    const result = runValidation({ source_storyboard_record_id: "wrong_sb_id" });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("assets_source_storyboard_mismatch");
  });

  it("reports assets_source_script_mismatch when script id does not match", () => {
    const result = runValidation({ source_script_record_id: "wrong_script_id" });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("assets_source_script_mismatch");
  });

  it("reports assets_source_topic_mismatch when topic id does not match", () => {
    const result = runValidation({}, { source_topic_package_id: "wrong_topic_id" });

    expect(result.decision).toBe("blocked");
    expect(result.errors).toContain("assets_source_topic_mismatch");
  });

  // ── Missing execution for a task ──────────────────────────────────────────

  it("reports assets_task_execution_missing when a plan task has no execution", () => {
    // Add a task to the plan that has no corresponding execution
    const plan = makeBaseAssetPlan();
    plan.tasks.push({
      task_id: "task_orphan",
      order: 3,
      task_type: "sfx_cue",
      source_segment_id: "sb_001",
      source_excerpt: "音效",
      production_intent: "测试",
      recommended_mode: "auto",
      provider_hint: null,
      prompt_draft: null,
      parameters: {},
      manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
      risk_notes: [],
      cost_tier: "low",
      initial_status: "planned",
    });

    const manifest = makeBaseManifest();
    const result = validateAssetsManifest({
      assetPlanRecordId: ASSET_PLAN_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      topicPackageId: TOPIC_PACKAGE_ID,
      assetPlan: plan,
      manifest,
    });

    expect(result.errors).toContain("assets_task_execution_missing");
    expect(result.decision).toBe("blocked");
  });

  // ── Dangling selected artifact ────────────────────────────────────────────

  it("reports assets_selected_artifact_missing when an artifact_id in execution does not exist in artifacts", () => {
    const result = runValidation({
      executions: [
        makeBaseExecution(),
        makeBaseExecution({
          execution_id: "exec_img_1",
          task_id: "task_img_1",
          task_type: "image_still",
          output_artifact_ids: ["artifact_img_1", "artifact_ghost"],
        }),
        makeBaseExecution({
          execution_id: "exec_video_1",
          task_id: "task_video_1",
          task_type: "video_clip",
          output_artifact_ids: ["artifact_video_1"],
        }),
      ],
    });

    expect(result.errors).toContain("assets_selected_artifact_missing");
    expect(result.decision).toBe("blocked");
  });

  // ── Missing segment route ─────────────────────────────────────────────────

  it("reports assets_segment_route_missing when a visual task's segment has no route", () => {
    // Plan has tasks for sb_001 and sb_002, but manifest only has a route for sb_001
    const result = runValidation({
      segment_routes: [
        makeBaseSegmentRoute(), // only sb_001
      ],
    });

    expect(result.errors).toContain("assets_segment_route_missing");
    expect(result.decision).toBe("blocked");
  });

  // ── Segment route missing visual ──────────────────────────────────────────

  it("reports assets_segment_visual_missing when route has missing visual but visual_route_type is not 'missing'", () => {
    const result = runValidation({
      segment_routes: [
        makeBaseSegmentRoute({
          primary_visual_artifact_id: null,
          visual_route_type: "image_only", // claims image but no artifact
        }),
        makeBaseSegmentRoute({
          segment_id: "sb_002",
          primary_visual_artifact_id: "artifact_video_1",
          visual_route_type: "video_clip",
        }),
      ],
    });

    expect(result.errors).toContain("assets_segment_visual_missing");
    expect(result.decision).toBe("blocked");
  });

  // ── Video fallback: image+motion is acceptable with warning ───────────────

  it("allows video task with image+motion fallback but warns assets_video_fallback_used", () => {
    // video task execution has no video artifact, but uses image + motion
    const motionArtifact = makeMotionArtifact("artifact_motion_1", "artifact_img_1");

    const result = runValidation({
      executions: [
        makeBaseExecution(),
        makeBaseExecution({
          execution_id: "exec_img_1",
          task_id: "task_img_1",
          task_type: "image_still",
          output_artifact_ids: ["artifact_img_1"],
        }),
        makeBaseExecution({
          execution_id: "exec_video_1",
          task_id: "task_video_1",
          task_type: "video_clip",
          output_artifact_ids: [], // no video artifact produced
        }),
      ],
      artifacts: [
        makeBaseArtifact(),
        makeImageArtifact("artifact_img_1"),
        motionArtifact,
      ],
      segment_routes: [
        makeBaseSegmentRoute(),
        makeBaseSegmentRoute({
          segment_id: "sb_002",
          primary_visual_artifact_id: "artifact_img_1",
          visual_route_type: "image_with_motion",
          motion_artifact_id: "artifact_motion_1",
          readiness: "fallback_ready",
        }),
      ],
    });

    expect(result.errors).not.toContain("assets_segment_visual_missing");
    expect(result.warnings).toContain("assets_video_fallback_used");
    expect(result.decision).toBe("partial");
  });

  // ── Missing optional BGM is a warning, not an error ───────────────────────

  it("warns assets_bgm_missing_optional when no BGM placements exist", () => {
    const result = runValidation();

    // base manifest has no BGM placements
    expect(result.warnings).toContain("assets_bgm_missing_optional");
    expect(result.decision).toBe("partial");
  });

  it("does not warn about BGM when bgm_placements exist", () => {
    const bgmArtifact = makeBgmArtifact("artifact_bgm_1");
    const result = runValidation({
      artifacts: [
        makeBaseArtifact(),
        makeImageArtifact("artifact_img_1"),
        makeVideoArtifact("artifact_video_1"),
        bgmArtifact,
      ],
      audio_summary: {
        voice_profile_id: "voice_001",
        tts_total_duration_sec: 50,
        tts_chunk_artifact_ids: ["artifact_tts_1"],
        tts_chunk_routes: [
          {
            tts_chunk_id: "chunk_1",
            artifact_id: "artifact_tts_1",
            segment_ids: ["sb_001"],
            script_excerpt: "第一段",
          },
        ],
        tts_merged_artifact_id: null,
        subtitle_artifact_id: null,
        bgm_placements: [
          {
            bgm_placement_id: "bgm_place_1",
            scope: "global",
            artifact_id: "artifact_bgm_1",
            start_policy: "timeline_start",
            end_policy: "timeline_end",
            segment_ids: [],
            volume: 0.3,
            fade_in_sec: 0,
            fade_out_sec: 0,
          },
        ],
        sfx_artifact_ids: [],
      },
    });

    expect(result.warnings).not.toContain("assets_bgm_missing_optional");
    expect(result.decision).toBe("ready_for_compose");
  });

  // ── Decision logic ────────────────────────────────────────────────────────

  it("returns blocked when any error exists", () => {
    const result = runValidation({ source_asset_plan_id: "wrong" });

    expect(result.decision).toBe("blocked");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns partial when only warnings exist", () => {
    // Base manifest has no BGM = warning only
    const result = runValidation();

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("assets_bgm_missing_optional");
    expect(result.decision).toBe("partial");
  });

  it("returns ready_for_compose when no errors and no warnings", () => {
    const bgmArtifact = makeBgmArtifact("artifact_bgm_1");
    const result = runValidation({
      artifacts: [
        makeBaseArtifact(),
        makeImageArtifact("artifact_img_1"),
        makeVideoArtifact("artifact_video_1"),
        bgmArtifact,
      ],
      audio_summary: {
        voice_profile_id: "voice_001",
        tts_total_duration_sec: 50,
        tts_chunk_artifact_ids: ["artifact_tts_1"],
        tts_chunk_routes: [
          {
            tts_chunk_id: "chunk_1",
            artifact_id: "artifact_tts_1",
            segment_ids: ["sb_001"],
            script_excerpt: "第一段",
          },
        ],
        tts_merged_artifact_id: null,
        subtitle_artifact_id: null,
        bgm_placements: [
          {
            bgm_placement_id: "bgm_place_1",
            scope: "global",
            artifact_id: "artifact_bgm_1",
            start_policy: "timeline_start",
            end_policy: "timeline_end",
            segment_ids: [],
            volume: 0.3,
            fade_in_sec: 0,
            fade_out_sec: 0,
          },
        ],
        sfx_artifact_ids: [],
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.decision).toBe("ready_for_compose");
  });

  // ── Segment route visual_route_type=missing does not error ────────────────

  it("does not report visual missing when route explicitly has visual_route_type 'missing'", () => {
    const result = runValidation({
      segment_routes: [
        makeBaseSegmentRoute(),
        makeBaseSegmentRoute({
          segment_id: "sb_002",
          primary_visual_artifact_id: null,
          visual_route_type: "missing",
          readiness: "blocked",
        }),
      ],
    });

    expect(result.errors).not.toContain("assets_segment_visual_missing");
  });

  // ── Multiple errors are all reported ──────────────────────────────────────

  it("reports multiple source mismatches at once", () => {
    const result = runValidation(
      { source_asset_plan_id: "wrong_plan", source_storyboard_record_id: "wrong_sb" },
      { source_topic_package_id: "wrong_topic" },
    );

    expect(result.errors).toContain("assets_source_asset_plan_mismatch");
    expect(result.errors).toContain("assets_source_storyboard_mismatch");
    expect(result.errors).toContain("assets_source_topic_mismatch");
    expect(result.decision).toBe("blocked");
  });
});
