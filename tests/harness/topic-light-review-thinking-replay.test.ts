import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  loadTopicLightReviewThinkingReplayFixture,
  type TopicLightReviewThinkingReplayFixture,
} from "../../harness/scripts/runtime/topic-light-review-thinking-replay.js";

const sandboxDirs: string[] = [];

const SOURCE_CONTROLS = [
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json",
    sourceCandidateId: "selector_candidate_7",
    mappedCandidateId: "high_tension_risk_jingkang",
  },
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json",
    sourceCandidateId: "selector_candidate_3",
    mappedCandidateId: "high_tension_none_xuanwumen",
  },
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json",
    sourceCandidateId: "selector_candidate_3",
    mappedCandidateId: "balanced_risk_hongmenyan",
  },
  {
    sourcePath:
      "harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json",
    sourceCandidateId: "selector_candidate_5",
    mappedCandidateId: "balanced_none_wugu",
  },
] as const;

interface SourceSelectorFixture {
  selector_input: {
    selector_pool: Array<Record<string, unknown> & { candidate_id: string }>;
  };
  annotations: Array<Record<string, unknown> & { candidate_id: string }>;
}

afterAll(() => {
  for (const dir of sandboxDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeFixture(
  fixture: TopicLightReviewThinkingReplayFixture,
  label: string,
) {
  const dir = mkdtempSync(join(tmpdir(), `topic-light-review-${label}-`));
  sandboxDirs.push(dir);
  const fixturePath = join(dir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(fixture), "utf8");
  return fixturePath;
}

function cloneFixture(): TopicLightReviewThinkingReplayFixture {
  return structuredClone(loadTopicLightReviewThinkingReplayFixture());
}

function loadMappedSourceControls() {
  return SOURCE_CONTROLS.map(
    ({ sourcePath, sourceCandidateId, mappedCandidateId }) => {
      const source = JSON.parse(
        readFileSync(sourcePath, "utf8"),
      ) as SourceSelectorFixture;
      const sourceCandidate = source.selector_input.selector_pool.find(
        (candidate) => candidate.candidate_id === sourceCandidateId,
      );
      const sourceAnnotation = source.annotations.find(
        (annotation) => annotation.candidate_id === sourceCandidateId,
      );
      if (!sourceCandidate || !sourceAnnotation) {
        throw new Error(`missing source control: ${sourceCandidateId}`);
      }

      const {
        candidate_id: _sourceCandidateId,
        fatigue_score: _fatigueScore,
        risk_hints: _riskHints,
        ...candidateBody
      } = sourceCandidate;
      const { candidate_id: _sourceAnnotationId, ...annotationBody } =
        sourceAnnotation;

      return {
        candidate: {
          candidate_id: mappedCandidateId,
          ...candidateBody,
        },
        annotation: {
          candidate_id: mappedCandidateId,
          ...annotationBody,
        },
      };
    },
  );
}

describe("topic light review thinking replay fixture", () => {
  it("loads four unique audited controls", () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const candidateIds = fixture.review_pool.map(
      (candidate) => candidate.candidate_id,
    );

    expect(candidateIds).toEqual([
      "high_tension_risk_jingkang",
      "high_tension_none_xuanwumen",
      "balanced_risk_hongmenyan",
      "balanced_none_wugu",
    ]);
    expect(new Set(candidateIds).size).toBe(4);
    expect(fixture.annotations.map((annotation) => annotation.candidate_id)).toEqual(
      candidateIds,
    );
    expect(
      fixture.annotations.filter((annotation) => annotation.expected_risk),
    ).toHaveLength(2);
    expect(
      fixture.annotations.filter(
        (annotation) => annotation.expected_issue === "none",
      ),
    ).toHaveLength(2);
    expect(
      fixture.annotations.every(
        (annotation) => annotation.rationale.trim().length > 0,
      ),
    ).toBe(true);
  });

  it("copies the four source controls without field drift", () => {
    const fixture = loadTopicLightReviewThinkingReplayFixture();
    const sourceControls = loadMappedSourceControls();

    expect(fixture.review_pool).toEqual(
      sourceControls.map((control) => control.candidate),
    );
    expect(fixture.annotations).toEqual(
      sourceControls.map((control) => control.annotation),
    );
  });

  it("validates production candidate fields and annotation consistency", () => {
    const requiredStringFields = [
      "candidate_id",
      "title",
      "one_line_angle",
      "core_conflict",
      "strong_scene",
      "event_identity",
      "family_label",
      "scope_label",
    ] as const;

    for (const field of requiredStringFields) {
      const fixture = cloneFixture();
      fixture.review_pool[0][field] = " ";
      expect(() =>
        loadTopicLightReviewThinkingReplayFixture(
          writeFixture(fixture, `empty-${field}`),
        ),
      ).toThrow("topic_light_review_thinking_fixture_invalid_candidate");
    }

    for (const previews of [[], ["valid", " "]]) {
      const fixture = cloneFixture();
      fixture.review_pool[0].must_cover_preview = previews;
      expect(() =>
        loadTopicLightReviewThinkingReplayFixture(
          writeFixture(fixture, "invalid-preview"),
        ),
      ).toThrow("topic_light_review_thinking_fixture_invalid_candidate");
    }

    const invalidFinalStatus = cloneFixture();
    invalidFinalStatus.annotations[0].entered_final_candidates = "true" as never;
    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(invalidFinalStatus, "invalid-final-status"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_invalid_annotation");

    const riskMarkedNone = cloneFixture();
    riskMarkedNone.annotations[0].expected_issue = "none";
    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(riskMarkedNone, "risk-marked-none"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_risk_issue_mismatch");

    const noneMarkedRisk = cloneFixture();
    noneMarkedRisk.annotations[1].expected_issue = "actor_role_mismatch";
    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(noneMarkedRisk, "none-marked-risk"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_risk_issue_mismatch");
  });

  it("rejects duplicate candidate ids", () => {
    const fixture = cloneFixture();
    fixture.review_pool[1].candidate_id = fixture.review_pool[0].candidate_id;

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "duplicate-id"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_duplicate_candidate_id");
  });

  it("rejects an expected issue outside the production schema enum", () => {
    const fixture = cloneFixture();
    fixture.annotations[0].expected_issue = "invented_issue" as never;

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "invalid-issue"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_invalid_expected_issue");
  });

  it("requires four controls with both risk and none annotations", () => {
    const fixture = cloneFixture();
    fixture.review_pool.pop();
    fixture.annotations.pop();

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "invalid-count"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_requires_four_candidates");

    const allRiskFixture = cloneFixture();
    for (const annotation of allRiskFixture.annotations) {
      annotation.expected_risk = true;
      annotation.expected_issue = "actor_role_mismatch";
    }

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(allRiskFixture, "missing-none"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_requires_risk_and_none");
  });

  it("requires a non-empty rationale for every annotation", () => {
    const fixture = cloneFixture();
    fixture.annotations[0].rationale = " ";

    expect(() =>
      loadTopicLightReviewThinkingReplayFixture(
        writeFixture(fixture, "empty-rationale"),
      ),
    ).toThrow("topic_light_review_thinking_fixture_rationale_required");
  });
});
