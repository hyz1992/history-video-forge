import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  loadTopicLightReviewThinkingReplayFixture,
  type TopicLightReviewThinkingReplayFixture,
} from "../../harness/scripts/runtime/topic-light-review-thinking-replay.js";

const sandboxDirs: string[] = [];

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
