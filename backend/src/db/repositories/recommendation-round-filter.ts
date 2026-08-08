import {
  TopicRecommendationFilterSchema,
  type TopicRecommendationFilter,
} from "../../../../shared/src/topic/topic-recommendation-filter.schema.js";

export function parseRecommendationRoundFilterJson(
  value: unknown,
): TopicRecommendationFilter | null {
  if (value === null) return null;

  const parsed = TopicRecommendationFilterSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("recommendation_round_filter_invalid");
  }

  return parsed.data;
}
