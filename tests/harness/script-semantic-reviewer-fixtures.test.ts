import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH,
  buildScriptSemanticReviewerFixturePlan,
  loadScriptSemanticReviewerFixtureSet,
  runScriptSemanticReviewerFixtureShadowCheck,
} from "../../harness/scripts/runtime/script-semantic-reviewer-fixtures";

describe("script semantic reviewer calibration fixtures", () => {
  it("loads the controlled pass, lift, and off-contract fixture set", () => {
    const fixtures = loadScriptSemanticReviewerFixtureSet();

    expect(fixtures.map((item) => item.sample_id)).toEqual([
      "semantic-good-enough-yanzishichu",
      "semantic-weak-opening-yanzishichu",
      "semantic-off-contract-yanzishichu",
      "semantic-good-enough-zhuanzhu",
      "semantic-weak-opening-zhuanzhu",
      "semantic-off-contract-zhuanzhu",
      "semantic-good-enough-julu",
      "semantic-weak-opening-julu",
      "semantic-off-contract-julu",
    ]);
    expect(fixtures.map((item) => item.expected_decision)).toEqual([
      "pass",
      "patch_once",
      "return_topic",
      "pass",
      "patch_once",
      "return_topic",
      "pass",
      "patch_once",
      "return_topic",
    ]);
    expect(fixtures.map((item) => item.expected_patch_intent)).toEqual([
      null,
      "lift",
      null,
      null,
      "lift",
      null,
      null,
      "lift",
      null,
    ]);

    expect(new Set(fixtures.map((item) => item.bundle.topic_package.family_label))).toEqual(
      new Set(["外交压场", "刺杀政变", "战场翻盘型"]),
    );

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
      total_fixtures: 9,
      expected_distribution: {
        pass: 3,
        patch_once: 3,
        return_topic: 3,
      },
    });
    expect(plan.required_checks).toContain(
      "不得把 fixture 期望决策接入自动 patch 主链路",
    );
  });

  it("runs fixture shadow check, writes report artifacts, and exposes a non-default npm command", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-script-semantic-fixtures-"));
    const result = await runScriptSemanticReviewerFixtureShadowCheck(
      { outputDir },
      {
        reviewFixture: async (fixture) => ({
          stage: "script_semantic_review",
          decision: fixture.expected_decision,
          patch_intent: fixture.expected_patch_intent,
          hard_issues: [],
          soft_issues: [],
          patch_targets: [],
          summary: `matched ${fixture.sample_id}`,
          confidence: 0.9,
        }),
      },
    );

    expect(result).toMatchObject({
      mode: "script_semantic_reviewer_fixture_shadow_check",
      automated_gate: false,
      reviewer_mode: "shadow_only",
      total_fixtures: 9,
      matched_fixtures: 9,
      mismatched_fixtures: 0,
    });
    expect(existsSync(join(outputDir, "fixture-shadow-plan.json"))).toBe(true);
    expect(existsSync(join(outputDir, "fixture-shadow-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const trace = readFileSync(join(outputDir, "trace.md"), "utf8");
    expect(trace).toContain("script semantic reviewer fixture shadow check");
    expect(trace).toContain("shadow_only");
    expect(trace).toContain("semantic-good-enough-yanzishichu");
    expect(trace).toContain("matched");

    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "harness:script-semantic-fixtures":
        "tsx harness/scripts/runtime/script-semantic-reviewer-fixtures.ts",
    });
  });
});
