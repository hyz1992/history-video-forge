import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalStringify, AssetPlanV2 } from "../../../shared/src/index.js";
import { normalizeNarrationTiming } from "../../../backend/src/modules/narration/narration-timing-normalizer.js";
import { projectStoryboardTiming } from "../../../backend/src/modules/storyboard/storyboard-timing-projector.js";
import { compileNarrationAssetPlan } from "../../../backend/src/modules/asset-planning/narration-reference-compiler.js";
import { buildSegmentIntentPlannerInput } from "../../../backend/src/modules/asset-planning/segment-intent-prompt-input.js";

import { generateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js";

function fixture() {
  const text = "汉汉汉汉", durationMs = 7000, audioHash = "a".repeat(64);
  const timingMap = normalizeNarrationTiming({ sourceText: text, audioHash, durationMs,
    sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text,
      words: Array.from(text, (text, i) => ({ text, begin_index: i, end_index: i + 1, begin_time: i * 1600, end_time: (i + 1) * 1600 })) }] });
  const narrationReference = { narration_record_id: "n1", audio_hash: audioHash, duration_ms: durationMs,
    timing_map_hash: createHash("sha256").update(canonicalStringify(timingMap)).digest("hex") };
  const narrationTiming = { timingMap, narrationReference };
  const visual = { narrative_role: "opening", visual_intent: "宫门", scene_description: "宫门", visual_elements: ["门"], framing_hint: "wide",
    content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "api_video_beneficial" };
  const storyboard = projectStoryboardTiming({ ...narrationTiming, plan: { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [],
    segments: [0, 1].map((start, i) => ({ ...visual, segment_id: "sb" + i, order: i, start_boundary_id: timingMap.boundaries[start]!.id, end_boundary_id: timingMap.boundaries[i ? 4 : 1]!.id })) } });
  const globalDraft = { art_bible: { era_style: "战国", visual_tone: "写实", characters: [], locations: [], props: [], global_prompt_prefix: "历史", global_negative_prompts: [], consistency_notes: [] },
    visual_budget: {}, downgrade_policy: {}, global_audio_strategy: { voice_intent: { ignored: true }, music: "克制" }, manual_review_notes: ["人工复核"] };
  const chunks = [{ chunkIndex: 0, inputSegmentIds: ["sb0", "sb1"], draft: { planning_mode: "segment_intent_batch" as const, budget_notes: [],
    segments: storyboard.segments.map((s, i) => ({ source_segment_id: s.segment_id, intents: [
      { asset_kind: "image_still" as const, production_intent: "门", image_prompt: "宫门", video_prompt_reserve: "推门", image_role: "anchor" as const, support_reason: null, risk_notes: ["核对服饰"] },
      { asset_kind: "video_clip" as const, production_intent: "推门", video_prompt: "推门", why_static_insufficient: "人物动作", risk_notes: ["核对服饰"] },
      { asset_kind: "render_motion_cue" as const, production_intent: "推进", risk_notes: ["缓慢"] },
      ...(i ? [] : [{ asset_kind: "bgm_cue" as const, production_intent: "配乐", required_tags: ["弦乐"], mood_tags: ["紧张"], selection_label: "克制", timing_basis: "tts" as const,
        scope: "global" as const, segment_ids: [], volume: 0.2, fade_in_sec: 0.5, fade_out_sec: 1, risk_notes: [] }]),
    ] })) } }];
  return { sourceIds: { storyboardRecordId: "sb-record", scriptRecordId: "s1", topicPackageId: "t1" }, storyboard, narrationTiming,
    draft: { script_text: text, estimated_duration_sec: 117, opening_span: text, ending_span: text, beat_trace: [], quote_trace: [] }, globalDraft, chunks,
    segmentVisualRoutes: new Map(storyboard.segments.map(s => [s.segment_id, { segment_id: s.segment_id, segment_override: null, api_video_suitability: s.api_video_suitability, resolved_route: "api_video" as const, reason_code: "test" }])) };
}

