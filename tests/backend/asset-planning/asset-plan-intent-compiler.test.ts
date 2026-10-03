import { describe, expect, it } from "vitest";

import { AssetPlan, type AssetTask, type ScriptDraftPackage, type StoryboardPlan } from "../../../shared/src/index.js";
import {
  AssetPlanCompilerInvariantError,
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
  type CharacterSheetCompileConfig,
  type CompiledIntentChunkInput,
  type GlobalPlanningCompilerDraft,
  type LocalAudioSkeleton,
} from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import type { SegmentAssetIntentBatchDraft } from "../../../backend/src/modules/asset-planning/segment-asset-intent.js";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator.js";

function makeStoryboard(count: number): StoryboardPlan {  return {
    plan_version: "storyboard_v1",
    source_script_record_id: "script_record",
    source_topic_package_id: "topic_package",
    estimated_total_duration_sec: count * 5,
    segments: Array.from({ length: count }, (_, index) => ({
      segment_id: `seg_${String(index + 1).padStart(3, "0")}`,
      order: index,
      script_excerpt: `第${index + 1}段口播。`,
      start_hint_sec: index * 5,
      end_hint_sec: (index + 1) * 5,
      narrative_role: index === 0 ? "opening" : index === count - 1 ? "ending" : "setup",
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
      api_video_suitability: index % 3 === 0 ? "api_video_strongly_recommended" : "remotion_sufficient",
    })),
    global_visual_notes: [],
  };
}

function isApiVideoSuitability(
  suitability: StoryboardPlan["segments"][number]["api_video_suitability"],
): boolean {
  return suitability === "api_video_beneficial" || suitability === "api_video_strongly_recommended";
}

function image(role: "anchor" | "support" = "anchor", suffix = "") {
  return {
    asset_kind: "image_still" as const,
    production_intent: `图像意图${suffix}`,
    image_prompt: `图像提示${suffix}`,
    video_prompt_reserve: `视频预留${suffix}`,
    image_role: role,
    support_reason: role === "support" ? `补充理由${suffix}` : null,
    risk_notes: [`图像风险${suffix}`],
  };
}

function video(suffix = "") {
  return {
    asset_kind: "video_clip" as const,
    production_intent: `视频意图${suffix}`,
    video_prompt: `视频提示${suffix}`,
    why_static_insufficient: `静态不足${suffix}`,
    risk_notes: [`视频风险${suffix}`],
  };
}

function motion(suffix = "") {
  return {
    asset_kind: "render_motion_cue" as const,
    production_intent: `运镜意图${suffix}`,
    risk_notes: [`运镜风险${suffix}`],
  };
}

function sfx(timing_basis: "none" | "tts" = "tts", suffix = "") {
  return {
    asset_kind: "sfx_cue" as const,
    production_intent: `音效意图${suffix}`,
    required_tags: [`撞击${suffix}`],
    mood_tags: [`紧张${suffix}`],
    selection_label: `音效选择${suffix}`,
    timing_basis,
    risk_notes: [`音效风险${suffix}`],
  };
}

function bgm(scope: "global" | "segment" | "segment_span", segmentIds: string[], suffix = "") {
  return {
    asset_kind: "bgm_cue" as const,
    production_intent: `配乐意图${suffix}`,
    required_tags: [`弦乐${suffix}`],
    mood_tags: [`悬疑${suffix}`],
    selection_label: `配乐选择${suffix}`,
    timing_basis: "tts" as const,
    scope,
    segment_ids: segmentIds,
    volume: 0.35,
    fade_in_sec: 0.5,
    fade_out_sec: 1.5,
    risk_notes: [`配乐风险${suffix}`],
  };
}

