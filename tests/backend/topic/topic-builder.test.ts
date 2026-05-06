import { describe, expect, it } from "vitest";

import { TopicCandidateCard } from "../../../shared/src/index.js";
import { buildTopicCandidates } from "../../../backend/src/modules/topic/topic-candidate.builder.js";

describe("topic candidate builder", () => {
  it("builds 3 family-slot candidates for a standard event", () => {
    const candidates = buildTopicCandidates({
      canonicalName: "event-a",
      summary: "public pressure around a diplomatic showdown",
      coreConflict: "the protagonist must answer direct public pressure",
      strongScene: "the protagonist pushes back in front of everyone",
      sourceHint: "historical source",
      recentUsageHint: "not used recently",
      tags: ["diplomacy", "court", "humiliation", "showdown"],
    });

    expect(candidates).toHaveLength(3);

    for (const candidate of candidates) {
      expect(() => TopicCandidateCard.parse(candidate)).not.toThrow();
      expect(candidate.must_cover_preview).toEqual([
        "public pressure around a diplomatic showdown",
        "the protagonist pushes back in front of everyone",
        "the protagonist must answer direct public pressure",
      ]);
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
      canonicalName: "archive-case",
      summary: "a quiet archival process without visual pressure",
      coreConflict: "weak conflict with little direct confrontation",
      strongScene: "paperwork and review without a strong scene",
      sourceHint: "local archive",
      recentUsageHint: "not used recently",
      tags: ["archive"],
      familyHint: "safe",
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

  it("builds candidate cards with event_identity", () => {
    const candidates = buildTopicCandidates({
      canonicalName: "event-a",
      summary: "summary-a",
      coreConflict: "conflict-a",
      strongScene: "scene-a",
      sourceHint: "source-a",
      recentUsageHint: "recent-a",
      tags: ["diplomacy", "court", "humiliation", "showdown"],
    });

    expect(candidates[0]?.event_identity).toBeTruthy();
    expect(candidates[0]?.event_identity).toBe("event-a");
  });
});
