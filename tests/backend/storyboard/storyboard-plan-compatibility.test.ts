import { describe, expect, it } from "vitest";

import { decodeStoredStoryboardPlan } from "../../../backend/src/modules/storyboard/storyboard-plan-compatibility.js";

/**
 * S2-2A 任务 4 步骤 1：历史分镜兼容读取边界测试。
 *
 * 详细设计 6.1 节：
 * - decodeStoredStoryboardPlan 先试正式新 schema，再试隔离的 legacy schema。
 * - 旧 visual_strategy_preference 确定性映射为只读 legacy_hints 投影：
 *   旧 api_video → api_video_strongly_recommended；旧 remotion_motion/空 → remotion_sufficient。
 * - hint 是 decoder 的独立投影，不写入 StoryboardPlan 正式合同。
 */

const legacySegment = {
  segment_id: "sb_001",
  order: 0,
  script_excerpt: "楚王第一次压场时，晏子没有退。",
  start_hint_sec: 0,
  end_hint_sec: 9,
  narrative_role: "opening",
  visual_intent: "让观众先看见公开压场的压力。",
  scene_description: "宫廷中众人注视，晏子站在楚王面前。",
  visual_elements: ["楚王", "晏子", "宫廷"],
  framing_hint: "wide",
  content_type: "live_action",
  motion_hint: "push_in",
  editing_hint: "single",
  on_screen_text: [],
  linked_beats: ["入楚受辱"],
  linked_quotes: [],
  risk_notes: [],
};

function legacyPlan(segments: Array<Record<string, unknown>>) {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: "scr_001",
    source_topic_package_id: "topic_001",
    estimated_total_duration_sec: 90,
    segments,
    global_visual_notes: [],
  };
}

describe("decodeStoredStoryboardPlan legacy compatibility", () => {
  it("decodes a modern plan (with api_video_suitability) as-is with empty legacy hints", () => {
    const modern = legacyPlan([
      { ...legacySegment, api_video_suitability: "api_video_beneficial" },
    ]);
    const decoded = decodeStoredStoryboardPlan(modern);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.plan.segments[0]!.api_video_suitability).toBe("api_video_beneficial");
    // 现代 plan 无 legacy hint
    expect(decoded.value.legacy_hints).toEqual({});
  });

  it("maps legacy api_video to api_video_strongly_recommended hint projection", () => {
    const legacy = legacyPlan([
      { ...legacySegment, visual_strategy_preference: "api_video" },
    ]);
    const decoded = decodeStoredStoryboardPlan(legacy);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // hint 在独立投影中
    expect(decoded.value.legacy_hints["sb_001"]).toBe("api_video_strongly_recommended");
    // 语义提示同步到 suitability（由当前项目策略解析最终路线）
    expect(decoded.value.plan.segments[0]!.api_video_suitability).toBe("api_video_strongly_recommended");
    // 正式 plan 不含 hint 字段
    expect(decoded.value.plan.segments[0]).not.toHaveProperty("legacy_visual_strategy_hint");
    // 输出不含旧字段
    expect(decoded.value.plan.segments[0]).not.toHaveProperty("visual_strategy_preference");
  });

  it("maps legacy remotion_motion and missing values to remotion_sufficient hint", () => {
    const legacy = legacyPlan([
      { ...legacySegment, visual_strategy_preference: "remotion_motion" },
      { ...legacySegment, segment_id: "sb_002", order: 1 },
    ]);
    const decoded = decodeStoredStoryboardPlan(legacy);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.legacy_hints["sb_001"]).toBe("remotion_sufficient");
    expect(decoded.value.legacy_hints["sb_002"]).toBe("remotion_sufficient");
  });

  it("rejects invalid stored plans (neither modern nor legacy)", () => {
    const bad = legacyPlan([
      { ...legacySegment, api_video_suitability: "garbage" },
    ]);
    const decoded = decodeStoredStoryboardPlan(bad);
    expect(decoded.ok).toBe(false);
  });

  it("decoded plan can be re-run through asset planning (no legacy field leaks)", () => {
    const legacy = legacyPlan([
      { ...legacySegment, visual_strategy_preference: "api_video" },
    ]);
    const decoded = decodeStoredStoryboardPlan(legacy);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    // 序列化后不得再出现旧字段或 hint 字段（下游 prompt/合同不受污染）
    const serialized = JSON.stringify(decoded.value.plan);
    expect(serialized).not.toContain("visual_strategy_preference");
    expect(serialized).not.toContain("legacy_visual_strategy_hint");
  });
});
