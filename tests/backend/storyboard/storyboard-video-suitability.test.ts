import { describe, expect, it } from "vitest";

import { ApiVideoSuitability, StoryboardPlan, StoryboardSegment } from "../../../shared/src/index.js";

/**
 * S2-2A 任务 4 步骤 1：分镜视频适配度合同测试。
 *
 * 详细设计 6.1 节：
 * - StoryboardSegment 用 api_video_suitability 取代 visual_strategy_preference。
 * - 四档适配度必须逐段存在，LLM/stub 都不能留空。
 * - 适配度只描述"静态图+Remotion 是否足够表达动作因果"，不决定付费调用。
 */
describe("storyboard api_video_suitability contract", () => {
  const validSegment = {
    segment_id: "sb_001",
    order: 0,
    script_excerpt: "楚王第一次压场时，晏子没有退。",
    start_hint_sec: 0,
    end_hint_sec: 9,
    narrative_role: "opening" as const,
    visual_intent: "让观众先看见公开压场的压力。",
    scene_description: "宫廷中众人注视，晏子站在楚王面前。",
    visual_elements: ["楚王", "晏子", "宫廷"],
    framing_hint: "wide" as const,
    content_type: "live_action" as const,
    motion_hint: "push_in" as const,
    editing_hint: "single" as const,
    on_screen_text: [],
    linked_beats: ["入楚受辱"],
    linked_quotes: [],
    risk_notes: [],
  };

  it("requires api_video_suitability on every segment (four levels)", () => {
    for (const suitability of [
      "remotion_only",
      "remotion_sufficient",
      "api_video_beneficial",
      "api_video_strongly_recommended",
    ] as const) {
      const parsed = StoryboardSegment.parse({ ...validSegment, api_video_suitability: suitability });
      expect(parsed.api_video_suitability).toBe(suitability);
    }
  });

  it("rejects a segment without api_video_suitability", () => {
    expect(() => StoryboardSegment.parse(validSegment)).toThrow();
  });

  it("rejects invalid suitability values", () => {
    for (const bad of ["api_video", "remotion", "", "STRONGLY_RECOMMENDED"]) {
      expect(() => StoryboardSegment.parse({ ...validSegment, api_video_suitability: bad })).toThrow();
    }
  });

  it("no longer accepts the legacy visual_strategy_preference field (strict)", () => {
    expect(() =>
      StoryboardSegment.parse({ ...validSegment, api_video_suitability: "remotion_sufficient", visual_strategy_preference: "api_video" }),
    ).toThrow();
  });

  it("stub-generated plan must carry suitability on every segment", () => {
    // stub 确定性生成（storyboard-generation.service.ts buildDeterministicStoryboardPlan）
    // 必须为每个 segment 提供四档适配度，不能留空。
    const plan = StoryboardPlan.parse({
      plan_version: "storyboard_v1",
      source_script_record_id: "scr_001",
      source_topic_package_id: "topic_001",
      estimated_total_duration_sec: 90,
      segments: [
        { ...validSegment, api_video_suitability: "remotion_sufficient" },
        {
          ...validSegment,
          segment_id: "sb_002",
          order: 1,
          script_excerpt: "橘生淮南则为橘。",
          start_hint_sec: 9,
          end_hint_sec: 18,
          linked_beats: ["橘淮之辩"],
          api_video_suitability: "api_video_strongly_recommended",
        },
      ],
      global_visual_notes: [],
    });
    expect(plan.segments.every((s) => ApiVideoSuitability.safeParse(s.api_video_suitability).success)).toBe(true);
  });

  it("suitability levels match the resolver matrix keys (single source of truth)", () => {
    // ApiVideoSuitability 枚举必须与任务 1 resolver 的矩阵键一致
    const levels = ApiVideoSuitability.options;
    expect(levels).toEqual([
      "remotion_only",
      "remotion_sufficient",
      "api_video_beneficial",
      "api_video_strongly_recommended",
    ]);
  });
});
