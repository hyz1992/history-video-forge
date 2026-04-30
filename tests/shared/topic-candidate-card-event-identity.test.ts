import { describe, expect, it } from "vitest";

import { TopicCandidateCard } from "../../shared/src/index.js";

describe("TopicCandidateCard event identity contract", () => {
  it("requires TopicCandidateCard to include event_identity", () => {
    expect(() =>
      TopicCandidateCard.parse({
        title: "test",
        one_line_angle: "angle",
        family_label: "family",
        scope_label: "scope",
        estimated_duration_band: "medium",
        why_this_now: "now",
        core_conflict: "conflict",
        strong_scene: "scene",
        must_cover_preview: [],
        risk_hints: [],
        source_hint: "source",
        recent_usage_hint: "recent",
        viral_rubric: {
          hook_power: "high",
          novelty_gap: "medium",
          emotion_gap: "high",
          share_impulse: "high",
          visual_promise: "high",
        },
      }),
    ).toThrow();
  });
});
