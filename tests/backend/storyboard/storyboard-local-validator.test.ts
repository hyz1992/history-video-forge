import { describe, expect, it } from "vitest";

import type {
  ScriptDraftPackage,
  StoryboardPlan,
} from "../../../shared/src/index.js";
import { validateStoryboardPlan } from "../../../backend/src/modules/storyboard/storyboard-local-validator.js";

function makeDraft(): ScriptDraftPackage {
  const scriptText =
    "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。第二次，楚王又说齐国没人，才派这样的人来。晏子没有急着争辩，只把规矩一句句摆回去。最后，楚国拿齐人盗窃来羞辱齐国。晏子用橘生淮南则为橘，把第三次压场顶回楚王脸上。";

  return {
    script_text: scriptText,
    estimated_duration_sec: 70,
    beat_trace: [
      {
        beat: "狗门羞辱",
        excerpt: "那扇为羞辱他而开的矮门",
        confidence: 0.92,
      },
      {
        beat: "齐国无人",
        excerpt: "楚王又说齐国没人",
        confidence: 0.9,
      },
      {
        beat: "橘枳之喻",
        excerpt: "橘生淮南则为橘",
        confidence: 0.96,
      },
    ],
    quote_trace: [
      {
        quote: "橘生淮南则为橘",
        usage_type: "exact",
        excerpt: "橘生淮南则为橘",
      },
    ],
    opening_span: "楚王第一次压场时，晏子没有退。",
    ending_span: "把第三次压场顶回楚王脸上。",
  };
}

function makePlan(overrides: Partial<StoryboardPlan> = {}): StoryboardPlan {
  const draft = makeDraft();
  const base: StoryboardPlan = {
    plan_version: "storyboard_v1",
    source_script_record_id: "scr_001",
    source_topic_package_id: "topic_001",
    estimated_total_duration_sec: draft.estimated_duration_sec,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt:
          "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。",
        start_hint_sec: 0,
        end_hint_sec: 18,
        narrative_role: "opening",
        visual_intent: "让观众看见公开羞辱已经落到晏子身上。",
        scene_description: "楚国殿前，矮门和众人的目光形成压迫。",
        visual_elements: ["楚王", "晏子", "矮门"],
        framing_hint: "wide",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: ["第一次压场"],
        linked_beats: ["狗门羞辱"],
        linked_quotes: [],
        risk_notes: [],
      },
      {
        segment_id: "sb_002",
        order: 1,
        script_excerpt:
          "第二次，楚王又说齐国没人，才派这样的人来。晏子没有急着争辩，只把规矩一句句摆回去。",
        start_hint_sec: 18,
        end_hint_sec: 40,
        narrative_role: "pressure",
        visual_intent: "让观众看见羞辱从个人升到齐国。",
        scene_description: "殿上对峙，晏子用礼制把话压回去。",
        visual_elements: ["楚王", "晏子", "群臣"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "static",
        editing_hint: "cutaway",
        on_screen_text: [],
        linked_beats: ["齐国无人"],
        linked_quotes: [],
        risk_notes: [],
      },
      {
        segment_id: "sb_003",
        order: 2,
        script_excerpt:
          "最后，楚国拿齐人盗窃来羞辱齐国。晏子用橘生淮南则为橘，把第三次压场顶回楚王脸上。",
        start_hint_sec: 40,
        end_hint_sec: 70,
        narrative_role: "ending",
        visual_intent: "让观众看见第三次压场被原样顶回去。",
        scene_description: "橘与枳的对照压过殿上的嘲笑。",
        visual_elements: ["橘", "晏子", "楚王"],
        framing_hint: "close",
        content_type: "illustration",
        motion_hint: "pull_back",
        editing_hint: "montage",
        on_screen_text: ["橘生淮南则为橘"],
        linked_beats: ["橘枳之喻"],
        linked_quotes: ["橘生淮南则为橘"],
        risk_notes: [],
      },
    ],
    global_visual_notes: [],
  };

  return { ...base, ...overrides };
}