function makeAudio(storyboard: StoryboardPlan): LocalAudioSkeleton {
  const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
  const tts: AssetTask = {
    task_id: "tts_001", order: 0, task_type: "tts_audio", source_segment_id: null,
    source_excerpt: scriptText, production_intent: "生成全片口播音频", recommended_mode: "auto",
    provider_hint: "default_tts", prompt_draft: null,
    parameters: { voice_profile_id: "voice_default_male_storyteller", chunk_ids: storyboard.segments.map((_, index) => `tts_${String(index + 1).padStart(3, "0")}`) },
    manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
    risk_notes: [], cost_tier: "low", initial_status: "planned",
  };
  const subtitle: AssetTask = {
    task_id: "subtitle_001", order: 1, task_type: "subtitle_track", source_segment_id: null,
    source_excerpt: scriptText, production_intent: "根据 TTS 时间戳生成字幕轨", recommended_mode: "auto",
    provider_hint: null, prompt_draft: null, parameters: { format: "srt", source_tts_task_id: "tts_001" },
    manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
    risk_notes: [], cost_tier: "free", initial_status: "planned",
  };
  return {
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller", estimated_total_duration_sec: storyboard.estimated_total_duration_sec,
      chunking_strategy: "segment_boundary",
      chunks: storyboard.segments.map((segment, index) => ({ chunk_id: `tts_${String(index + 1).padStart(3, "0")}`, order: index, script_excerpt: segment.script_excerpt, estimated_duration_sec: 5 })),
    },
    tasks: [tts, subtitle],
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

function makeDraft(storyboard: StoryboardPlan): ScriptDraftPackage {
  const script_text = storyboard.segments.map((segment) => segment.script_excerpt).join("");
  return { script_text, estimated_duration_sec: storyboard.estimated_total_duration_sec, beat_trace: [], quote_trace: [], opening_span: storyboard.segments[0]!.script_excerpt, ending_span: storyboard.segments.at(-1)!.script_excerpt };
}

function makeChunks(storyboard: StoryboardPlan, size = 2): CompiledIntentChunkInput[] {
  const chunks: CompiledIntentChunkInput[] = [];
  for (let start = 0; start < storyboard.segments.length; start += size) {
    const segments = storyboard.segments.slice(start, start + size);
    const entries = segments.map((segment) => ({
      source_segment_id: segment.segment_id,
      intents: [
        image(),
        ...(isApiVideoSuitability(segment.api_video_suitability) ? [video(), motion()] : [motion()]),
        sfx(),
        ...(segment.order === 0 ? [bgm("global", [])] : []),
      ],
    }));
    chunks.push({ chunkIndex: chunks.length, inputSegmentIds: segments.map((segment) => segment.segment_id), draft: { planning_mode: "segment_intent_batch", segments: entries, budget_notes: [`预算${chunks.length}`] } });
  }
  return chunks;
}

function makeInput(count = 3): AssetPlanCompilerInput {
  const storyboard = makeStoryboard(count);
  return {
    sourceIds: { storyboardRecordId: "storyboard_record", scriptRecordId: "script_record", topicPackageId: "topic_package" },
    storyboard, draft: makeDraft(storyboard), globalDraft: makeGlobal(), audioSkeleton: makeAudio(storyboard), chunks: makeChunks(storyboard),
    segmentVisualRoutes: new Map(storyboard.segments.map((segment) => [segment.segment_id, {
      segment_id: segment.segment_id,
      segment_override: null,
      api_video_suitability: segment.api_video_suitability,
      resolved_route: isApiVideoSuitability(segment.api_video_suitability) ? "api_video" : "remotion",
      reason_code: "test_route",
    }])),
  };
}

function expectInvariant(input: AssetPlanCompilerInput, issueCode: string) {
  try {
    compileAssetPlanFromIntents(input);
    throw new Error("expected compiler failure");
  } catch (error) {
    expect(error).toBeInstanceOf(AssetPlanCompilerInvariantError);
    expect(error).toMatchObject({ code: "asset_plan_compiler_invariant_failed", issues: expect.arrayContaining([expect.objectContaining({ code: issueCode })]) });
    expect(JSON.stringify(error)).not.toContain("图像提示");
  }
}

describe("compileAssetPlanFromIntents", () => {
  it("is invariant to chunk permutation/completion order and deeply deterministic", () => {
    const input = makeInput(15);
    const baseline = compileAssetPlanFromIntents(input);
    const permuted = compileAssetPlanFromIntents({ ...structuredClone(input), chunks: structuredClone(input.chunks).reverse() });
    const reindexedCompletionOrder = compileAssetPlanFromIntents({
      ...structuredClone(input),
      chunks: structuredClone(input.chunks).reverse().map((chunk, chunkIndex) => ({ ...chunk, chunkIndex })),
    });
    expect(permuted).toEqual(baseline);
    expect(reindexedCompletionOrder).toEqual(baseline);
    expect(compileAssetPlanFromIntents(structuredClone(input))).toEqual(baseline);
    expect(AssetPlan.parse(baseline.plan)).toEqual(baseline.plan);
    expect(baseline.plan.tasks.filter((task) => task.task_type === "image_still").slice(0, 3).map((task) => task.task_id)).toEqual([
      "img_s000_01", "img_s001_01", "img_s002_01",
    ]);
  });

  it("uses stable segment/type/ordinal IDs, ordering, namespaces and storyboard excerpts", () => {
    const input = makeInput(1);
    input.chunks[0]!.draft.segments[0]!.intents = [sfx("none", "A"), image("support", "A"), video("A"), image("anchor"), sfx("none", "B"), image("support", "B"), bgm("global", []), motion()];
    const { plan } = compileAssetPlanFromIntents(input);
    expect(plan.tasks.map((task) => task.task_id)).toEqual([
      "tts_001", "subtitle_001", "img_s000_01", "img_s000_02", "img_s000_03", "motion_s000_01", "video_s000_01", "sfx_s000_01", "sfx_s000_02", "bgm_s000_01",
    ]);
    expect(plan.tasks.map((task) => task.order)).toEqual(Array.from({ length: 10 }, (_, index) => index));
    expect(new Set(plan.tasks.map((task) => task.task_id)).size).toBe(plan.tasks.length);
    expect(plan.tasks.slice(2).every((task) => task.source_excerpt === input.storyboard.segments[0]!.script_excerpt)).toBe(true);
  });

  it("honors user visual strategy and maps complete task policy tables", () => {
    const { plan } = compileAssetPlanFromIntents(makeInput(3));
    const imageTask = plan.tasks.find((task) => task.task_type === "image_still")!;
    const videoTask = plan.tasks.find((task) => task.task_type === "video_clip")!;
    const motionTask = plan.tasks.find((task) => task.task_type === "render_motion_cue")!;
    const sfxTask = plan.tasks.find((task) => task.task_type === "sfx_cue")!;
    const bgmTask = plan.tasks.find((task) => task.task_type === "bgm_cue")!;
    expect(imageTask).toMatchObject({ recommended_mode: "manual_allowed", provider_hint: null, cost_tier: "low", initial_status: "planned", manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"] } });
    expect(videoTask).toMatchObject({ recommended_mode: "manual_allowed", provider_hint: null, cost_tier: "high", initial_status: "planned", manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["video/mp4", "video/quicktime"] } });
    expect(motionTask).toMatchObject({ recommended_mode: "auto", provider_hint: null, cost_tier: "free", initial_status: "planned", manual_upload_policy: { allowed: false, required: false, accepted_file_types: [] } });
    expect(sfxTask).toMatchObject({ recommended_mode: "auto", provider_hint: null, cost_tier: "low", initial_status: "planned", manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg"] } });
    expect(bgmTask).toMatchObject({ recommended_mode: "auto", provider_hint: null, cost_tier: "low", initial_status: "planned", manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg"] } });
    expect(plan.tasks.filter((task) => task.source_segment_id === "seg_001").some((task) => task.task_type === "video_clip")).toBe(true);
    expect(plan.tasks.filter((task) => task.source_segment_id === "seg_002").some((task) => task.task_type === "render_motion_cue")).toBe(true);
  });

  it("maps image/video/motion/audio intent parameters and unique anchor fallback", () => {
    const input = makeInput(1);
    input.chunks[0]!.draft.segments[0]!.intents = [image("support", "细节"), image("anchor"), video(), motion(), sfx(), bgm("global", [])];
    const { plan } = compileAssetPlanFromIntents(input);
    const anchor = plan.tasks.find((task) => task.task_type === "image_still" && task.parameters.image_role === "anchor")!;
    const support = plan.tasks.find((task) => task.task_type === "image_still" && task.parameters.image_role === "support")!;
    const videoTask = plan.tasks.find((task) => task.task_type === "video_clip")!;
    const motionTask = plan.tasks.find((task) => task.task_type === "render_motion_cue")!;
    expect(anchor.parameters).toMatchObject({ image_role: "anchor", support_reason: null, video_prompt_reserve: "视频预留" });
    expect(support.parameters).toMatchObject({ image_role: "support", support_reason: "补充理由细节", video_prompt_reserve: "视频预留细节" });
    expect(videoTask.parameters).toMatchObject({ why_static_insufficient: "静态不足", static_fallback_task_id: anchor.task_id });
    expect(motionTask.parameters).toMatchObject({ recipe_type: "static", source_image_task_id: anchor.task_id });
    expect(plan.tasks.find((task) => task.task_type === "sfx_cue")!.parameters).toEqual(expect.objectContaining({ required_tags: ["撞击"], mood_tags: ["紧张"], selection_label: "音效选择", timing_basis: "tts" }));
    expect(plan.tasks.find((task) => task.task_type === "bgm_cue")!.parameters).toEqual(expect.objectContaining({ required_tags: ["弦乐"], mood_tags: ["悬疑"], selection_label: "配乐选择", timing_basis: "tts", scope: "global", segment_ids: [], volume: 0.35, fade_in_sec: 0.5, fade_out_sec: 1.5 }));
  });

  it("freezes video_clip resolution from the snapshot api_quality mapping (defaults 720P)", () => {
    // 2026-08-28 修复回归：编译器曾硬编码 resolution "1080P"，导致执行绕过
    // 用户配置（快照 api_quality）且计价按 720p 低估 1080P 实际费用。
    const defaultPlan = compileAssetPlanFromIntents(makeInput(1)).plan;
    expect(defaultPlan.tasks.find((task) => task.task_type === "video_clip")!.parameters.resolution).toBe("720P");
    const hdInput = makeInput(1);
    hdInput.chunks[0]!.draft.segments[0]!.intents = [image("anchor"), video(), motion(), sfx(), bgm("global", [])];
    const hdPlan = compileAssetPlanFromIntents({ ...hdInput, videoResolution: "1080P" }).plan;
    expect(hdPlan.tasks.find((task) => task.task_type === "video_clip")!.parameters.resolution).toBe("1080P");
  });

  it("creates only legal deterministic dependencies and an exact cost summary", () => {
    const input = makeInput(1);
    input.chunks[0]!.draft.segments[0]!.intents = [image(), video(), motion(), sfx("tts"), sfx("none", "free"), bgm("global", [])];
    const first = compileAssetPlanFromIntents(input).plan;
    const second = compileAssetPlanFromIntents(structuredClone(input)).plan;
    expect(first.dependencies).toEqual(second.dependencies);
    expect(first.dependencies.map((dependency) => [dependency.task_id, dependency.depends_on_task_id, dependency.dependency_type])).toEqual([
      ["subtitle_001", "tts_001", "requires_timing"],
      ["motion_s000_01", "img_s000_01", "requires_output"],
      ["video_s000_01", "img_s000_01", "requires_output"],
      ["sfx_s000_01", "tts_001", "requires_timing"],
      ["bgm_s000_01", "tts_001", "requires_timing"],
    ]);
    expect(new Set(first.dependencies.map((dependency) => dependency.dependency_id)).size).toBe(first.dependencies.length);
    expect(first.cost_summary).toEqual({ total_tasks: 8, by_type: { tts_audio: 1, subtitle_track: 1, image_still: 1, render_motion_cue: 1, video_clip: 1, sfx_cue: 2, bgm_cue: 1 }, by_cost_tier: { free: 2, low: 5, medium: 0, high: 1 }, estimated_provider_calls: 3, notes: ["预算0"] });
  });

  it("finds global BGM owner by the chunk containing the first storyboard segment", () => {
    const input = makeInput(3);
    input.chunks = [input.chunks[1]!, input.chunks[0]!];
    const compiled = compileAssetPlanFromIntents(input);
    expect(compiled.plan.tasks.find((task) => task.task_type === "bgm_cue")?.source_segment_id).toBe("seg_001");
    expect(compiled.actions).toContainEqual({ code: "global_bgm_owner_bound", segment_id: "seg_001" });
    expect(compiled.actions).toContainEqual({ code: "visual_strategy_applied", segment_id: "seg_003", route: "remotion", reason_code: "test_route" });
  });

  it.each([1, 15, 21])("compiles %i segments with exact coverage", (count) => {
    const { plan } = compileAssetPlanFromIntents(makeInput(count));
    expect(AssetPlan.parse(plan)).toEqual(plan);
    expect(new Set(plan.tasks.flatMap((task) => task.source_segment_id ? [task.source_segment_id] : [])).size).toBe(count);
  });

  it("rejects non-contiguous, duplicate and forged chunk indexes", () => {
    const missing = makeInput(3); missing.chunks[1]!.chunkIndex = 2;
    expectInvariant(missing, "chunk_index_sequence_invalid");
    const duplicate = makeInput(3); duplicate.chunks[1]!.chunkIndex = 0;
    expectInvariant(duplicate, "chunk_index_duplicate");
  });

  it("rejects input/draft segment order mismatch and unknown segments", () => {
    const mismatch = makeInput(3); mismatch.chunks[0]!.inputSegmentIds.reverse();
    expectInvariant(mismatch, "chunk_segment_sequence_mismatch");
    const unknown = makeInput(3); unknown.chunks[0]!.inputSegmentIds[0] = "seg_unknown";
    expectInvariant(unknown, "unknown_segment");
  });

  it("rejects omissions and duplicate cross-chunk coverage", () => {
    const omitted = makeInput(3); omitted.chunks = omitted.chunks.slice(0, 1); omitted.chunks[0]!.chunkIndex = 0;
    expectInvariant(omitted, "missing_segment");
    const duplicated = makeInput(3); duplicated.chunks[1]!.draft.segments[0] = structuredClone(duplicated.chunks[0]!.draft.segments[0]!); duplicated.chunks[1]!.inputSegmentIds[0] = "seg_001";
    expectInvariant(duplicated, "duplicate_segment");
  });

  it("rejects unexpected storyboard order and unsafe audio skeleton/dependencies", () => {
    const order = makeInput(1); order.storyboard.segments[0]!.order = 7;
    expectInvariant(order, "storyboard_order_invalid");
    const dependency = makeInput(1); dependency.audioSkeleton.dependencies.push({ dependency_id: "bad", task_id: "missing", depends_on_task_id: "tts_001", dependency_type: "requires_output" });
    expectInvariant(dependency, "audio_skeleton_mismatch");
    const missingDependency = makeInput(1); missingDependency.audioSkeleton.dependencies = [];
    expectInvariant(missingDependency, "audio_skeleton_mismatch");
    const unexpectedId = makeInput(1); unexpectedId.audioSkeleton.tasks[0]!.task_id = "tts_random";
    expectInvariant(unexpectedId, "audio_skeleton_mismatch");
    const status = makeInput(1); status.audioSkeleton.tasks[0]!.initial_status = "queued" as never;
    expectInvariant(status, "audio_skeleton_mismatch");
    const cost = makeInput(1); cost.audioSkeleton.tasks[0]!.cost_tier = "unknown" as never;
    expectInvariant(cost, "audio_skeleton_mismatch");
  });

  it.each([
    ["dependency id", (input: AssetPlanCompilerInput) => { input.audioSkeleton.dependencies[0]!.dependency_id = "dep_forged"; }],
    ["chunk id", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tts_plan.chunks[0]!.chunk_id = "tts_forged"; }],
    ["chunk excerpt", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tts_plan.chunks[0]!.script_excerpt = "伪造口播"; }],
    ["chunk order", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tts_plan.chunks[0]!.order = 8; }],
    ["chunk duration", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tts_plan.chunks[0]!.estimated_duration_sec = 99; }],
    ["task excerpt", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tasks[0]!.source_excerpt = "伪造全文"; }],
    ["task parameters", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tasks[0]!.parameters = { voice_profile_id: "other", chunk_ids: [] }; }],
    ["task provider", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tasks[0]!.provider_hint = "forged"; }],
    ["task manual policy", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tasks[0]!.manual_upload_policy.allowed = true; }],
    ["task mode", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tasks[0]!.recommended_mode = "manual_allowed"; }],
    ["extra task", (input: AssetPlanCompilerInput) => { input.audioSkeleton.tasks.push(structuredClone(input.audioSkeleton.tasks[0]!)); }],
    ["extra dependency", (input: AssetPlanCompilerInput) => { input.audioSkeleton.dependencies.push(structuredClone(input.audioSkeleton.dependencies[0]!)); }],
  ] as const)("rejects forged audio skeleton %s", (_label, mutate) => {
    const input = makeInput(1);
    mutate(input);
    expectInvariant(input, "audio_skeleton_mismatch");
  });

  it("rejects intent output that contradicts an explicit user visual strategy", () => {
    const input = makeInput(1);
    input.chunks[0]!.draft.segments[0]!.intents = [image(), motion(), bgm("global", [])];
    expectInvariant(input, "visual_strategy_mismatch");
  });

  it("wraps unexpected final schema drift in the stable compiler invariant error", () => {
    const input = makeInput(1);
    input.globalDraft.global_audio_strategy = {
      voice_intent: { secret_prompt: "不得泄漏" },
    } as never;
    expectInvariant(input, "compiled_plan_schema_invalid");
  });

  it("rejects schema-valid output when the existing local validator reports an error", () => {
    const storyboardSecret = "分镜秘密正文甲";
    const draftSecret = "稿件秘密正文乙";
    const input = makeInput(1);
    input.storyboard.segments[0]!.script_excerpt = storyboardSecret;
    input.draft.script_text = draftSecret;
    input.draft.opening_span = draftSecret;
    input.draft.ending_span = draftSecret;
    input.audioSkeleton.tts_plan.chunks[0]!.script_excerpt = storyboardSecret;
    input.audioSkeleton.tasks[0]!.source_excerpt = draftSecret;
    input.audioSkeleton.tasks[1]!.source_excerpt = draftSecret;

    let returnedPlan: ReturnType<typeof compileAssetPlanFromIntents>["plan"] | undefined;
    let thrown: unknown;
    try {
      returnedPlan = compileAssetPlanFromIntents(input).plan;
    } catch (error) {
      thrown = error;
    }

    if (returnedPlan) {
      const externalValidation = validateAssetPlan({
        plan: returnedPlan,
        storyboard: input.storyboard,
        scriptText: input.draft.script_text,
        storyboardRecordId: input.sourceIds.storyboardRecordId,
        scriptRecordId: input.sourceIds.scriptRecordId,
        topicPackageId: input.sourceIds.topicPackageId,
      });
      expect(externalValidation.errors).toContain("asset_tts_script_coverage_missing");
    }
    expect(thrown).toBeInstanceOf(AssetPlanCompilerInvariantError);
    expect(thrown).toMatchObject({
      code: "asset_plan_compiler_invariant_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "asset_tts_script_coverage_missing" }),
      ]),
    });
    expect(JSON.stringify(thrown)).not.toContain(storyboardSecret);
    expect(JSON.stringify(thrown)).not.toContain(draftSecret);
  });
});

