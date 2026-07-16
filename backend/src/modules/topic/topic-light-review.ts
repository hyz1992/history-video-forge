import type { StrictStructuredToolSchema } from "../../runtime/llm/provider-contract.js";

export const TOPIC_LIGHT_REVIEW_CONSISTENCY_ISSUES = [
  "none",
  "actor_role_mismatch",
  "action_event_mismatch",
  "cause_outcome_mismatch",
  "scope_boundary_mismatch",
  "language_contamination",
  "overclaim_or_ambiguity",
] as const;

export type TopicLightReviewConsistencyIssue =
  (typeof TOPIC_LIGHT_REVIEW_CONSISTENCY_ISSUES)[number];

export interface TopicLightReviewCandidateResult {
  candidate_id: string;
  consistency_issue: TopicLightReviewConsistencyIssue;
  note: string;
}

export interface TopicLightReviewDecision {
  candidate_reviews: TopicLightReviewCandidateResult[];
}

export interface TopicLightReviewPromptProjectionInput {
  candidate_id: string;
  event_identity: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  core_conflict: string;
  strong_scene: string;
  must_cover_preview: string[];
}

export interface TopicLightReviewPromptCandidate {
  candidate_id: string;
  event_identity: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  core_conflict: string;
  strong_scene: string;
  must_cover_preview: string[];
}

export const TOPIC_LIGHT_REVIEW_STRICT_SCHEMA: StrictStructuredToolSchema = {
  name: "review_topic_candidates",
  description: "逐项审核选题候选的内部语义一致性。",
  parameters: {
    type: "object",
    properties: {
      candidate_reviews: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidate_id: {
              type: "string",
            },
            consistency_issue: {
              type: "string",
              enum: [...TOPIC_LIGHT_REVIEW_CONSISTENCY_ISSUES],
            },
            note: {
              type: "string",
            },
          },
          required: ["candidate_id", "consistency_issue", "note"],
          additionalProperties: false,
        },
      },
    },
    required: ["candidate_reviews"],
    additionalProperties: false,
  },
};

export function parseTopicLightReviewDecision(
  rawOutput: unknown,
  expectedCandidateIds: readonly string[],
): TopicLightReviewDecision {
  const rawReviews = extractCandidateReviews(rawOutput);
  const expectedIds = new Set(expectedCandidateIds);

  if (expectedIds.size !== expectedCandidateIds.length) {
    throw new Error("topic_light_review_candidate_coverage_mismatch");
  }

  const seenIds = new Set<string>();
  const candidateReviews = rawReviews.map((rawReview) => {
    if (!isRecord(rawReview)) {
      throw new Error("topic_light_review_invalid_candidate_review");
    }

    const keys = Object.keys(rawReview);
    if (
      keys.length !== 3 ||
      !keys.includes("candidate_id") ||
      !keys.includes("consistency_issue") ||
      !keys.includes("note")
    ) {
      throw new Error("topic_light_review_invalid_candidate_review");
    }

    const candidateId = rawReview.candidate_id;
    if (typeof candidateId !== "string" || candidateId.length === 0) {
      throw new Error("topic_light_review_invalid_candidate_id");
    }
    if (seenIds.has(candidateId)) {
      throw new Error("topic_light_review_duplicate_candidate_id");
    }
    seenIds.add(candidateId);

    const consistencyIssue = rawReview.consistency_issue;
    if (
      typeof consistencyIssue !== "string" ||
      !TOPIC_LIGHT_REVIEW_CONSISTENCY_ISSUES.includes(
        consistencyIssue as TopicLightReviewConsistencyIssue,
      )
    ) {
      throw new Error("topic_light_review_invalid_consistency_issue");
    }

    const note = rawReview.note;
    if (typeof note !== "string") {
      throw new Error("topic_light_review_invalid_note");
    }
    if (consistencyIssue === "none" && note !== "") {
      throw new Error("topic_light_review_none_note_must_be_empty");
    }
    if (consistencyIssue !== "none" && note.trim().length === 0) {
      throw new Error("topic_light_review_risk_note_required");
    }

    return {
      candidate_id: candidateId,
      consistency_issue: consistencyIssue as TopicLightReviewConsistencyIssue,
      note,
    };
  });

  if (
    seenIds.size !== expectedIds.size ||
    expectedCandidateIds.some((candidateId) => !seenIds.has(candidateId)) ||
    candidateReviews.some((review) => !expectedIds.has(review.candidate_id))
  ) {
    throw new Error("topic_light_review_candidate_coverage_mismatch");
  }

  return { candidate_reviews: candidateReviews };
}

export function projectTopicLightReviewPool<
  T extends TopicLightReviewPromptProjectionInput,
>(candidates: readonly T[]): TopicLightReviewPromptCandidate[] {
  return candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    event_identity: candidate.event_identity,
    title: candidate.title,
    one_line_angle: candidate.one_line_angle,
    family_label: candidate.family_label,
    scope_label: candidate.scope_label,
    core_conflict: candidate.core_conflict,
    strong_scene: candidate.strong_scene,
    must_cover_preview: candidate.must_cover_preview,
  }));
}

function extractCandidateReviews(rawOutput: unknown): unknown[] {
  if (!isRecord(rawOutput)) {
    throw new Error("topic_light_review_strict_schema_failed");
  }

  const topLevelKeys = Object.keys(rawOutput);
  if (topLevelKeys.length !== 1) {
    throw new Error("topic_light_review_strict_schema_failed");
  }

  if (
    topLevelKeys[0] === "candidate_reviews" &&
    Array.isArray(rawOutput.candidate_reviews)
  ) {
    return rawOutput.candidate_reviews;
  }

  if (topLevelKeys[0] === "answer" && isRecord(rawOutput.answer)) {
    const answerKeys = Object.keys(rawOutput.answer);
    if (answerKeys.length !== 1) {
      throw new Error("topic_light_review_strict_schema_failed");
    }
    if (answerKeys[0] === "review" && Array.isArray(rawOutput.answer.review)) {
      return rawOutput.answer.review;
    }
    if (
      answerKeys[0] === "candidate_reviews" &&
      Array.isArray(rawOutput.answer.candidate_reviews)
    ) {
      return rawOutput.answer.candidate_reviews;
    }
  }

  if (
    topLevelKeys[0] === "review_topic_candidates" &&
    isRecord(rawOutput.review_topic_candidates)
  ) {
    const toolKeys = Object.keys(rawOutput.review_topic_candidates);
    if (
      toolKeys.length === 1 &&
      toolKeys[0] === "candidate_reviews" &&
      Array.isArray(rawOutput.review_topic_candidates.candidate_reviews)
    ) {
      return rawOutput.review_topic_candidates.candidate_reviews;
    }
  }

  throw new Error("topic_light_review_strict_schema_failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