describe("validateStoryboardPlan", () => {
  it("passes a structurally valid storyboard plan", () => {
    const result = validateStoryboardPlan({
      draft: makeDraft(),
      plan: makePlan(),
    });

    expect(result.decision).toBe("pass");
    expect(result.errors).toEqual([]);
    expect(result.metrics.segment_count).toBe(3);
  });

  it("reports non-contiguous segment order", () => {
    const plan = makePlan({
      segments: makePlan().segments.map((segment, index) =>
        index === 1 ? { ...segment, order: 3 } : segment,
      ),
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.decision).toBe("regen_once");
    expect(result.errors).toContain("storyboard_segment_order_invalid");
  });

  it("reports invalid timing", () => {
    const plan = makePlan({
      segments: makePlan().segments.map((segment, index) =>
        index === 1
          ? { ...segment, start_hint_sec: 39, end_hint_sec: 30 }
          : segment,
      ),
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.errors).toContain("storyboard_timing_invalid");
  });

  it("reports excerpts that are not in the script", () => {
    const plan = makePlan({
      segments: makePlan().segments.map((segment, index) =>
        index === 0 ? { ...segment, script_excerpt: "脚本里没有这句话。" } : segment,
      ),
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.errors).toContain("storyboard_excerpt_not_in_script");
    expect(result.errors).not.toContain("storyboard_script_coverage_too_low");
  });

  it("reports excerpt order or overlap problems", () => {
    const segments = makePlan().segments;
    const plan = makePlan({
      segments: [segments[1], segments[0], segments[2]].map((segment, order) => ({
        ...segment,
        order,
      })),
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.errors).toContain("storyboard_excerpt_order_invalid");
  });

  it("reports low script coverage", () => {
    const [first, , last] = makePlan().segments;
    const plan = makePlan({
      segments: [
        first,
        {
          ...last,
          order: 1,
          start_hint_sec: 18,
          end_hint_sec: 30,
        },
      ],
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.errors).toContain("storyboard_script_coverage_too_low");
  });

  it("reports missing opening and ending coverage", () => {
    const segments = makePlan().segments;
    const noOpening = validateStoryboardPlan({
      draft: makeDraft(),
      plan: makePlan({
        segments: segments.slice(1).map((segment, order) => ({
          ...segment,
          order,
        })),
      }),
    });
    const noEnding = validateStoryboardPlan({
      draft: makeDraft(),
      plan: makePlan({
        segments: segments.slice(0, 1),
      }),
    });

    expect(noOpening.errors).toContain("storyboard_opening_not_covered");
    expect(noEnding.errors).toContain("storyboard_ending_not_covered");
  });

  it("reports invalid trace references and missing upstream trace coverage", () => {
    const plan = makePlan({
      segments: makePlan().segments.map((segment, index) => {
        if (index === 0) {
          return { ...segment, linked_beats: ["不存在的 beat"] };
        }
        if (index === 2) {
          return { ...segment, linked_quotes: [] };
        }
        return segment;
      }),
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.errors).toContain("storyboard_trace_ref_invalid");
    expect(result.errors).toContain("storyboard_trace_coverage_missing");
  });

  it("reports empty visual intent or scene description", () => {
    const plan = makePlan({
      segments: makePlan().segments.map((segment, index) =>
        index === 1
          ? { ...segment, visual_intent: "", scene_description: "   " }
          : segment,
      ),
    });

    const result = validateStoryboardPlan({ draft: makeDraft(), plan });

    expect(result.errors).toContain("storyboard_empty_visual_description");
  });

  it("accepts excerpt whose only diff is half/full-width comma and emits drift warning", () => {
    // 真实事故：LLM 在 script_text 中混用了 ASCII 半角逗号,
    // storyboard segment excerpt 又把它修正成中文全角逗号，
    // 严格 indexOf 失败 → storyboard_excerpt_not_in_script → regen 后仍失败 → 整个 stage 卡死。
    // 这里复刻该场景：仅一个标点不一致，应被归一化软匹配命中，并降级为 drift warning。
    const draft = makeDraft();
    const plan = makePlan();

    // 把 sb_002 excerpt 中的 "楚王又说齐国没人，才派" 中间的全角逗号替换为半角，
    // 而 scriptText 里仍是全角逗号，模拟 LLM 输出标点风格漂移。
    const seg002 = plan.segments[1];
    const driftedExcerpt = seg002.script_excerpt.replace("，才派", ",才派");
    expect(driftedExcerpt).not.toBe(seg002.script_excerpt);

    const driftedPlan = {
      ...plan,
      segments: plan.segments.map((segment, index) =>
        index === 1 ? { ...segment, script_excerpt: driftedExcerpt } : segment,
      ),
    };

    const result = validateStoryboardPlan({ draft, plan: driftedPlan });

    expect(result.errors).not.toContain("storyboard_excerpt_not_in_script");
    expect(
      result.warnings.some((w) => w.startsWith("storyboard_excerpt_drift:sb_002")),
    ).toBe(true);
    // 不应再因为单一标点漂移触发 regen
    expect(result.decision).toBe("pass");
  });

  it("accepts excerpt with quote-boundary punctuation drift", () => {
    const draft = makeDraft();
    const draftWithQuote = {
      ...draft,
      script_text: draft.script_text.replace(
        "橘生淮南则为橘",
        "“橘生淮南则为橘”",
      ),
    };
    const plan = makePlan({
      segments: makePlan().segments.map((segment) =>
        segment.linked_quotes.includes("橘生淮南则为橘")
          ? {
              ...segment,
              // excerpt 没有引号，但 script_text 加了中文左右引号，应仍归一化命中
              script_excerpt: segment.script_excerpt,
            }
          : segment,
      ),
    });

    const result = validateStoryboardPlan({ draft: draftWithQuote, plan });

    expect(result.errors).not.toContain("storyboard_excerpt_not_in_script");
  });
});