describe("角色稳定身份与分镜造型分离", () => {
  const identity = "四十岁左右，方脸，浓眉，鼻梁挺直，中等身高，肩背宽厚";
  const legacyLooks = "紫袍佩刀，称帝时换天子衮冕，三套服饰并列对照";

  function identityInput(): AssetPlanCompilerInput {
    const input = makeInput(2);
    input.globalDraft.art_bible.characters[0] = {
      ...input.globalDraft.art_bible.characters[0]!,
      identity_description: identity,
      visual_description: legacyLooks,
    };
    const scenes = ["人物甲穿紫袍佩刀，在军帐发令", "人物甲穿天子衮冕，在宫殿登基"];
    input.storyboard.segments.forEach((segment, index) => {
      segment.scene_description = scenes[index]!;
    });
    input.chunks[0]!.draft.segments.forEach((entry, index) => {
      entry.intents = entry.intents.map((intent) => intent.asset_kind === "image_still"
        ? { ...intent, image_prompt: scenes[index]! }
        : intent);
    });
    return input;
  }

  it("同一身份的两镜只追加稳定锚点，各自保留当前分镜服饰", () => {
    const { plan } = compileAssetPlanFromIntents(identityInput());
    const images = plan.tasks.filter((task) => task.task_type === "image_still");
    expect(images).toHaveLength(2);
    for (const imageTask of images) {
      expect(imageTask.prompt_draft!.split("\n").find((line) => line.startsWith("[角色锚点]")))
        .toBe(`[角色锚点] 人物甲：${identity}`);
      expect(imageTask.prompt_draft).not.toContain(legacyLooks);
      expect(imageTask.prompt_draft).not.toContain("三套服饰");
    }
    expect(images[0]!.prompt_draft).toContain("人物甲穿紫袍佩刀，在军帐发令");
    expect(images[0]!.prompt_draft).not.toContain("天子衮冕");
    expect(images[1]!.prompt_draft).toContain("人物甲穿天子衮冕，在宫殿登基");
    expect(images[1]!.prompt_draft).not.toContain("紫袍佩刀");
  });

  it("旧角色缺少稳定身份时仍完整回退造型描述，不做本地语义抽取", () => {
    const input = identityInput();
    delete input.globalDraft.art_bible.characters[0]!.identity_description;
    const { plan } = compileAssetPlanFromIntents(input);
    for (const imageTask of plan.tasks.filter((task) => task.task_type === "image_still")) {
      expect(imageTask.prompt_draft).toContain(`[角色锚点] 人物甲：${legacyLooks}`);
    }
  });

  it("定妆图的提示与备用来源只使用稳定身份并继承冻结的项目画风", () => {
    const input = identityInput();
    input.characterSheet = { enabled: true, minSegmentHits: 2 };
    input.globalDraft.art_bible.visual_tone = "工笔插画，细线淡彩";
    input.globalDraft.art_bible.global_prompt_prefix = "绢本设色，纸张纹理";
    const { plan } = compileAssetPlanFromIntents(input);
    const sheet = plan.tasks.find((task) => task.task_type === "character_sheet")!;
    expect(sheet.source_excerpt).toBe(identity);
    expect(sheet.prompt_draft).toContain(identity);
    expect(sheet.prompt_draft).not.toContain(legacyLooks);
    expect(sheet.prompt_draft).toContain("工笔插画，细线淡彩");
    expect(sheet.prompt_draft).toContain("绢本设色，纸张纹理");
    expect(sheet.prompt_draft).toContain("战国");
    expect(sheet.prompt_draft).toContain("无现代物品");
    expect(sheet.prompt_draft).not.toContain("写实历史质感");
    expect(sheet.prompt_draft).not.toContain("无动漫风");
    expect(sheet.parameters).toMatchObject({ aspect_ratio: "16:9", size: "2048*1152" });
    expect(sheet.manual_upload_policy).toMatchObject({
      allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"],
    });
    expect(plan.tasks.filter((task) => task.task_type === "image_still")
      .map((task) => task.parameters.character_sheet_task_ids)).toEqual([["sheet_001"], ["sheet_001"]]);
  });

  it("定妆图约束单人正面全身远景、完整入画与留白，保留中性服饰和纯色背景", () => {
    const input = identityInput();
    input.characterSheet = { enabled: true, minSegmentHits: 2 };
    const { plan } = compileAssetPlanFromIntents(input);
    const sheet = plan.tasks.find((task) => task.task_type === "character_sheet")!;
    for (const constraint of [
      "单人",
      "正面自然站立",
      "全身远景",
      "头顶至双脚及脚下地面完整入画",
      "人物居中且四周留白",
      "单套中性服饰",
      "纯色背景",
      "无兵器",
      "无同人多姿态",
      "无多套服装对照",
    ]) {
      expect(sheet.prompt_draft).toContain(constraint);
    }
  });

  it("旧定妆任务保留完整造型描述回退，不宣称旧多造型内容已被清理", () => {
    const input = identityInput();
    delete input.globalDraft.art_bible.characters[0]!.identity_description;
    input.characterSheet = { enabled: true, minSegmentHits: 2 };
    const { plan } = compileAssetPlanFromIntents(input);
    const sheet = plan.tasks.find((task) => task.task_type === "character_sheet")!;
    expect(sheet.source_excerpt).toBe(legacyLooks);
    expect(sheet.prompt_draft).toContain(legacyLooks);
  });
});

