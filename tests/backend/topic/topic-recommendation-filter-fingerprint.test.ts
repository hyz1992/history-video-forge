import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TopicRecommendationFilterSchema } from "../../../shared/src/index.js";
import { createTopicRecommendationFilterFingerprint } from "../../../backend/src/modules/topic/topic-recommendation-filter.fingerprint.js";

describe("topic recommendation filter fingerprint", () => {
  it("creates the SHA-256 first 16 hex characters from a normalized filter", () => {
    const input = TopicRecommendationFilterSchema.parse({
      event_domain: "political_power",
    });
    const expected = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex")
      .slice(0, 16);

    expect(createTopicRecommendationFilterFingerprint(input)).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is stable across field order for normalized filters", () => {
    const first = TopicRecommendationFilterSchema.parse({
      event_domain: "political_power",
      central_actor_type: "court_elite",
      exclude_terms: ["folklore", "legend"],
    });
    const second = TopicRecommendationFilterSchema.parse({
      exclude_terms: ["folklore", "legend"],
      central_actor_type: "court_elite",
      event_domain: "political_power",
    });

    expect(createTopicRecommendationFilterFingerprint(first)).toBe(
      createTopicRecommendationFilterFingerprint(second),
    );
    expect(createTopicRecommendationFilterFingerprint(first)).toMatch(
      /^[a-f0-9]{16}$/,
    );
  });
});
