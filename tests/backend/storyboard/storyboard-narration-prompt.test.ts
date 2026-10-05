import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalStringify, StoryboardPlanV2 } from "../../../shared/src/index.js";
import { normalizeNarrationTiming } from "../../../backend/src/modules/narration/narration-timing-normalizer.js";
import { projectStoryboardTiming } from "../../../backend/src/modules/storyboard/storyboard-timing-projector.js";
import { buildStoryboardPlannerPromptInput, generateStoryboardPlan, regenerateSingleSegment } from "../../../backend/src/modules/storyboard/storyboard-generation.service.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

function fixture() {
  const text = "汉".repeat(18), audioHash = "a".repeat(64);
  const timingMap = normalizeNarrationTiming({ sourceText: text, audioHash, durationMs: 4500,
    sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text,
      words: Array.from(text, (text, i) => ({ text, begin_index: i, end_index: i + 1, begin_time: i * 250, end_time: (i + 1) * 250 })) }] });
  const narrationReference = { narration_record_id: "n1", audio_hash: audioHash,
    timing_map_hash: createHash("sha256").update(canonicalStringify(timingMap)).digest("hex"), duration_ms: 4500 };
  const visual = { narrative_role: "opening", visual_intent: "宫门", scene_description: "宫门", visual_elements: ["门"], framing_hint: "wide",
    content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_only" };
  const raw = { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [],
    segments: [0, 6].map((start, i) => ({ ...visual, segment_id: "sb" + i, order: i,
      start_boundary_id: timingMap.boundaries[start]!.id, end_boundary_id: timingMap.boundaries[i ? 18 : 6]!.id })) };
  const input = { sourceScriptRecordId: "s1", sourceTopicPackageId: "t1", narrationTiming: { timingMap, narrationReference },
    draft: { script_text: text, estimated_duration_sec: 99, opening_span: text, ending_span: text, beat_trace: [], quote_trace: [] },
    topicBoundaryContext: { title: "宫门", selected_angle: "对峙", core_conflict: "对峙", strong_scene: "宫门", forbidden_expansions: [], risk_hints: [], source_anchor_refs: [], canonical_quotes: [], narrative_tension_map: {} } };
  return { input, raw };
}

