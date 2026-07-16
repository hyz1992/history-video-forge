import { describe, expect, it } from "vitest";

import {
  TOPIC_LIGHT_REVIEW_STRICT_SCHEMA,
  parseTopicLightReviewDecision,
  projectTopicLightReviewPool,
} from "../../../backend/src/modules/topic/topic-light-review.js";

const EXPECTED_IDS = ["candidate_1", "candidate_2", "candidate_3", "candidate_4"];

function createCandidateReviews() {
  return EXPECTED_IDS.map((candidateId, index) => ({
    candidate_id: candidateId,
    consistency_issue:
      index === 1 ? ("actor_role_mismatch" as const) : ("none" as const),
    note: index === 1 ? "标题中的决策者与场景中的执行者互相冲突" : "",
  }));
}

describe("topic light review", () => {
  it("defines a strict single-field top-level tool schema", () => {
    expect(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.name).toBe("review_topic_candidates");
    expect(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.description).not.toBe("");
    expect(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.description).toContain(
      "内部语义一致性",
    );
    expect(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.parameters.required).toEqual([
      "candidate_reviews",
    ]);
    expect(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.parameters.additionalProperties).toBe(
      false,
    );
    expect(Object.keys(TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.parameters.properties)).toEqual([
      "candidate_reviews",
    ]);
    const candidateReviewsSchema = TOPIC_LIGHT_REVIEW_STRICT_SCHEMA.parameters
      .properties.candidate_reviews as {
      items: { properties: Record<string, unknown>; additionalProperties: boolean };
    };
    expect(Object.keys(candidateReviewsSchema.items.properties)).toEqual([
      "candidate_id",
      "consistency_issue",
      "note",
    ]);
    expect(candidateReviewsSchema.items.additionalProperties).toBe(false);
  });

  it("parses a decision that covers all four expected candidate ids", () => {
    const candidateReviews = createCandidateReviews();

    expect(
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toEqual({ candidate_reviews: candidateReviews });
  });

  it.each([
    ["answer", { answer: { candidate_reviews: createCandidateReviews() } }],
    ["answer.review", { answer: { review: createCandidateReviews() } }],
    [
      "topic tool",
      { review_topic_candidates: { candidate_reviews: createCandidateReviews() } },
    ],
  ])("accepts the common %s structured fallback wrapper", (_label, rawOutput) => {
    expect(parseTopicLightReviewDecision(rawOutput, EXPECTED_IDS)).toEqual({
      candidate_reviews: createCandidateReviews(),
    });
  });

  it.each([
    [
      "strict top-level",
      { candidate_reviews: createCandidateReviews(), quality_score: 99 },
    ],
    [
      "answer top-level",
      {
        answer: { candidate_reviews: createCandidateReviews() },
        quality_score: 99,
      },
    ],
    [
      "answer body",
      {
        answer: {
          candidate_reviews: createCandidateReviews(),
          explanation: "额外说明",
        },
      },
    ],
    [
      "answer review body",
      {
        answer: {
          review: createCandidateReviews(),
          explanation: "额外说明",
        },
      },
    ],
    [
      "topic tool top-level",
      {
        review_topic_candidates: {
          candidate_reviews: createCandidateReviews(),
        },
        explanation: "额外说明",
      },
    ],
    [
      "topic tool body",
      {
        review_topic_candidates: {
          candidate_reviews: createCandidateReviews(),
          explanation: "额外说明",
        },
      },
    ],
  ])("rejects extra fields in the %s wrapper", (_label, rawOutput) => {
    expect(() => parseTopicLightReviewDecision(rawOutput, EXPECTED_IDS)).toThrow(
      "topic_light_review_strict_schema_failed",
    );
  });

  it("rejects an unknown candidate id", () => {
    const candidateReviews = createCandidateReviews();
    candidateReviews[3] = {
      ...candidateReviews[3],
      candidate_id: "invented_candidate",
    };

    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_candidate_coverage_mismatch");
  });

  it("rejects an omitted candidate id", () => {
    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: createCandidateReviews().slice(0, 3) },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_candidate_coverage_mismatch");
  });

  it("rejects a duplicate candidate id", () => {
    const candidateReviews = createCandidateReviews();
    candidateReviews[3] = {
      ...candidateReviews[3],
      candidate_id: "candidate_1",
    };

    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_duplicate_candidate_id");
  });

  it("rejects an unsupported consistency issue", () => {
    const candidateReviews: Array<Record<string, unknown>> = createCandidateReviews();
    candidateReviews[0] = {
      ...candidateReviews[0],
      consistency_issue: "invented_issue",
    };

    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_invalid_consistency_issue");
  });

  it("rejects a risk result without a non-empty note", () => {
    const candidateReviews = createCandidateReviews();
    candidateReviews[1] = { ...candidateReviews[1], note: "   " };

    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_risk_note_required");
  });

  it("rejects a risk result missing its note field", () => {
    const candidateReviews: Array<Record<string, unknown>> = createCandidateReviews();
    delete candidateReviews[1].note;

    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_invalid_candidate_review");
  });

  it("rejects a none result carrying a note", () => {
    const candidateReviews = createCandidateReviews();
    candidateReviews[0] = {
      ...candidateReviews[0],
      note: "没有明显问题",
    };

    expect(() =>
      parseTopicLightReviewDecision(
        { candidate_reviews: candidateReviews },
        EXPECTED_IDS,
      ),
    ).toThrow("topic_light_review_none_note_must_be_empty");
  });

  it("projects only evidence needed for per-candidate consistency review", () => {
    const candidate = {
      candidate_id: "candidate_1",
      event_identity: "高平陵之变",
      title: "司马懿在高平陵之变中夺权",
      one_line_angle: "曹爽离开洛阳后，司马懿利用短暂窗口控制都城",
      family_label: "宫变夺权",
      scope_label: "魏晋",
      core_conflict: "司马懿必须在曹爽返城前控制权力中枢",
      strong_scene: "洛阳城门关闭，太后诏令送往各处",
      must_cover_preview: ["曹爽离城", "司马懿控制洛阳", "曹氏集团失势"],
      risk_hints: ["投降与后续处置不能写成当场伏杀"],
      viral_rubric: { hook_power: "high" },
      fatigue_score: 2,
      recently_seen: true,
      quality_score: 99,
      quality_rank: 1,
      deductions: [],
    };
    const before = structuredClone(candidate);

    const projected = projectTopicLightReviewPool([candidate]);

    expect(projected).toEqual([
      {
        candidate_id: "candidate_1",
        event_identity: "高平陵之变",
        title: "司马懿在高平陵之变中夺权",
        one_line_angle: "曹爽离开洛阳后，司马懿利用短暂窗口控制都城",
        family_label: "宫变夺权",
        scope_label: "魏晋",
        core_conflict: "司马懿必须在曹爽返城前控制权力中枢",
        strong_scene: "洛阳城门关闭，太后诏令送往各处",
        must_cover_preview: ["曹爽离城", "司马懿控制洛阳", "曹氏集团失势"],
      },
    ]);
    expect(candidate).toEqual(before);
    expect(JSON.stringify(projected)).not.toMatch(
      /viral_rubric|fatigue_score|recently_seen|quality_score|quality_rank|deductions/,
    );
  });
});
