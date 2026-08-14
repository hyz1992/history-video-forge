import { describe, expect, it } from "vitest";

import {
  AssetPlan,
  type AssetPlan as AssetPlanType,
  type ResolvedSegmentVisualRoute,
  type StoryboardPlan,
} from "../../../shared/src/index.js";
import {
  AssetPlanCompilerInvariantError,
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
  type CompiledIntentChunkInput,
  type GlobalPlanningCompilerDraft,
  type LocalAudioSkeleton,
} from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator.js";
import { buildSegmentIntentPlannerInput } from "../../../backend/src/modules/asset-planning/segment-intent-prompt-input.js";
import { inspectSegmentIntentBatch } from "../../../backend/src/modules/asset-planning/segment-asset-intent.js";

/**
 * S2-2A 任务 5：Asset Planning 只消费 resolved route。
 *
 * - API route 段必须规划 image_still 锚点、video_clip、render_motion_cue 与静态 fallback 引用。
 * - Remotion route 段必须规划 image_still + render_motion_cue，不得规划 video_clip。
 * - all_remotion 计划中 provider video call 数为零。
 * - Asset Planning prompt 不再收到或解释 visual_strategy_preference，只收到 resolved route。
 * - compiler trace 写入 route reason，不在本地重新做语义判断。
 */

function makeStoryboard(
  routes: Array<{ segment_id: string; resolved_route: "api_video" | "remotion" }>,
): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: "script_record",
    source_topic_package_id: "topic_package",
    estimated_total_duration_sec: routes.length * 5,
    segments: routes.map((route, index) => ({
      segment_id: route.segment_id,
      order: index,
      script_excerpt: `第${index + 1}段口播。`,
      start_hint_sec: index * 5,
      end_hint_sec: (index + 1) * 5,
      narrative_role: index === 0 ? "opening" : index === routes.length - 1 ? "ending" : "setup",
      visual_intent: `第${index + 1}段视觉意图`,
      scene_description: `第${index + 1}段场景，人物甲在古代庭院。`,
      visual_elements: ["人物甲", "古代庭院"],
      framing_hint: "medium",
      content_type: "live_action",
      motion_hint: (["static", "push_in", "pull_back", "pan"] as const)[index % 4]!,
      editing_hint: "single",
      on_screen_text: [],
      linked_beats: [],
      linked_quotes: [],
      risk_notes: [],
      api_video_suitability:
        route.resolved_route === "api_video"
          ? "api_video_strongly_recommended"
          : "remotion_sufficient",
    })),
    global_visual_notes: [],
  };
}

function makeRoutes(
  storyboard: StoryboardPlan,
  reasonBySegment: Record<string, string> = {},
): Map<string, ResolvedSegmentVisualRoute> {
  return new Map(
    storyboard.segments.map((segment) => [
      segment.segment_id,
      {
        segment_id: segment.segment_id,
        api_video_suitability: segment.api_video_suitability,
        resolved_route:
          segment.api_video_suitability === "api_video_strongly_recommended" ||
          segment.api_video_suitability === "api_video_beneficial"
            ? "api_video"
            : "remotion",
        reason_code: reasonBySegment[segment.segment_id] ?? "test_route",
      },
    ]),
  );
}

function image(role: "anchor" | "support" = "anchor") {
  return {
    asset_kind: "image_still" as const,
    production_intent: "建立本段主视觉",
    image_prompt: "历史写实画面",
    video_prompt_reserve: "镜头缓慢推进",
    image_role: role,
    support_reason: role === "support" ? "补充细节" : null,
    risk_notes: ["避免现代物件"],
  };
}

function video() {
  return {
    asset_kind: "video_clip" as const,
    production_intent: "表现连续动作",
    video_prompt: "人物完成不可逆动作",
    why_static_insufficient: "连续动作推动叙事",
    risk_notes: ["复核动作连续性"],
  };
}

function motion() {
  return {
    asset_kind: "render_motion_cue" as const,
    production_intent: "以本地运镜增强节奏",
    risk_notes: ["复核运镜幅度"],
  };
}

