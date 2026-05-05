import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { reviewScriptSemantics } from "../../../backend/src/modules/script/script-semantic-review.service.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
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

export interface ScriptSemanticReviewerFixtureShadowCheckInput {
  fixtureSetPath?: string;
  outputDir?: string;
}

export interface ScriptSemanticReviewerFixtureShadowCheckResult
  extends Omit<ScriptSemanticReviewerFixturePlan, "mode"> {
  mode: "script_semantic_reviewer_fixture_shadow_check";
  output_dir: string;
  matched_fixtures: number;
  mismatched_fixtures: number;
  results: ScriptSemanticReviewerFixtureShadowCheckSampleResult[];
}

export interface ScriptSemanticReviewerFixtureShadowCheckSampleResult {
  sample_id: string;
  category: ScriptSemanticReviewerFixture["category"];
  expected_decision: ExpectedDecision;
  expected_patch_intent: ScriptSemanticReviewResult["patch_intent"];
  actual_decision: ScriptSemanticReviewResult["decision"];
  actual_patch_intent: ScriptSemanticReviewResult["patch_intent"];
  matched: boolean;
  hard_issue_count: number;
  soft_issue_count: number;
  patch_target_count: number;
  summary: string;
  confidence: number;
}

export interface ScriptSemanticReviewerFixtureShadowCheckDependencies {
  requireRealEnv?: boolean;
  reviewFixture?: (
    fixture: ScriptSemanticReviewerFixture,
  ) => Promise<ScriptSemanticReviewResult>;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/script-semantic-reviewer-fixture-shadow",
);

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

export async function runScriptSemanticReviewerFixtureShadowCheck(
  input: ScriptSemanticReviewerFixtureShadowCheckInput = {},
  dependencies: ScriptSemanticReviewerFixtureShadowCheckDependencies = {},
): Promise<ScriptSemanticReviewerFixtureShadowCheckResult> {
  const fixtureSetPath =
    input.fixtureSetPath ?? DEFAULT_SCRIPT_SEMANTIC_REVIEWER_FIXTURE_SET_PATH;
  const plan = buildScriptSemanticReviewerFixturePlan(fixtureSetPath);
  const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  const requireRealEnv = dependencies.requireRealEnv ?? true;
  const reviewFixture = dependencies.reviewFixture ?? createDefaultReviewFixture();

  if (requireRealEnv && !existsSync(resolve(process.cwd(), ".env"))) {
    throw new Error("script_semantic_reviewer_fixture_real_env_missing");
  }

  mkdirSync(outputDir, { recursive: true });
  writeJson(outputDir, "fixture-shadow-plan.json", {
    ...plan,
    output_dir: outputDir,
  });

  const fixtures = loadScriptSemanticReviewerFixtureSet(fixtureSetPath);
  const results: ScriptSemanticReviewerFixtureShadowCheckSampleResult[] = [];

  for (const fixture of fixtures) {
    const review = await reviewFixture(fixture);
    const record: ScriptSemanticReviewerFixtureShadowCheckSampleResult = {
      sample_id: fixture.sample_id,
      category: fixture.category,
      expected_decision: fixture.expected_decision,
      expected_patch_intent: fixture.expected_patch_intent,
      actual_decision: review.decision,
      actual_patch_intent: review.patch_intent,
      matched:
        review.decision === fixture.expected_decision &&
        review.patch_intent === fixture.expected_patch_intent,
      hard_issue_count: review.hard_issues.length,
      soft_issue_count: review.soft_issues.length,
      patch_target_count: review.patch_targets.length,
      summary: review.summary,
      confidence: review.confidence,
    };

    results.push(record);
    writeJson(outputDir, `${fixture.sample_id}.json`, record);
  }

  const matchedFixtures = results.filter((item) => item.matched).length;
  const result: ScriptSemanticReviewerFixtureShadowCheckResult = {
    ...plan,
    mode: "script_semantic_reviewer_fixture_shadow_check",
    output_dir: outputDir,
    matched_fixtures: matchedFixtures,
    mismatched_fixtures: results.length - matchedFixtures,
    results,
  };

  writeJson(outputDir, "fixture-shadow-summary.json", {
    mode: result.mode,
    automated_gate: result.automated_gate,
    reviewer_mode: result.reviewer_mode,
    fixture_set_path: result.fixture_set_path,
    output_dir: result.output_dir,
    total_fixtures: result.total_fixtures,
    matched_fixtures: result.matched_fixtures,
    mismatched_fixtures: result.mismatched_fixtures,
    results: result.results,
  });
  writeFixtureTrace(outputDir, result);

  return result;
}

function createDefaultReviewFixture() {
  const gateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider: createOpenAiCompatibleProvider({}),
  });

  return (fixture: ScriptSemanticReviewerFixture) =>
    reviewScriptSemantics({
      bundle: fixture.bundle,
      draft: fixture.draft,
      llmGateway: gateway,
    });
}

function writeFixtureTrace(
  outputDir: string,
  result: ScriptSemanticReviewerFixtureShadowCheckResult,
) {
  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# script semantic reviewer fixture shadow check",
      "",
      `- mode: ${result.mode}`,
      `- automated_gate: ${result.automated_gate}`,
      `- reviewer_mode: ${result.reviewer_mode}`,
      `- total_fixtures: ${result.total_fixtures}`,
      `- matched_fixtures: ${result.matched_fixtures}`,
      `- mismatched_fixtures: ${result.mismatched_fixtures}`,
      `- fixture_set_path: ${result.fixture_set_path}`,
      `- output_dir: ${result.output_dir}`,
      "",
      "## Required Checks",
      "",
      ...result.required_checks.map((item) => `- ${item}`),
      "",
      "## Fixtures",
      "",
      ...result.results.map(
        (item) =>
          `- ${item.sample_id}: expected=${item.expected_decision}/${item.expected_patch_intent ?? "null"}, actual=${item.actual_decision}/${item.actual_patch_intent ?? "null"}, ${item.matched ? "matched" : "mismatched"}`,
      ),
    ].join("\n"),
    "utf8",
  );
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
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

function parseCliArgs(argv: string[]) {
  const result: ScriptSemanticReviewerFixtureShadowCheckInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--fixture-set" && next) {
      result.fixtureSetPath = next;
      index += 1;
      continue;
    }

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (!current.startsWith("--") && current.endsWith(".md") && !result.fixtureSetPath) {
      result.fixtureSetPath = current;
      continue;
    }

    if (!current.startsWith("--") && !result.outputDir) {
      result.outputDir = current;
    }
  }

  return result;
}

async function main() {
  const result = await runScriptSemanticReviewerFixtureShadowCheck(
    parseCliArgs(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "script-semantic-reviewer-fixture-shadow-completed",
        output_dir: result.output_dir,
        total_fixtures: result.total_fixtures,
        matched_fixtures: result.matched_fixtures,
        mismatched_fixtures: result.mismatched_fixtures,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
