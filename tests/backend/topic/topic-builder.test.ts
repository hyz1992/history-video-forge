import { describe, expect, it } from "vitest";

import { TopicCandidateCard } from "../../../shared/src/index.js";
import { buildTopicCandidates } from "../../../backend/src/modules/topic/topic-candidate.builder.js";

describe("topic candidate builder", () => {
  it("builds 3 family-slot candidates for a standard event", () => {
    const candidates = buildTopicCandidates({
      canonicalName: "晏子使楚",
      summary: "楚王在公开场合连续压场，晏子当场顶回去。",
      coreConflict: "楚王当众压场，晏子必须当场顶回。",
      strongScene: "楚王连续压场，晏子一句句顶回去。",
      sourceHint: "《晏子春秋》",
      recentUsageHint: "近期未出现同 event_id",
      tags: ["diplomacy", "court", "humiliation", "showdown"],
    });

    expect(candidates).toHaveLength(3);

    for (const candidate of candidates) {
      expect(() => TopicCandidateCard.parse(candidate)).not.toThrow();
    }

    const angles = candidates.map((candidate) => candidate.one_line_angle);
    expect(new Set(angles).size).toBe(3);
    expect(candidates[0]?.viral_rubric).toMatchObject({
      hook_power: expect.any(String),
      visual_promise: expect.any(String),
    });
  });

  it("filters out candidates when hook_power and visual_promise are both low", () => {
    const candidates = buildTopicCandidates({
      canonicalName: "礼部旧案",
      summary: "一段过程平直、场面感偏弱的旧案整理。",
      coreConflict: "冲突弱，缺少当场对顶。",
      strongScene: "卷宗翻阅，没有强场面。",
      sourceHint: "地方志摘录",
      recentUsageHint: "近期未出现同 event_id",
      tags: ["archive"],
      familyHint: "通用安全槽位",
      slotRubricOverrides: [
        {
          hook_power: "low",
          novelty_gap: "low",
          emotion_gap: "medium",
          share_impulse: "low",
          visual_promise: "low",
        },
        {
          hook_power: "medium",
          novelty_gap: "medium",
          emotion_gap: "medium",
          share_impulse: "medium",
          visual_promise: "medium",
        },
        {
          hook_power: "medium",
          novelty_gap: "high",
          emotion_gap: "medium",
          share_impulse: "medium",
          visual_promise: "medium",
        },
      ],
    });

    expect(candidates).toHaveLength(2);
    expect(
      candidates.some(
        (candidate) =>
          candidate.viral_rubric.hook_power === "low" &&
          candidate.viral_rubric.visual_promise === "low",
      ),
    ).toBe(false);
  });
});