function makeAudio(storyboard: StoryboardPlan): LocalAudioSkeleton {
  const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
  const ttsTask: AssetPlanType["tasks"][number] = {
    task_id: "tts_001", order: 0, task_type: "tts_audio", source_segment_id: null,
    source_excerpt: scriptText, production_intent: "生成全片口播音频", recommended_mode: "auto",
    provider_hint: "default_tts", prompt_draft: null,
    parameters: { voice_profile_id: "voice_default_male_storyteller", chunk_ids: storyboard.segments.map((_, index) => `tts_${String(index + 1).padStart(3, "0")}`) },
    manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
    risk_notes: [], cost_tier: "low", initial_status: "planned",
  };
  const subtitleTask: AssetPlanType["tasks"][number] = {
    task_id: "subtitle_001", order: 1, task_type: "subtitle_track", source_segment_id: null,
    source_excerpt: scriptText, production_intent: "根据 TTS 时间戳生成字幕轨", recommended_mode: "auto",
    provider_hint: null, prompt_draft: null, parameters: { format: "srt", source_tts_task_id: "tts_001" },
    manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
    risk_notes: [], cost_tier: "free", initial_status: "planned",
  };
  return {
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: storyboard.estimated_total_duration_sec,
      chunking_strategy: "segment_boundary",
      chunks: storyboard.segments.map((segment, index) => ({
        chunk_id: `tts_${String(index + 1).padStart(3, "0")}`, order: index,
        script_excerpt: segment.script_excerpt, estimated_duration_sec: 5,
      })),
    },
    tasks: [ttsTask, subtitleTask],
    dependencies: [{ dependency_id: "dep_subtitle_001_after_tts_001", task_id: "subtitle_001", depends_on_task_id: "tts_001", dependency_type: "requires_timing" }],
  };
}

function makeGlobal(): GlobalPlanningCompilerDraft {
  return {
    art_bible: {
      era_style: "战国", visual_tone: "克制写实",
      characters: [{ character_id: "char_1", label: "人物甲", role: "主角", visual_description: "束发深衣", consistency_notes: ["服饰统一"] }],
      locations: [], props: [], global_prompt_prefix: "历史写实", global_negative_prompts: ["现代物品"], consistency_notes: ["统一画风"],
    },
    visual_budget: { mode: "balanced" }, downgrade_policy: { video_to_image: true },
    global_audio_strategy: { voice_intent: { content_family: "历史叙事", narrator_persona: "沉稳讲述者", desired_traits: ["克制"], avoid_traits: ["夸张"], pace: "medium", style_notes: ["清晰"] } },
    manual_review_notes: ["人工复核史实"],
  };
}

function intentsForRoute(route: "api_video" | "remotion", segmentOrder: number) {
  return [
    image(),
    ...(route === "api_video" ? [video(), motion()] : [motion()]),
    ...(segmentOrder === 0
      ? [{
          asset_kind: "bgm_cue" as const, production_intent: "建立全片底乐",
          required_tags: ["弦乐"], mood_tags: ["悬疑"], selection_label: null,
          timing_basis: "tts" as const, scope: "global" as const, segment_ids: [],
          volume: 0.3, fade_in_sec: 1, fade_out_sec: 2, risk_notes: [],
        }]
      : []),
  ];
}

function makeChunks(storyboard: StoryboardPlan): CompiledIntentChunkInput[] {
  return storyboard.segments.map((segment, index) => {
    const route = makeRoutes(storyboard).get(segment.segment_id)!.resolved_route;
    return {
      chunkIndex: index,
      inputSegmentIds: [segment.segment_id],
      draft: {
        planning_mode: "segment_intent_batch",
        segments: [{
          source_segment_id: segment.segment_id,
          intents: intentsForRoute(route, index),
        }],
        budget_notes: [`segment:${segment.segment_id}`],
      },
    };
  });
}

