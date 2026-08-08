import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { normalizeTopicRecommendationFilter } from "../../../shared/src/index.js";
import { createTopicRecommendationFilterFingerprint } from "../../../backend/src/modules/topic/topic-recommendation-filter.fingerprint.js";

describe("topic recommendation filter fingerprint", () => {
  it("does not create a fingerprint for empty or auto-only filters", () => {
    expect(createTopicRecommendationFilterFingerprint({})).toBeUndefined();
    expect(
      createTopicRecommendationFilterFingerprint({ storytelling_lens: "auto" }),
    ).toBeUndefined();
  });

  it("creates the SHA-256 first 16 hex characters from the normalized filter", () => {
    const input = { event_domain: "political_power" } as const;
    const expected = createHash("sha256")
      .update(JSON.stringify(normalizeTopicRecommendationFilter(input)))
      .digest("hex")
      .slice(0, 16);

    expect(createTopicRecommendationFilterFingerprint(input)).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{16}$/);
  });

  it("treats auto and a missing storytelling lens as equivalent", () => {
    expect(
      createTopicRecommendationFilterFingerprint({
        event_domain: "political_power",
        storytelling_lens: "auto",
      }),
    ).toBe(
      createTopicRecommendationFilterFingerprint({
        event_domain: "political_power",
      }),
    );
  });

  it("is stable across field order and equivalent exclude terms", () => {
    const first = createTopicRecommendationFilterFingerprint({
      event_domain: "political_power",
      central_actor_type: "court_elite",
      exclude_terms: [" 演义 ", "神话", "演义"],
    });
    const second = createTopicRecommendationFilterFingerprint({
      exclude_terms: ["神话", " 演义", "神话 "],
      central_actor_type: "court_elite",
      event_domain: "political_power",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });
});
