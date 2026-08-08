import { createHash } from "node:crypto";

import type {
  TopicRecommendationFilter,
} from "../../../../shared/src/topic/topic-recommendation-filter.schema.js";

export function createTopicRecommendationFilterFingerprint(
  input: TopicRecommendationFilter,
): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}