function makeCompilerInput(
  routes: Array<{ segment_id: string; resolved_route: "api_video" | "remotion" }>,
): AssetPlanCompilerInput {
  const storyboard = makeStoryboard(routes);
  const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
  return {
    sourceIds: { storyboardRecordId: "storyboard_record", scriptRecordId: "script_record", topicPackageId: "topic_package" },
    storyboard,
    draft: { script_text: scriptText, estimated_duration_sec: storyboard.estimated_total_duration_sec, beat_trace: [], quote_trace: [], opening_span: storyboard.segments[0]!.script_excerpt, ending_span: storyboard.segments.at(-1)!.script_excerpt },
    globalDraft: makeGlobal(),
    audioSkeleton: makeAudio(storyboard),
    chunks: makeChunks(storyboard),
    segmentVisualRoutes: makeRoutes(storyboard),
  };
}

function expectCompilerFailure(input: AssetPlanCompilerInput, issueCode: string) {
  try {
    compileAssetPlanFromIntents(input);
    throw new Error("expected compiler failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AssetPlanCompilerInvariantError);
    expect(error).toMatchObject({
      code: "asset_plan_compiler_invariant_failed",
      issues: expect.arrayContaining([expect.objectContaining({ code: issueCode })]),
    });
  }
}

describe("resolved visual route compilation", () => {
  it("compiles API route segments to anchor + video_clip + render_motion_cue with static fallback", () => {
    const compiled = compileAssetPlanFromIntents(
      makeCompilerInput([
        { segment_id: "seg_001", resolved_route: "api_video" },
        { segment_id: "seg_002", resolved_route: "remotion" },
      ]),
    );
    const plan = AssetPlan.parse(compiled.plan);

    const seg1Tasks = plan.tasks.filter((task) => task.source_segment_id === "seg_001");
    const anchor = seg1Tasks.find(
      (task) => task.task_type === "image_still" && task.parameters.image_role === "anchor",
    )!;
    const videoTask = seg1Tasks.find((task) => task.task_type === "video_clip")!;
    const motionTask = seg1Tasks.find((task) => task.task_type === "render_motion_cue")!;
    expect(anchor).toBeDefined();
    expect(videoTask.parameters).toMatchObject({
      static_fallback_task_id: anchor.task_id,
      why_static_insufficient: expect.any(String),
    });
    expect(motionTask.parameters).toMatchObject({
      recipe_type: expect.any(String),
      source_image_task_id: anchor.task_id,
    });
    expect(plan.dependencies).toContainEqual({
      dependency_id: `dep_${videoTask.task_id}_after_${anchor.task_id}_requires_output`,
      task_id: videoTask.task_id,
      depends_on_task_id: anchor.task_id,
      dependency_type: "requires_output",
    });
    expect(plan.dependencies).toContainEqual({
      dependency_id: `dep_${motionTask.task_id}_after_${anchor.task_id}_requires_output`,
      task_id: motionTask.task_id,
      depends_on_task_id: anchor.task_id,
      dependency_type: "requires_output",
    });
  });

  it("compiles Remotion route segments to anchor + render_motion_cue and never video_clip", () => {
    const compiled = compileAssetPlanFromIntents(
      makeCompilerInput([
        { segment_id: "seg_001", resolved_route: "remotion" },
        { segment_id: "seg_002", resolved_route: "remotion" },
      ]),
    );
    const plan = AssetPlan.parse(compiled.plan);
    expect(plan.tasks.filter((task) => task.task_type === "video_clip")).toHaveLength(0);
    for (const segment of plan.tasks.filter((task) => task.source_segment_id !== null)) {
      expect(segment.task_type).not.toBe("video_clip");
    }
    expect(plan.tasks.filter((task) => task.task_type === "render_motion_cue")).toHaveLength(2);
  });

  it("reports zero provider video calls in an all_remotion plan", () => {
    const compiled = compileAssetPlanFromIntents(
      makeCompilerInput([
        { segment_id: "seg_001", resolved_route: "remotion" },
        { segment_id: "seg_002", resolved_route: "remotion" },
        { segment_id: "seg_003", resolved_route: "remotion" },
      ]),
    );
    expect(compiled.plan.cost_summary.by_type.video_clip ?? 0).toBe(0);
    // provider calls 只覆盖 tts/image/video；无 video 时等于 tts+image 任务数
    const videoCount = compiled.plan.tasks.filter((task) => task.task_type === "video_clip").length;
    expect(videoCount).toBe(0);
  });

  it("writes route and reason into the compiler trace without re-deriving locally", () => {
    const compiled = compileAssetPlanFromIntents(
      makeCompilerInput([
        { segment_id: "seg_001", resolved_route: "api_video" },
        { segment_id: "seg_002", resolved_route: "remotion" },
      ]),
    );
    const applied = compiled.actions.filter((action) => action.code === "visual_strategy_applied");
    expect(applied).toEqual([
      { code: "visual_strategy_applied", segment_id: "seg_001", route: "api_video", reason_code: "test_route" },
      { code: "visual_strategy_applied", segment_id: "seg_002", route: "remotion", reason_code: "test_route" },
    ]);
    for (const action of applied) {
      expect(action).not.toHaveProperty("preference");
    }
  });

  it("rejects intent output that contradicts the resolved route", () => {
    const input = makeCompilerInput([{ segment_id: "seg_001", resolved_route: "api_video" }]);
    // api_video 段缺少 video_clip（只有 anchor + motion + 全局 BGM）
    input.chunks[0]!.draft.segments[0]!.intents = [image(), motion(), {
      asset_kind: "bgm_cue" as const, production_intent: "建立全片底乐",
      required_tags: ["弦乐"], mood_tags: ["悬疑"], selection_label: null,
      timing_basis: "tts" as const, scope: "global" as const, segment_ids: [],
      volume: 0.3, fade_in_sec: 1, fade_out_sec: 2, risk_notes: [],
    }];
    expectCompilerFailure(input, "visual_strategy_mismatch");
  });

  it("rejects segments with a missing or unknown resolved route entry", () => {
    const missing = makeCompilerInput([{ segment_id: "seg_001", resolved_route: "remotion" }]);
    missing.segmentVisualRoutes = new Map();
    expectCompilerFailure(missing, "visual_route_missing");

    const unknown = makeCompilerInput([{ segment_id: "seg_001", resolved_route: "remotion" }]);
    unknown.segmentVisualRoutes = new Map([
      ["seg_001", { segment_id: "seg_001", api_video_suitability: "remotion_sufficient", resolved_route: "remotion", reason_code: "test_route" }],
      ["seg_ghost", { segment_id: "seg_ghost", api_video_suitability: "remotion_sufficient", resolved_route: "remotion", reason_code: "test_route" }],
    ]);
    expectCompilerFailure(unknown, "visual_route_unknown_segment");
  });
});

describe("resolved visual route validation", () => {
  it("hard-fails an API route segment missing anchor, video_clip or render_motion_cue", () => {
    const storyboard = makeStoryboard([{ segment_id: "seg_001", resolved_route: "api_video" }]);
    const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
    const routes = makeRoutes(storyboard);
    const plan = AssetPlan.parse({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "storyboard_record",
      source_script_record_id: "script_record",
      source_topic_package_id: "topic_package",
      art_bible: makeGlobal().art_bible,
      visual_budget: makeGlobal().visual_budget,
      downgrade_policy: makeGlobal().downgrade_policy,
      global_audio_strategy: makeGlobal().global_audio_strategy,
      tts_plan: makeAudio(storyboard).tts_plan,
      tasks: [
        makeAudio(storyboard).tasks[0]!,
        makeAudio(storyboard).tasks[1]!,
        {
          task_id: "img_s000_01", order: 2, task_type: "image_still", source_segment_id: "seg_001",
          source_excerpt: storyboard.segments[0]!.script_excerpt, production_intent: "主视觉",
          recommended_mode: "manual_allowed", provider_hint: null,
          prompt_draft: "历史画面", parameters: { image_role: "support", support_reason: "补充", video_prompt_reserve: "预留" },
          manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png"], acceptance_notes: [] },
          risk_notes: ["风险"], cost_tier: "low", initial_status: "planned",
        },
      ],
      dependencies: [],
      cost_summary: { total_tasks: 3, by_type: {}, by_cost_tier: { free: 0, low: 0, medium: 0, high: 0 }, estimated_provider_calls: 3, notes: [] },
      global_production_notes: [],
    });
    const validation = validateAssetPlan({
      plan,
      storyboard,
      scriptText,
      storyboardRecordId: "storyboard_record",
      scriptRecordId: "script_record",
      topicPackageId: "topic_package",
      segmentVisualRoutes: routes,
    });
    expect(validation.decision).toBe("regen_once");
    expect(validation.errors).toContain("asset_segment_anchor_missing");
    expect(validation.errors).toContain("asset_segment_visual_route_violation");
  });

  it("hard-fails a Remotion route segment planning video_clip", () => {
    const storyboard = makeStoryboard([{ segment_id: "seg_001", resolved_route: "remotion" }]);
    const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
    const audio = makeAudio(storyboard);
    const plan = AssetPlan.parse({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "storyboard_record",
      source_script_record_id: "script_record",
      source_topic_package_id: "topic_package",
      art_bible: makeGlobal().art_bible,
      visual_budget: makeGlobal().visual_budget,
      downgrade_policy: makeGlobal().downgrade_policy,
      global_audio_strategy: makeGlobal().global_audio_strategy,
      tts_plan: audio.tts_plan,
      tasks: [
        audio.tasks[0]!,
        audio.tasks[1]!,
        {
          task_id: "img_s000_01", order: 2, task_type: "image_still", source_segment_id: "seg_001",
          source_excerpt: storyboard.segments[0]!.script_excerpt, production_intent: "主视觉",
          recommended_mode: "manual_allowed", provider_hint: null,
          prompt_draft: "历史画面", parameters: { image_role: "anchor", support_reason: null, video_prompt_reserve: "预留" },
          manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png"], acceptance_notes: [] },
          risk_notes: ["风险"], cost_tier: "low", initial_status: "planned",
        },
        {
          task_id: "video_s000_01", order: 3, task_type: "video_clip", source_segment_id: "seg_001",
          source_excerpt: storyboard.segments[0]!.script_excerpt, production_intent: "连续动作",
          recommended_mode: "manual_allowed", provider_hint: null,
          prompt_draft: "动作画面", parameters: { why_static_insufficient: "必须连续", static_fallback_task_id: "img_s000_01" },
          manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["video/mp4"], acceptance_notes: [] },
          risk_notes: ["风险"], cost_tier: "high", initial_status: "planned",
        },
      ],
      dependencies: [{ dependency_id: "dep_video_s000_01_after_img_s000_01_requires_output", task_id: "video_s000_01", depends_on_task_id: "img_s000_01", dependency_type: "requires_output" }],
      cost_summary: { total_tasks: 4, by_type: {}, by_cost_tier: { free: 0, low: 0, medium: 0, high: 0 }, estimated_provider_calls: 3, notes: [] },
      global_production_notes: [],
    });
    const validation = validateAssetPlan({
      plan,
      storyboard,
      scriptText,
      storyboardRecordId: "storyboard_record",
      scriptRecordId: "script_record",
      topicPackageId: "topic_package",
      segmentVisualRoutes: makeRoutes(storyboard),
    });
    expect(validation.decision).toBe("regen_once");
    expect(validation.errors).toContain("asset_segment_visual_route_violation");
    expect(validation.errors).not.toContain("asset_video_missing_static_fallback");
  });
});

