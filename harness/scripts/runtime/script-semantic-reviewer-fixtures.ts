import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  ScriptSemanticReviewResult,
} from "../../../shared/src/index.js";

export const DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH =
  "harness/samples/script-semantic-reviewer/fixture-set.md";

type ExpectedDecision = Exclude<
  ScriptSemanticReviewResult["decision"],
  "skipped"
>;

export interface ScriptSemanticReviewerFixture {
  sample_id: string;
  category: "good_enough" | "weak_lift" | "off_contract";
  expected_decision: ExpectedDecision;
  expected_patch_intent: ScriptSemanticReviewResult["patch_intent"];
  rationale: string;
  bundle: ScriptInputBundle;
  draft: ScriptDraftPackage;
}

export interface ScriptSemanticReviewerFixturePlan {
  mode: "script_semantic_reviewer_calibration";
  automated_gate: false;
  reviewer_mode: "shadow_only";
  fixture_set_path: string;
  total_fixtures: number;
  expected_distribution: Partial<Record<ExpectedDecision, number>>;
  required_checks: string[];
}

export function loadScriptSemanticReviewerFixtureSet(
  fixtureSetPath = DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH,
): ScriptSemanticReviewerFixture[] {
  return loadFixturePaths(fixtureSetPath).map(loadFixture);
}

export function buildScriptSemanticReviewerFixturePlan(
  fixtureSetPath = DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH,
): ScriptSemanticReviewerFixturePlan {
  const fixtures = loadScriptSemanticReviewerFixtureSet(fixtureSetPath);
  const expectedDistribution: Partial<Record<ExpectedDecision, number>> = {};

  for (const fixture of fixtures) {
    expectedDistribution[fixture.expected_decision] =
      (expectedDistribution[fixture.expected_decision] ?? 0) + 1;
  }

  return {
    mode: "script_semantic_reviewer_calibration",
    automated_gate: false,
    reviewer_mode: "shadow_only",
    fixture_set_path: fixtureSetPath,
    total_fixtures: fixtures.length,
    expected_distribution: expectedDistribution,
    required_checks: [
      "不得把 fixture 期望决策接入自动 patch 主链路",
      "不得用本地字符串规则替代语义审校",
      "真实模型结果只能作为 shadow calibration 记录",
    ],
  };
}

function loadFixturePaths(fixtureSetPath: string) {
  const content = readFileSync(resolve(process.cwd(), fixtureSetPath), "utf8");
  const matches = [...content.matchAll(/`([^`]+\.fixture\.json)`/g)];
  const paths = matches.map((match) => match[1]);

  if (paths.length === 0) {
    throw new Error("script_semantic_reviewer_fixture_set_empty");
  }

  return paths;
}

function loadFixture(fixturePath: string): ScriptSemanticReviewerFixture {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), fixturePath), "utf8")) as
    Record<string, unknown>;

  const expectedDecision = ScriptSemanticReviewResult.shape.decision.exclude([
    "skipped",
  ]).parse(raw.expected_decision);
  const expectedPatchIntent = ScriptSemanticReviewResult.shape.patch_intent.parse(
    raw.expected_patch_intent,
  );

  return {
    sample_id: readString(raw.sample_id, "sample_id"),
    category: readCategory(raw.category),
    expected_decision: expectedDecision,
    expected_patch_intent: expectedPatchIntent,
    rationale: readString(raw.rationale, "rationale"),
    bundle: ScriptInputBundle.parse(raw.bundle),
    draft: ScriptDraftPackage.parse(raw.draft),
  };
}

function readString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`script_semantic_reviewer_fixture_invalid_${field}`);
  }
  return value;
}

function readCategory(value: unknown): ScriptSemanticReviewerFixture["category"] {
  if (
    value === "good_enough" ||
    value === "weak_lift" ||
    value === "off_contract"
  ) {
    return value;
  }
  throw new Error("script_semantic_reviewer_fixture_invalid_category");
}