describe("character_sheet 任务（T1：阈值、开关、注入关系）", () => {
  /**
   * 只改写 scene_description / visual_elements：阈值统计只看前者（与 [角色锚点] 同源），
   * script_excerpt 与 chunk 结构保持不变，因此 tts_plan / 覆盖率校验不受影响。
   */
  function withSegmentTexts(storyboard: StoryboardPlan, texts: string[]): StoryboardPlan {
    return {
      ...storyboard,
      segments: storyboard.segments.map((segment, index) => ({
        ...segment,
        scene_description: `第${index + 1}段场景：${texts[index] ?? "无人物"}。`,
        visual_elements: [],
      })),
    };
  }

  function sheetInput(
    texts: string[],
    extras: {
      characters?: AssetPlan["art_bible"]["characters"];
      characterSheet?: CharacterSheetCompileConfig;
    } = {},
  ): AssetPlanCompilerInput {
    const base = makeInput(texts.length);
    return {
      ...base,
      storyboard: withSegmentTexts(base.storyboard, texts),
      globalDraft: {
        ...base.globalDraft,
        art_bible: {
          ...base.globalDraft.art_bible,
          characters: extras.characters ?? base.globalDraft.art_bible.characters,
        },
      },
      characterSheet: extras.characterSheet,
    };
  }

  const 甲 = { character_id: "char_1", label: "人物甲", role: "主角", visual_description: "束发深衣", consistency_notes: [] };
  const 乙 = { character_id: "char_2", label: "人物乙", role: "配角", visual_description: "短褐麻衣", consistency_notes: [] };

  it("开关关闭（缺省 / enabled:false）时不产 sheet 任务，输出与现状逐字一致", () => {
    const off = sheetInput(["人物甲在庭院", "人物甲拔剑", "人物甲退走"]);
    const baseline = compileAssetPlanFromIntents(off);
    const explicitOff = compileAssetPlanFromIntents({
      ...off,
      characterSheet: { enabled: false, minSegmentHits: 1 },
    });
    expect(explicitOff).toEqual(baseline);
    expect(baseline.plan.tasks.some((task) => task.task_type === "character_sheet")).toBe(false);
    expect(
      baseline.plan.tasks.every((task) => task.parameters.character_sheet_task_ids === undefined),
    ).toBe(true);
    // 阈值高于任何角色的命中数时同样不产 sheet（阈值边界的另一侧）。
    const unreachable = compileAssetPlanFromIntents({
      ...off,
      characterSheet: { enabled: true, minSegmentHits: 99 },
    });
    expect(unreachable).toEqual(baseline);
  });

  it("开关开启且命中数达阈值时生成一张 sheet，字段完整且计划级校验放行", () => {
    const input = sheetInput(["人物甲在庭院", "人物甲拔剑", "人物甲退走"], {
      characterSheet: { enabled: true, minSegmentHits: 3 },
    });
    const { plan } = compileAssetPlanFromIntents(input);
    const sheet = plan.tasks.find((task) => task.task_type === "character_sheet");
    expect(sheet).toMatchObject({
      task_id: "sheet_001",
      order: 2,
      task_type: "character_sheet",
      source_segment_id: null,
      source_excerpt: "束发深衣",
      recommended_mode: "manual_allowed",
      provider_hint: null,
      cost_tier: "low",
      initial_status: "planned",
      // required 必须为 false：validator 在类型白名单判断之前就按 required 提前返回（设计 §3.1）。
      manual_upload_policy: {
        allowed: true,
        required: false,
        accepted_file_types: ["image/png", "image/jpeg"],
      },
    });
    // prompt_draft 由确定性模板拼装：角色 + 朝代风格 + 定妆布局（不依赖既有 enrichment）。
    expect(sheet!.prompt_draft).toContain("人物甲");
    expect(sheet!.prompt_draft).toContain("束发深衣");
    expect(sheet!.prompt_draft).toContain("战国");
    expect(sheet!.prompt_draft).toContain("定妆参考图");
    expect(sheet!.risk_notes.length).toBeGreaterThan(0);
    expect(sheet!.parameters).toMatchObject({
      character_id: "char_1",
      sheet_role: "character_sheet",
      segment_hit_count: 3,
      matched_segment_ids: ["seg_001", "seg_002", "seg_003"],
      // 独立画幅：不继承分镜图的 9:16 / 1080*1920（设计 §3.2）。
      aspect_ratio: "16:9",
      size: "2048*1152",
      negative_prompt: "现代物品",
    });
    expect(() => AssetPlan.parse(plan)).not.toThrow();
    const validation = validateAssetPlan({
      plan,
      storyboard: input.storyboard,
      scriptText: input.draft.script_text,
      storyboardRecordId: input.sourceIds.storyboardRecordId,
      scriptRecordId: input.sourceIds.scriptRecordId,
      topicPackageId: input.sourceIds.topicPackageId,
      segmentVisualRoutes: input.segmentVisualRoutes,
    });
    expect(validation.errors).not.toContain("asset_task_source_segment_invalid");
    expect(validation.decision).toBe("pass");
  });

  it("阈值边界：命中 2 不生成、命中 3/4 生成", () => {
    for (const [hits, expected] of [[2, 0], [3, 1], [4, 1]] as const) {
      const texts = Array.from({ length: 4 }, (_, index) =>
        index < hits ? "人物甲在庭院" : "无人物",
      );
      const { plan } = compileAssetPlanFromIntents(
        sheetInput(texts, { characterSheet: { enabled: true, minSegmentHits: 3 } }),
      );
      expect(plan.tasks.filter((task) => task.task_type === "character_sheet")).toHaveLength(expected);
    }
  });

  it("命中段的分镜图任务带 character_sheet_task_ids，未命中段不写该键，且不产生硬依赖", () => {
    const input = sheetInput(
      ["人物甲在庭院", "人物甲拔剑", "人物甲与人物乙对峙", "人物乙退走"],
      { characters: [甲, 乙], characterSheet: { enabled: true, minSegmentHits: 3 } },
    );
    const { plan } = compileAssetPlanFromIntents(input);
    // 人物甲命中 3 段（达阈值），人物乙只命中 2 段（不产 sheet）。
    expect(
      plan.tasks.filter((task) => task.task_type === "character_sheet").map((task) => task.task_id),
    ).toEqual(["sheet_001"]);
    const imageOf = (segmentId: string) =>
      plan.tasks.find(
        (task) => task.task_type === "image_still" && task.source_segment_id === segmentId,
      )!;
    expect(imageOf("seg_001").parameters.character_sheet_task_ids).toEqual(["sheet_001"]);
    expect(imageOf("seg_002").parameters.character_sheet_task_ids).toEqual(["sheet_001"]);
    expect(imageOf("seg_003").parameters.character_sheet_task_ids).toEqual(["sheet_001"]);
    expect(imageOf("seg_004").parameters).not.toHaveProperty("character_sheet_task_ids");
    // 可用性注入不是硬依赖（设计 §3.3）：引擎是单趟循环，硬依赖会把 sheet 失败放大成整批失败。
    expect(plan.dependencies.filter((item) => item.depends_on_task_id === "sheet_001")).toEqual([]);
  });

  it("成本估算把 sheet 计入 estimated_provider_calls（成本不漏算）", () => {
    const off = compileAssetPlanFromIntents(
      sheetInput(["人物甲在庭院", "人物甲拔剑", "人物甲退走"]),
    ).plan;
    const on = compileAssetPlanFromIntents(
      sheetInput(["人物甲在庭院", "人物甲拔剑", "人物甲退走"], {
        characterSheet: { enabled: true, minSegmentHits: 3 },
      }),
    ).plan;
    expect(on.cost_summary.estimated_provider_calls).toBe(
      off.cost_summary.estimated_provider_calls + 1,
    );
    expect(on.cost_summary.by_type.character_sheet).toBe(1);
  });

  it("多角色同时达阈值时各生成一张 sheet，共命中段按角色顺序注入两个 id", () => {
    const input = sheetInput(
      ["人物甲在庭院", "人物甲与人物乙对峙", "人物甲拔剑", "人物乙退走", "人物乙回望"],
      { characters: [甲, 乙], characterSheet: { enabled: true, minSegmentHits: 3 } },
    );
    const { plan } = compileAssetPlanFromIntents(input);
    const sheets = plan.tasks.filter((task) => task.task_type === "character_sheet");
    expect(sheets.map((task) => task.task_id)).toEqual(["sheet_001", "sheet_002"]);
    expect(sheets.map((task) => task.parameters.character_id)).toEqual(["char_1", "char_2"]);
    // sheet 任务 order 连续且落在音频骨架之后。
    expect(sheets.map((task) => task.order)).toEqual([2, 3]);
    const imageOf = (segmentId: string) =>
      plan.tasks.find(
        (task) => task.task_type === "image_still" && task.source_segment_id === segmentId,
      )!;
    expect(imageOf("seg_002").parameters.character_sheet_task_ids).toEqual(["sheet_001", "sheet_002"]);
    expect(imageOf("seg_005").parameters.character_sheet_task_ids).toEqual(["sheet_002"]);
  });
});
