import { readFileSync } from "node:fs";

import {
  TOPIC_LIGHT_REVIEW_STRICT_SCHEMA,
  type TopicLightReviewConsistencyIssue,
  type TopicLightReviewPromptCandidate,
} from "../../../backend/src/modules/topic/topic-light-review.js";

export const DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH =
  "harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json";

export interface TopicLightReviewThinkingReplayAnnotation {
  candidate_id: string;
  expected_risk: boolean;
  expected_issue: TopicLightReviewConsistencyIssue;
  entered_final_candidates: boolean;
  rationale: string;
}

export interface TopicLightReviewThinkingReplayFixture {
  fixture_id: string;
  review_pool: TopicLightReviewPromptCandidate[];
  annotations: TopicLightReviewThinkingReplayAnnotation[];
}

interface JsonSchemaNode {
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
}

export function loadTopicLightReviewThinkingReplayFixture(
  fixturePath = DEFAULT_TOPIC_LIGHT_REVIEW_THINKING_FIXTURE_PATH,
): TopicLightReviewThinkingReplayFixture {
  const rawFixture: unknown = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (
    !isRecord(rawFixture) ||
    typeof rawFixture.fixture_id !== "string" ||
    !Array.isArray(rawFixture.review_pool) ||
    !Array.isArray(rawFixture.annotations)
  ) {
    throw new Error("topic_light_review_thinking_fixture_invalid_structure");
  }

  if (rawFixture.review_pool.length !== 4) {
    throw new Error("topic_light_review_thinking_fixture_requires_four_candidates");
  }

  const candidateIds = rawFixture.review_pool.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.candidate_id !== "string" ||
      candidate.candidate_id.length === 0
    ) {
      throw new Error("topic_light_review_thinking_fixture_invalid_candidate_id");
    }
    return candidate.candidate_id;
  });
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("topic_light_review_thinking_fixture_duplicate_candidate_id");
  }

  if (rawFixture.annotations.length !== candidateIds.length) {
    throw new Error("topic_light_review_thinking_fixture_annotation_coverage_mismatch");
  }

  const allowedIssues = getProductionIssueEnum();
  const annotationIds = new Set<string>();
  let hasRisk = false;
  let hasNone = false;
  for (const annotation of rawFixture.annotations) {
    if (
      !isRecord(annotation) ||
      typeof annotation.candidate_id !== "string" ||
      typeof annotation.expected_risk !== "boolean" ||
      typeof annotation.expected_issue !== "string" ||
      typeof annotation.rationale !== "string"
    ) {
      throw new Error("topic_light_review_thinking_fixture_invalid_annotation");
    }
    if (!allowedIssues.has(annotation.expected_issue)) {
      throw new Error("topic_light_review_thinking_fixture_invalid_expected_issue");
    }
    if (annotation.rationale.trim().length === 0) {
      throw new Error("topic_light_review_thinking_fixture_rationale_required");
    }
    annotationIds.add(annotation.candidate_id);
    hasRisk ||= annotation.expected_risk;
    hasNone ||= annotation.expected_issue === "none";
  }

  if (
    annotationIds.size !== candidateIds.length ||
    candidateIds.some((candidateId) => !annotationIds.has(candidateId))
  ) {
    throw new Error("topic_light_review_thinking_fixture_annotation_coverage_mismatch");
  }
  if (!hasRisk || !hasNone) {
    throw new Error("topic_light_review_thinking_fixture_requires_risk_and_none");
  }

  return rawFixture as unknown as TopicLightReviewThinkingReplayFixture;
}

function getProductionIssueEnum(): Set<string> {
  const candidateReviews = TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.parameters.properties
    .candidate_reviews as JsonSchemaNode;
  const issueEnum =
    candidateReviews.items?.properties?.consistency_issue?.enum;
  if (!Array.isArray(issueEnum)) {
    throw new Error("topic_light_review_thinking_fixture_schema_enum_missing");
  }
  return new Set(
    issueEnum.filter((issue): issue is string => typeof issue === "string"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