describe("resolved visual route prompt input", () => {
  it("carries segment_routes into planner input without any legacy preference field", () => {
    const storyboard = makeStoryboard([
      { segment_id: "seg_001", resolved_route: "api_video" },
      { segment_id: "seg_002", resolved_route: "remotion" },
    ]);
    const plannerInput = buildSegmentIntentPlannerInput({
      chunk_id: "chunk_001",
      is_first_chunk: true,
      segments: storyboard.segments,
      art_bible: makeGlobal().art_bible,
      visual_budget: makeGlobal().visual_budget,
      downgrade_policy: makeGlobal().downgrade_policy,
      global_audio_strategy: makeGlobal().global_audio_strategy,
      segment_routes: storyboard.segments.map((segment) => ({
        segment_id: segment.segment_id,
        resolved_route: makeRoutes(storyboard).get(segment.segment_id)!.resolved_route,
      })),
    });
    expect(plannerInput.segment_routes).toEqual([
      { segment_id: "seg_001", resolved_route: "api_video" },
      { segment_id: "seg_002", resolved_route: "remotion" },
    ]);
    expect(JSON.stringify(plannerInput)).not.toContain("visual_strategy_preference");
    expect(JSON.stringify(plannerInput)).not.toContain("preference");
  });

  it("rejects planner input whose segment_routes do not match the chunk segments", () => {
    const storyboard = makeStoryboard([{ segment_id: "seg_001", resolved_route: "remotion" }]);
    const base = {
      chunk_id: "chunk_001",
      is_first_chunk: true,
      segments: storyboard.segments,
      art_bible: makeGlobal().art_bible,
      visual_budget: { mode: "balanced" },
      downgrade_policy: { video_to_image: true },
      global_audio_strategy: makeGlobal().global_audio_strategy,
    };
    expect(() => buildSegmentIntentPlannerInput({ ...base, segment_routes: [] })).toThrow(/一一对应/);
    expect(() =>
      buildSegmentIntentPlannerInput({
        ...base,
        segment_routes: [{ segment_id: "seg_ghost", resolved_route: "remotion" }],
      }),
    ).toThrow(/不一致/);
    expect(() =>
      buildSegmentIntentPlannerInput({
        ...base,
        segment_routes: [{ segment_id: "seg_001", resolved_route: "api_video_fancy" as never }],
      }),
    ).toThrow(/非法/);
  });

  it("validates intent drafts against resolved routes from the context", () => {
    const storyboard = makeStoryboard([{ segment_id: "seg_001", resolved_route: "api_video" }]);
    const routes = makeRoutes(storyboard);
    const context = {
      segments: storyboard.segments,
      isFirstChunk: true,
      segment_routes: new Map(
        storyboard.segments.map((segment) => [
          segment.segment_id,
          routes.get(segment.segment_id)!.resolved_route,
        ]),
      ),
    };
    // api_video 段缺少 render_motion_cue → 必须报 missing_required_intent_kind
    const missingMotion = inspectSegmentIntentBatch({
      raw: {
        planning_mode: "segment_intent_batch",
        segments: [{
          source_segment_id: "seg_001",
          intents: [image(), video()],
        }],
        budget_notes: [],
      },
      context,
    });
    expect(missingMotion.issues).toContainEqual(
      expect.objectContaining({ code: "missing_required_intent_kind", expected_kind: "render_motion_cue" }),
    );
    // remotion 段规划 video_clip → 必须报 visual_strategy_mismatch
    const remotionStoryboard = makeStoryboard([{ segment_id: "seg_001", resolved_route: "remotion" }]);
    const remotionContext = {
      segments: remotionStoryboard.segments,
      isFirstChunk: true,
      segment_routes: new Map([
        ["seg_001", makeRoutes(remotionStoryboard).get("seg_001")!.resolved_route],
      ]),
    };
    const mismatched = inspectSegmentIntentBatch({
      raw: {
        planning_mode: "segment_intent_batch",
        segments: [{
          source_segment_id: "seg_001",
          intents: [image(), video()],
        }],
        budget_notes: [],
      },
      context: remotionContext,
    });
    expect(mismatched.issues).toContainEqual(
      expect.objectContaining({ code: "visual_strategy_mismatch" }),
    );
  });
});
