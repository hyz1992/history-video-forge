import { describe, expect, it } from "vitest";

import { projectTopicSelectorPool } from "../../backend/src/modules/topic/topic-selector-prompt-projection.js";
import {
  DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH,
  getProductionConsistencyIssueSet,
  loadTopicSelectorSemanticFixtureSet,
} from "../../harness/scripts/runtime/topic-selector-semantic-replay.js";

describe("topic selector semantic replay fixtures", () => {
  it("loads the two Task 17 selector inputs and their audited annotations", () => {
    const fixtures = loadTopicSelectorSemanticFixtureSet();

    expect(DEFAULT_TOPIC_SELECTOR_SEMANTIC_FIXTURE_SET_PATH).toBe(
      "harness/samples/topic-selector-semantic-replay/fixture-set.md",
    );
    expect(fixtures.map((item) => item.fixture_id)).toEqual([
      "task17-high-tension",
      "task17-balanced",
    ]);
    expect(
      fixtures.every((item) => item.selector_input.selector_pool.length === 8),
    ).toBe(true);

    expect(fixtures[0].source).toMatchObject({
      project_id: "5fda1609-63ed-4f0d-b47a-bb48038b3a6a",
      topic_run_id: "topic_run_3d8da9c7-aaaa-43f9-80fe-5cc5549ec95f",
      baseline_observation: "all_none",
    });
    expect(fixtures[0].annotations).toMatchObject([
      {
        candidate_id: "selector_candidate_7",
        expected_risk: true,
        expected_issue: "actor_role_mismatch",
      },
      {
        candidate_id: "selector_candidate_3",
        expected_risk: false,
        expected_issue: "none",
      },
    ]);

    expect(fixtures[1].source).toMatchObject({
      project_id: "3858fbdc-18c1-4095-ac72-55f9d4adb4b1",
      topic_run_id: "topic_run_f5a2648f-7ade-45b5-958d-ce4f8cab1e5c",
      baseline_observation: "all_none",
    });
    expect(fixtures[1].annotations).toMatchObject([
      {
        candidate_id: "selector_candidate_3",
        expected_risk: true,
        expected_issue: "overclaim_or_ambiguity",
      },
      {
        candidate_id: "selector_candidate_7",
        expected_risk: true,
        expected_issue: "overclaim_or_ambiguity",
      },
      {
        candidate_id: "selector_candidate_5",
        expected_risk: false,
        expected_issue: "none",
      },
    ]);

    const annotations = fixtures.flatMap((item) => item.annotations);
    expect(annotations.filter((item) => item.expected_risk)).toHaveLength(3);
    expect(annotations.filter((item) => !item.expected_risk)).toHaveLength(2);
    expect(annotations.every((item) => item.rationale.length > 0)).toBe(true);
  });

  it("reads the allowed issue labels from the production strict schema", () => {
    expect(getProductionConsistencyIssueSet()).toEqual(
      new Set([
        "none",
        "actor_role_mismatch",
        "action_event_mismatch",
        "cause_outcome_mismatch",
        "scope_boundary_mismatch",
        "language_contamination",
        "overclaim_or_ambiguity",
      ]),
    );
  });

  it("keeps every saved selector pool compatible with the production projection", () => {
    const fixtures = loadTopicSelectorSemanticFixtureSet();

    for (const fixture of fixtures) {
      const before = structuredClone(fixture.selector_input.selector_pool);
      const projected = projectTopicSelectorPool(
        fixture.selector_input.selector_pool.map((candidate) => ({
          ...candidate,
          normalized_event_identity: String(candidate.event_identity),
          viral_rubric: null,
          recently_seen: Number(candidate.fatigue_score) > 0,
        })) as never,
      );

      expect(projected).toEqual(fixture.selector_input.selector_pool);
      expect(fixture.selector_input.selector_pool).toEqual(before);
    }
  });
});
