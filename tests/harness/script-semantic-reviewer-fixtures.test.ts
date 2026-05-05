import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH,
  buildScriptSemanticReviewerFixturePlan,
  loadScriptSemanticReviewerFixtureSet,
} from "../../harness/scripts/runtime/script-semantic-reviewer-fixtures";

describe("script semantic reviewer calibration fixtures", () => {
  it("loads the controlled pass, lift, and off-contract fixture set", () => {
    const fixtures = loadScriptSemanticReviewerFixtureSet();

    expect(fixtures.map((item) => item.sample_id)).toEqual([
      "semantic-good-enough-yanzishichu",
      "semantic-weak-opening-yanzishichu",
      "semantic-off-contract-yanzishichu",
    ]);
    expect(fixtures.map((item) => item.expected_decision)).toEqual([
      "pass",
      "patch_once",
      "return_topic",
    ]);
    expect(fixtures.map((item) => item.expected_patch_intent)).toEqual([
      null,
      "lift",
      null,
    ]);

    for (const fixture of fixtures) {
      expect(fixture.bundle.hard_lane.must_include_beats.length).toBeGreaterThan(0);
      expect(fixture.draft.script_text.length).toBeGreaterThan(0);
      expect(fixture.rationale.length).toBeGreaterThan(0);
    }
  });

  it("keeps fixture set paths explicit and stable", () => {
    expect(DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH).toBe(
      "harness/samples/script-semantic-reviewer/fixture-set.md",
    );
  });

  it("builds a shadow-only calibration plan for the fixture set", () => {
    const plan = buildScriptSemanticReviewerFixturePlan();

    expect(plan).toMatchObject({
      mode: "script_semantic_reviewer_calibration",
      automated_gate: false,
      reviewer_mode: "shadow_only",
      fixture_set_path: DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH,
      total_fixtures: 3,
      expected_distribution: {
        pass: 1,
        patch_once: 1,
        return_topic: 1,
      },
    });
    expect(plan.required_checks).toContain(
      "不得把 fixture 期望决策接入自动 patch 主链路",
    );
  });
});
