import { createHash } from "node:crypto";

import {
  normalizeTopicRecommendationFilter,
} from "../../../../shared/src/index.js";

type TopicRecommendationFilterInput = Parameters<
  typeof normalizeTopicRecommendationFilter
>[0];

export function createTopicRecommendationFilterFingerprint(
  input: TopicRecommendationFilterInput,
): string | undefined {
  const normalized = normalizeTopicRecommendationFilter(input);
  if (!normalized) return undefined;

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
}