describe("Task8 规划前已知真实口播", () => {
  it("输入原文、候选切点编号与冻结身份，首尾切点不丢失", () => {
    const { input } = fixture(); const p = buildStoryboardPlannerPromptInput(input) as any;
    expect(p.narration_timing.narrationReference).toEqual(input.narrationTiming.narrationReference);
    expect(p.narration_timing.timingMap.boundaries).toBeUndefined();
    const candidates = p.narration_timing.timingMap.boundary_candidates;
    expect(Array.isArray(candidates)).toBe(true);
    // 18 字无标点无停顿 → 粗筛不足 3 个回退全量（19 个边界），编号连续
    expect(candidates).toHaveLength(19);
    expect(candidates[0]).toMatchObject({ id: "C1", boundary_id: "boundary:0:0", visual_time_ms: 0 });
    expect(candidates[6]).toMatchObject({ id: "C7", boundary_id: "boundary:1500:6", visual_time_ms: 1500 });
    expect(candidates.at(-1)).toMatchObject({ id: "C19", boundary_id: "boundary:4500:18" });
  });
  it("v2选择真实边界，不读取估时重算，原始timing保持不变", async () => {
    const { input, raw } = fixture(); const before = canonicalStringify(input.narrationTiming.timingMap);
    let estimateReads = 0; Object.defineProperty(input.draft, "estimated_duration_sec", { get() { estimateReads++; return 99; } });
    const gateway = { invokeStructuredPrompt: vi.fn().mockResolvedValue(raw) } as any;
    const plan = await generateStoryboardPlan({ ...input, llmGateway: gateway });
    expect(estimateReads).toBe(0); expect(plan.segments[0]!.end_hint_sec).toBe(1.5);
    expect(StoryboardPlanV2.safeParse(plan).success).toBe(true);
    expect(canonicalStringify(input.narrationTiming.timingMap)).toBe(before);
  });
  it("stub同样输出经过真实边界投影的v2", async () => {
    const { input } = fixture(); const plan = await generateStoryboardPlan(input);
    expect(StoryboardPlanV2.safeParse(plan).success).toBe(true); expect(plan.estimated_total_duration_sec).toBe(4.5);
  });
  it.each(["text", "hash"])("%s来源错误必须先于LLM拒绝", async mode => {
    const { input, raw } = fixture(); if (mode === "text") input.draft.script_text = "错误";
    else input.narrationTiming.narrationReference.timing_map_hash = "b".repeat(64);
    const gateway = { invokeStructuredPrompt: vi.fn().mockResolvedValue(raw) } as any;
    await expect(generateStoryboardPlan({ ...input, llmGateway: gateway })).rejects.toThrow();
    expect(gateway.invokeStructuredPrompt).not.toHaveBeenCalled();
  });
  it("单镜只接受视觉改动，来源/边界/毫秒/摘录保持", async () => {
    const { input, raw } = fixture(); const plan = projectStoryboardTiming({ ...input.narrationTiming, plan: raw });
    const original = plan.segments[0]!; const gateway = { invokeStructuredPrompt: vi.fn().mockResolvedValue({ ...original,
      visual_intent: "新的画面", script_excerpt: "错稿", start_boundary_id: "wrong", source_start: 999, visual_start_ms: 999, start_hint_sec: 99 }) } as any;
    const result = await regenerateSingleSegment({ plan, targetSegmentId: original.segment_id, userFeedback: "换个画面",
      narrationTiming: input.narrationTiming, llmGateway: gateway });
    expect(result).toEqual({ ...original, visual_intent: "新的画面" });
    expect((gateway.invokeStructuredPrompt.mock.calls[0]![0] as any).input.narration_timing).toEqual(input.narrationTiming);
  });
  it("两份正式prompt中文元数据和v2边界说明同步", () => {
    const registry = createPromptRegistry();
    for (const name of ["storyboard.planner", "storyboard.segment-regen"]) {
      const p = registry.getPrompt(name); expect(p.metadata.language).toBe("zh-CN"); expect(p.body).toContain("storyboard_v2"); expect(p.body).toContain("start_boundary_id");
    }
    const planner = registry.getPrompt("storyboard.planner");
    expect(planner.body).toContain("boundary_candidates");
    expect(planner.body).toContain("候选编号");
    expect(planner.body).toContain("编号必须原样使用");
    expect(planner.body).toContain("storyboard_narration_plan_invalid");
    expect(planner.body).toContain("不能输出规定之外的字段");
    expect(planner.body).toContain("api_video_suitability");
    expect(planner.body).toContain("当前段口播的主要事件");
    expect(planner.body).toContain("不能提前演出后文结果或用下一事件替代当前事件");
    expect(planner.body).toContain("完整称谓、语义和动作边界");
    expect(planner.metadata.version).toBe("v1.6.0");
  });
});

it.each(["script", "topic", "boundary"])("模型输出%s来源冲突不接受", async mode => {
  const { input, raw } = fixture();
  if (mode === "script") raw.source_script_record_id = "other";
  if (mode === "topic") raw.source_topic_package_id = "other";
  if (mode === "boundary") raw.segments[0]!.end_boundary_id = "unknown";
  await expect(generateStoryboardPlan({ ...input, llmGateway: { invokeStructuredPrompt: vi.fn().mockResolvedValue(raw) } as any }))
    .rejects.toMatchObject({ code: "storyboard_narration_plan_invalid" });
});
it("v2单镜缺少来源上下文在LLM前拒绝", async () => {
  const { input, raw } = fixture(), plan = projectStoryboardTiming({ ...input.narrationTiming, plan: raw });
  const gateway = { invokeStructuredPrompt: vi.fn() } as any;
  await expect(regenerateSingleSegment({ plan, targetSegmentId: "sb0", userFeedback: "换画面", llmGateway: gateway })).rejects.toThrow();
  expect(gateway.invokeStructuredPrompt).not.toHaveBeenCalled();
});
