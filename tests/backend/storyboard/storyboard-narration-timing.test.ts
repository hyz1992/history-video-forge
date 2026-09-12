import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { canonicalStringify, StoryboardPlan, type ScriptDraftPackage } from "../../../shared/src/index.js";
import { normalizeNarrationTiming } from "../../../backend/src/modules/narration/narration-timing-normalizer.js";
import { decodeStoredStoryboardPlan } from "../../../backend/src/modules/storyboard/storyboard-plan-compatibility.js";
import { validateStoryboardPlan } from "../../../backend/src/modules/storyboard/storyboard-local-validator.js";

const hash = (value: unknown) => createHash("sha256").update(canonicalStringify(value)).digest("hex");
const audioHash = "a".repeat(64);
function fixture(text = "汉".repeat(18)) {
  const timingMap = normalizeNarrationTiming({ sourceText: text, audioHash, durationMs: text.length * 250,
    sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text,
      words: Array.from(text, (text, i) => ({ text, begin_index: i, end_index: i + 1, begin_time: i * 250, end_time: (i + 1) * 250 })) }] });
  return { timingMap, narrationReference: { narration_record_id: "n1", audio_hash: audioHash,
    timing_map_hash: hash(timingMap), duration_ms: timingMap.durationMs } };
}
const visual = { narrative_role: "opening", visual_intent: "宫门", scene_description: "宫门", visual_elements: ["门"],
  framing_hint: "wide", content_type: "live_action", motion_hint: "static", editing_hint: "single",
  on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_only" };
function input(f = fixture(), cuts = [0, 6, 18]) {
  return { ...f, plan: { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1",
    global_visual_notes: [], segments: cuts.slice(0, -1).map((start, i) => ({ ...visual, segment_id: "s" + i, order: i,
      start_boundary_id: f.timingMap.boundaries[start]!.id, end_boundary_id: f.timingMap.boundaries[cuts[i + 1]!]!.id })) } };
}
async function api() { return import("../../../backend/src/modules/storyboard/storyboard-timing-projector.js"); }
function draft(text: string): ScriptDraftPackage { return { script_text: text, estimated_duration_sec: 5,
  opening_span: text, ending_span: text, beat_trace: [], quote_trace: [] }; }

describe("Task7 同一合法边界派生时间与摘录", () => {
  it("18个250ms字在第6字后切到1500ms，保留raw hash，正式联合及decoder读取v2", async () => {
    const f = fixture(), before = hash(f.timingMap); const p = (await api()).projectStoryboardTiming(input(f));
    expect(p.segments.map(s => [s.visual_start_ms, s.visual_end_ms, s.source_start, s.source_end, s.script_excerpt])).toEqual([
      [0, 1500, 0, 6, "汉".repeat(6)], [1500, 4500, 6, 18, "汉".repeat(12)]]);
    expect(hash(f.timingMap)).toBe(before); expect(StoryboardPlan.safeParse(p).success).toBe(true);
    expect(decodeStoredStoryboardPlan(p).ok).toBe(true);
  });
  it("250ms镜头不被延长，重复文本由boundary来源范围定位", async () => {
    const f = fixture("甲乙甲乙"); const p = (await api()).projectStoryboardTiming(input(f, [0, 1, 2, 4]));
    expect(p.segments.map(s => [s.start_hint_sec, s.end_hint_sec, s.script_excerpt])).toEqual([[0, .25, "甲"], [.25, .5, "乙"], [.5, 1, "甲乙"]]);
    expect(validateStoryboardPlan({ draft: draft(f.timingMap.sourceText), plan: p, narrationTiming: f }).decision).toBe("pass");
  });
  it("首尾静音及句间停顿归视觉范围，不改原token时间", async () => {
    const timingMap = normalizeNarrationTiming({ sourceText: "甲，乙。", audioHash, durationMs: 4000,
      sentences: [{ providerSentenceIndex: 0, originalText: "甲，乙。", normalizedText: "甲，乙。", words: [
        { text: "甲，", begin_index: 0, end_index: 1, begin_time: 200, end_time: 1100 },
        { text: "乙。", begin_index: 1, end_index: 2, begin_time: 2400, end_time: 3600 }] }] });
    const f = { timingMap, narrationReference: { narration_record_id: "n1", audio_hash: audioHash, timing_map_hash: hash(timingMap), duration_ms: 4000 } };
    const p = (await api()).projectStoryboardTiming(input(f, [0, 1, 2]));
    expect(p.segments.map(s => [s.visual_start_ms, s.visual_end_ms, s.script_excerpt])).toEqual([[0, 2400, "甲，"], [2400, 4000, "乙。"]]);
    expect(timingMap.tokens.map(t => [t.startMs, t.endMs])).toEqual([[200, 1100], [2400, 3600]]);
  });
  it.each(["audio_hash", "timing_map_hash", "duration_ms"])("来源%s不一致拒绝", async field => {
    const value = input(); (value.narrationReference as any)[field] = field === "duration_ms" ? 1 : "b".repeat(64);
    const a = await api(); expect(() => a.projectStoryboardTiming(value)).toThrow();
  });
  it.each(["unknown", "gap", "repeat", "reverse"])("非法边界组合%s拒绝", async mode => {
    const value = input(); const s = value.plan.segments;
    if (mode === "unknown") s[0]!.end_boundary_id = "inside_unsplittable_span";
    if (mode === "gap") s[1]!.start_boundary_id = value.timingMap.boundaries[7]!.id;
    if (mode === "repeat") s[1]!.start_boundary_id = value.timingMap.boundaries[5]!.id;
    if (mode === "reverse") s[0]!.end_boundary_id = s[0]!.start_boundary_id;
    const a = await api(); expect(() => a.projectStoryboardTiming(value)).toThrow();
  });
  it("双分区时间ABC/DEF、摘录AB/CDEF不能以全文覆盖冒充一致", async () => {
    const f = fixture("甲乙丙丁戊己"), a = await api(), p = a.projectStoryboardTiming(input(f, [0, 3, 6]));
    p.segments[0]!.script_excerpt = "甲乙"; p.segments[1]!.script_excerpt = "丙丁戊己";
    expect(() => a.validateStoryboardTiming(p, f)).toThrow();
    expect(validateStoryboardPlan({ draft: draft(f.timingMap.sourceText), plan: p, narrationTiming: f }).decision).toBe("regen_once");
  });
  it("即使总长相同，持久化来源offset与boundary不一致仍拒绝", async () => {
    const f = fixture(), a = await api(), p = a.projectStoryboardTiming(input(f));
    p.segments[0]!.source_end = 5; p.segments[0]!.script_excerpt = "汉".repeat(5);
    p.segments[1]!.source_start = 5; p.segments[1]!.script_excerpt = "汉".repeat(13);
    expect(() => a.validateStoryboardTiming(p, f)).toThrow();
  });
  it("v2缺来源上下文、缺引用、正文变动均拒绝，不回落v1", async () => {
    const f = fixture(), p = (await api()).projectStoryboardTiming(input(f));
    expect(validateStoryboardPlan({ draft: draft(f.timingMap.sourceText), plan: p }).decision).toBe("regen_once");
    expect(validateStoryboardPlan({ draft: draft("乙".repeat(18)), plan: p, narrationTiming: f }).decision).toBe("regen_once");
    const broken = { ...p }; delete (broken as any).narration_reference;
    expect(StoryboardPlan.safeParse(broken).success).toBe(false); expect(decodeStoredStoryboardPlan(broken).ok).toBe(false);
  });
  it("兼容输入携带错误摘录或自定hint时拒绝", async () => {
    const a = await api();
    for (const patch of [{ script_excerpt: "错误" }, { start_hint_sec: 1 }, { visual_end_ms: 1 }]) {
      const value = input(); Object.assign(value.plan.segments[0]!, patch); expect(() => a.projectStoryboardTiming(value)).toThrow();
    }
  });
});

it("共享source span内即使存在raw token端点也不能切", async () => {
  const timingMap = normalizeNarrationTiming({ sourceText: "12甲", audioHash, durationMs: 900,
    sentences: [{ providerSentenceIndex: 0, originalText: "12甲", normalizedText: "十二甲", words: [
      { text: "十", begin_index: 0, end_index: 1, begin_time: 0, end_time: 300 },
      { text: "二", begin_index: 1, end_index: 2, begin_time: 300, end_time: 600 },
      { text: "甲", begin_index: 2, end_index: 3, begin_time: 600, end_time: 900 }] }] });
  expect(timingMap.boundaries.map(b => b.visualTimeMs)).toEqual([0, 600, 900]);
  const f = { timingMap, narrationReference: { narration_record_id: "n1", audio_hash: audioHash, timing_map_hash: hash(timingMap), duration_ms: 900 } };
  const value = input(f, [0, 1, 2]), a = await api();
  expect(a.projectStoryboardTiming(value).segments[0]!.script_excerpt).toBe("12");
  value.plan.segments[0]!.end_boundary_id = "boundary:300:1";
  expect(() => a.projectStoryboardTiming(value)).toThrow();
});
it.each(["token", "boundary", "missing_tail", "duplicate_id"])("完整来源与覆盖验证：%s", async mode => {
  const value = input(), a = await api();
  if (mode === "token") { value.timingMap.tokens[0]!.endMs = 999; value.narrationReference.timing_map_hash = hash(value.timingMap); }
  if (mode === "boundary") { value.timingMap.boundaries[6]!.visualTimeMs = 1499; value.narrationReference.timing_map_hash = hash(value.timingMap); }
  if (mode === "missing_tail") value.plan.segments.pop();
  if (mode === "duplicate_id") value.plan.segments[1]!.segment_id = value.plan.segments[0]!.segment_id;
  expect(() => a.projectStoryboardTiming(value)).toThrow();
});

describe("边界ID数字漂移唯一最近吸附", () => {
  it("无效ID吸附到唯一最近边界，派生与摘录保持一致", async () => {
    const f = fixture(), value = input(f, [0, 6, 18]);
    value.plan.segments[0]!.end_boundary_id = "boundary:1520:6"; // 最近真实边界 1500
    const p = (await api()).projectStoryboardTiming(value);
    expect(p.segments[0]).toMatchObject({ visual_end_ms: 1500, source_end: 6, script_excerpt: "汉".repeat(6) });
    expect(p.segments[1]).toMatchObject({ visual_start_ms: 1500, source_start: 6 });
  });
  it("相邻镜头共用同一无效ID吸附到同一边界，链式保持", async () => {
    const f = fixture(), value = input(f, [0, 6, 18]);
    value.plan.segments[0]!.end_boundary_id = "boundary:1520:6";
    value.plan.segments[1]!.start_boundary_id = "boundary:1520:6";
    const p = (await api()).projectStoryboardTiming(value);
    expect(p.segments.map(s => [s.visual_start_ms, s.visual_end_ms])).toEqual([[0, 1500], [1500, 4500]]);
    // 持久化存解析后的真实边界 ID，不是原始无效 ID
    expect(p.segments[0]!.end_boundary_id).toBe("boundary:1500:6");
    expect(p.segments[1]!.start_boundary_id).toBe("boundary:1500:6");
  });
  it("等距歧义、超限与不可解析ID仍拒绝", async () => {
    const a = await api();
    const tie = input(); tie.plan.segments[0]!.end_boundary_id = "boundary:375:1"; // 250 与 500 等距
    expect(() => a.projectStoryboardTiming(tie)).toThrow();
    const far = input(); far.plan.segments[0]!.end_boundary_id = "boundary:9000:20"; // 超 500ms 上限
    expect(() => a.projectStoryboardTiming(far)).toThrow();
    const malformed = input(); malformed.plan.segments[0]!.end_boundary_id = "cut_here";
    expect(() => a.projectStoryboardTiming(malformed)).toThrow();
  });
  it("吸附结果满足正式合同并可被持久化校验通过", async () => {
    const f = fixture(), value = input(f, [0, 6, 18]);
    value.plan.segments[0]!.end_boundary_id = "boundary:1520:6";
    const a = await api(), p = a.projectStoryboardTiming(value);
    expect(a.validateStoryboardTiming(p, f).segments).toHaveLength(2);
  });
  it("时间倒流抛结构化违反信息", async () => {
    const a = await api();
    const value = input(); value.plan.segments[1]!.end_boundary_id = value.timingMap.boundaries[0]!.id;
    try { a.projectStoryboardTiming(value); throw new Error("should throw"); }
    catch (e) {
      expect(e).toBeInstanceOf(a.StoryboardBoundaryError);
      expect((e as { violations: string[] }).violations.join("")).toContain("时间倒流");
    }
  });
  it("链式断裂与不可吸附 ID 同样给出具体违反信息", async () => {
    const a = await api();
    const gap = input(); gap.plan.segments[1]!.start_boundary_id = gap.timingMap.boundaries[7]!.id;
    try { a.projectStoryboardTiming(gap); throw new Error("should throw"); }
    catch (e) { expect((e as { violations: string[] }).violations.join("")).toContain("不连续"); }
    const unknown = input(); unknown.plan.segments[0]!.end_boundary_id = "inside_unsplittable_span";
    try { a.projectStoryboardTiming(unknown); throw new Error("should throw"); }
    catch (e) { expect((e as { violations: string[] }).violations.join("")).toContain("无法唯一就近吸附"); }
  });
  it("吸附到与起点相同边界导致零时长仍拒绝", async () => {
    const f = fixture(), value = input(f, [0, 6, 18]);
    value.plan.segments[0]!.end_boundary_id = "boundary:100:1"; // 最近真实边界是起点 0
    expect(() => (async () => (await api()).projectStoryboardTiming(value))()).rejects.toThrow();
  });
  it("阈值边界：Δ=500 吸附、Δ=501 拒绝", async () => {
    const f = sparseFixture([0, 1000, 2500, 3500]), a = await api();
    const accept = { ...f, plan: { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [], segments: [{ ...visual, segment_id: "s0", order: 0, start_boundary_id: "boundary:0:0", end_boundary_id: "boundary:1500:1" }, { ...visual, segment_id: "s1", order: 1, start_boundary_id: "boundary:1500:1", end_boundary_id: f.timingMap.boundaries.at(-1)!.id }] } };
    expect(a.projectStoryboardTiming(accept).segments[0]!.end_boundary_id).toBe("boundary:1000:1");
    const reject = { ...f, plan: { ...accept.plan, segments: [{ ...accept.plan.segments[0]!, end_boundary_id: "boundary:1501:1" }, { ...accept.plan.segments[1]!, start_boundary_id: "boundary:1501:1" }] } };
    expect(() => a.projectStoryboardTiming(reject)).toThrow();
  });
  it("复刻真实失败工件的三个漂移ID吸附", async () => {
    // 2026-09-12 玄武门项目 planner 输出的无效 ID 与真实边界邻域一致
    const f = sparseFixture([0, 2880, 3040, 3520, 3760, 19360, 19600, 19840, 64800, 65040, 65840, 70000]);
    const last = f.timingMap.boundaries.at(-1)!.id;
    const plan = { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [], segments: [
      { ...visual, segment_id: "s0", order: 0, start_boundary_id: "boundary:0:0", end_boundary_id: "boundary:3360:17" },
      { ...visual, segment_id: "s1", order: 1, start_boundary_id: "boundary:3360:17", end_boundary_id: "boundary:19280:82" },
      { ...visual, segment_id: "s2", order: 2, start_boundary_id: "boundary:19280:82", end_boundary_id: "boundary:65360:313" },
      { ...visual, segment_id: "s3", order: 3, start_boundary_id: "boundary:65360:313", end_boundary_id: last }] };
    const p = (await api()).projectStoryboardTiming({ ...f, plan });
    expect(p.segments.map(s => s.end_boundary_id)).toEqual(["boundary:3520:3", "boundary:19360:5", "boundary:65040:9", last]);
    expect(p.segments[0]!.script_excerpt).toBe("汉".repeat(3));
  });
  it("吸附报告截断在 8 条内且不影响成功", async () => {
    const f = fixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cuts = [0, 6, 18];
      const value = { ...f, plan: { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [], segments: cuts.slice(0, -1).map((start, i) => ({ ...visual, segment_id: "s" + i, order: i, start_boundary_id: i === 0 ? f.timingMap.boundaries[start]!.id : "boundary:" + (start * 250 + 100) + ":" + start, end_boundary_id: "boundary:" + ((cuts[i + 1]!) * 250 + 100) + ":" + cuts[i + 1]! })) } };
      const p = (await api()).projectStoryboardTiming(value);
      expect(p.segments).toHaveLength(2);
      const snapCalls = warn.mock.calls.filter(c => String(c[0]).startsWith("[storyboard-boundary-snap]"));
      expect(snapCalls).toHaveLength(1);
      expect((JSON.parse(String(snapCalls[0]![1])) as unknown[]).length).toBeLessThanOrEqual(8);
    } finally { warn.mockRestore(); }
  });
});

/** 自定义词级时间的稀疏边界夹具：每个字一个词，边界落在每个词起点。 */
function sparseFixture(starts: number[]) {
  const text = "汉".repeat(starts.length);
  const audioHash = "a".repeat(64);
  const words = starts.map((start, i) => ({ text: "汉", begin_index: i, end_index: i + 1, begin_time: start, end_time: i + 1 < starts.length ? starts[i + 1]! : start + 1000 }));
  const durationMs = starts.at(-1)! + 1000;
  const timingMap = normalizeNarrationTiming({ sourceText: text, audioHash, durationMs, sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text, words }] });
  return { timingMap, narrationReference: { narration_record_id: "n1", audio_hash: audioHash, timing_map_hash: hash(timingMap), duration_ms: durationMs } };
}