describe("Task9A 前置口播引用编译", () => {
  it("不生成TTS或重新选择voice，依赖无悬空且成本只含新增视觉调用", () => {
    const f = fixture(), { plan } = compileNarrationAssetPlan(f);
    expect(AssetPlanV2.parse(plan)).toEqual(plan);
    expect(plan.tasks.some(t => t.task_type === "tts_audio")).toBe(false);
    expect(plan).not.toHaveProperty("tts_plan");
    expect(plan.global_audio_strategy).toEqual({ music: "克制" });
    expect(plan.narration_reference).toEqual(f.narrationTiming.narrationReference);
    expect(plan.cost_summary.estimated_provider_calls).toBe(4);
    const ids = new Set(plan.tasks.map(t => t.task_id));
    expect(plan.dependencies.every(d => ids.has(d.task_id) && ids.has(d.depends_on_task_id))).toBe(true);
  });
  it("视觉摘录、范围和实际duration来自同一边界，保留尾静音", () => {
    const f = fixture(), { plan } = compileNarrationAssetPlan(f);
    for (const segment of f.storyboard.segments) {
      const tasks = plan.tasks.filter(t => t.source_segment_id === segment.segment_id);
      expect(tasks.every(t => t.source_excerpt === segment.script_excerpt)).toBe(true);
      expect(tasks.find(t => t.task_type === "video_clip")!.parameters.duration_sec).toBe((segment.visual_end_ms - segment.visual_start_ms) / 1000);
      expect(plan.narration_intervals.find(x => x.segment_id === segment.segment_id)!.range.visual_end_ms).toBe(segment.visual_end_ms);
    }
    expect(plan.narration_intervals.at(-1)!.range.visual_end_ms).toBe(7000);
  });
  it.each(["text", "hash", "range", "excerpt"])("拒绝不同源 %s", mutation => {
    const f = fixture();
    if (mutation === "text") f.draft.script_text += "。";
    if (mutation === "hash") f.narrationTiming.narrationReference.timing_map_hash = "b".repeat(64);
    if (mutation === "range") f.storyboard.segments[0]!.visual_end_ms += 1;
    if (mutation === "excerpt") f.storyboard.segments[0]!.script_excerpt = "另";
    expect(() => compileNarrationAssetPlan(f)).toThrow();
  });
  it("实际segment prompt投影保留已验证区间和相同excerpt", () => {
    const f = fixture();
    const result = buildSegmentIntentPlannerInput({ chunk_id: "c1", is_first_chunk: true, segments: f.storyboard.segments,
      segment_routes: f.storyboard.segments.map(s => ({ segment_id: s.segment_id, resolved_route: "api_video" as const })), ...f.globalDraft });
    expect(result.segments[0]).toMatchObject({ script_excerpt: f.storyboard.segments[0]!.script_excerpt,
      visual_start_ms: 0, visual_end_ms: 1600, start_boundary_id: f.storyboard.segments[0]!.start_boundary_id });
  });
});

describe("Task9A 真实生成服务", () => {
  it.each([false, true])("每次内部派发复查来源，拒绝第二次派发=%s", async stale => {
    const f = fixture(); let checks = 0;
    const invoke = vi.fn(async (request: any) => request.promptId === "asset-planning.planner" ? { planning_mode: "global", ...f.globalDraft } : f.chunks[0]!.draft);
    const call = generateAssetPlan({ ...f, sourceStoryboardRecordId: "sb-record", sourceScriptRecordId: "s1", sourceTopicPackageId: "t1",
      topicBoundaryContext: { title: "宫门", selected_angle: "对峙", family_label: "历史", scope_label: "事件", core_conflict: "对峙", strong_scene: "推门", forbidden_expansions: [], risk_hints: [], source_anchor_refs: [], canonical_quotes: [], narrative_tension_map: {} },
      llmGateway: { invokeStructuredPrompt: invoke, invokeStrictStructured: vi.fn() },
      beforeDispatch: async () => { checks++; if (stale && checks === 2) throw new Error("narration_stale"); } });
    if (stale) { await expect(call).rejects.toThrow(); expect(invoke).toHaveBeenCalledTimes(1); }
    else {
      const plan = await call;
      expect(plan.plan_version).toBe("asset_plan_v2"); expect(invoke).toHaveBeenCalledTimes(2);
      expect(invoke.mock.calls[0]![0].input).not.toHaveProperty("local_tts_plan");
      expect(invoke.mock.calls[1]![0].input.segments[0]).toMatchObject({ script_excerpt: "汉", visual_end_ms: 1600 });
    }
  });
});

describe("Task9A R1 修复与重试派发补证", () => {
  it.each(["global_repair", "segment_repair", "segment_regeneration", "safety_retry", "concurrent_chunks"])("%s在下一调用前复查来源", async branch => {
    const f = fixture(); let checks = 0;
    const stopAt = branch === "global_repair" || branch === "safety_retry" ? 2 : branch === "segment_regeneration" ? 4 : 3;
    const invoked: string[] = [];
    const invoke = vi.fn(async (request: any) => {
      invoked.push(request.promptId);
      if (request.promptId === "asset-planning.planner") {
        if (branch === "safety_retry") throw Object.assign(new Error("content_filter"), { code: "content_filter" });
        return branch === "global_repair" ? { planning_mode: "global", ...f.globalDraft, art_bible: null } : { planning_mode: "global", ...f.globalDraft };
      }
      if (request.promptId === "asset-planning.segment-intent-repair") return {};
      if (branch === "concurrent_chunks") return { ...f.chunks[0]!.draft, segments: [f.chunks[0]!.draft.segments[0]] };
      const broken = structuredClone(f.chunks[0]!.draft); (broken.segments[0]!.intents[0] as any).image_prompt = ""; return broken;
    });
    await expect(generateAssetPlan({ ...f, sourceStoryboardRecordId: "sb-record", sourceScriptRecordId: "s1", sourceTopicPackageId: "t1",
      topicBoundaryContext: { title: "宫门", selected_angle: "对峙", family_label: "历史", scope_label: "事件", core_conflict: "对峙", strong_scene: "推门", forbidden_expansions: [], risk_hints: [], source_anchor_refs: [], canonical_quotes: [], narrative_tension_map: {} },
      chunkSize: branch === "concurrent_chunks" ? 1 : 3, chunkConcurrency: 2,
      llmGateway: { invokeStructuredPrompt: invoke, invokeStrictStructured: vi.fn() },
      beforeDispatch: async () => { checks++; if (checks >= stopAt) throw new Error("narration_stale"); } })).rejects.toThrow();
    expect(checks).toBe(stopAt); expect(invoke).toHaveBeenCalledTimes(stopAt - 1);
    if (branch === "segment_regeneration") expect(invoked.at(-1)).toBe("asset-planning.segment-intent-repair");
  });
});
