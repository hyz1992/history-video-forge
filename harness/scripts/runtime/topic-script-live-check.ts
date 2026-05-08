import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { TopicPackage } from "../../../shared/src/index";
import {
  assessTopicPackageScriptSufficiency,
  type TopicPackageScriptSufficiencyReport,
} from "../../../backend/src/modules/topic/topic-package-script-sufficiency";
import {
  runTopicScriptSmoke,
  type RunTopicScriptSmokeInput,
  type RunTopicScriptSmokeResult,
} from "./topic-script-smoke";
import {
  DEFAULT_TOPIC_SCRIPT_REGRESSION_FAMILY_SET_PATH,
  loadTopicScriptRegressionFamilySet,
} from "./topic-script-regression";

export interface BuildTopicScriptLiveCheckPlanInput {
  samplePaths?: string[];
  familySetPath?: string;
  outputDir?: string;
}

export interface TopicScriptLiveCheckPlan {
  mode: "real_runtime_live_check";
  automated_gate: false;
  requires_real_env: true;
  family_set_path: string;
  total_samples: number;
  sample_paths: string[];
  output_dir: string;
  required_artifacts: string[];
  required_checks: string[];
}

export interface TopicScriptLiveCheckSampleResult {
  sample_id: string;
  sample_path: string;
  project_id: string;
  status: string;
  output_dir: string;
  local_validation_decision: string | null;
  semantic_review_decision: string | null;
  topic_package_sufficiency: TopicPackageScriptSufficiencyReport | null;
  graph_nodes: Array<{
    node_name: string;
    input_ref: string | null;
    output_ref: string | null;
    failure_reason: string | null;
  }>;
}

export interface TopicScriptLiveCheckResult extends TopicScriptLiveCheckPlan {
  passed_samples: number;
  failed_samples: number;
  sample_ready_samples: number;
  local_validation_passed_samples: number;
  local_validation_failed_samples: number;
  local_validation_unknown_samples: number;
  semantic_shadow_passed_samples: number;
  semantic_shadow_skipped_samples: number;
  semantic_shadow_attention_samples: number;
  semantic_shadow_unknown_samples: number;
  topic_package_sufficiency_ok_samples: number;
  topic_package_sufficiency_observe_samples: number;
  topic_package_sufficiency_needs_attention_samples: number;
  topic_package_sufficiency_unknown_samples: number;
  results: TopicScriptLiveCheckSampleResult[];
}

export interface TopicScriptLiveCheckDependencies {
  requireRealEnv?: boolean;
  sampleRunner?: (input: RunTopicScriptSmokeInput) => Promise<RunTopicScriptSmokeResult>;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/topic-script-live-check",
);

function resolveLiveCheckSamplePaths(
  input: BuildTopicScriptLiveCheckPlanInput,
): {
  samplePaths: string[];
  familySetPath: string;
} {
  const familySetPath =
    input.familySetPath ?? DEFAULT_TOPIC_SCRIPT_REGRESSION_FAMILY_SET_PATH;
  const samplePaths =
    input.samplePaths && input.samplePaths.length > 0
      ? input.samplePaths
      : loadTopicScriptRegressionFamilySet(familySetPath);

  return {
    samplePaths,
    familySetPath,
  };
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function readDecisionArtifact(outputDir: string, filename: string): string | null {
  const artifactPath = resolve(outputDir, filename);
  if (!existsSync(artifactPath)) {
    return null;
  }

  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    decision?: unknown;
  };

  return typeof artifact.decision === "string" ? artifact.decision : null;
}

function readTopicPackageSufficiency(
  outputDir: string,
): TopicPackageScriptSufficiencyReport | null {
  const artifactPath = resolve(outputDir, "topic-package.json");
  if (!existsSync(artifactPath)) {
    return null;
  }

  const topicPackage = JSON.parse(readFileSync(artifactPath, "utf8")) as TopicPackage;

  return assessTopicPackageScriptSufficiency(topicPackage);
}

function getSampleOutputDir(baseOutputDir: string, samplePath: string, occurrence = 1) {
  const sampleName = basename(samplePath, ".sample.json");
  const outputName = occurrence > 1 ? `${sampleName}-repeat-${occurrence}` : sampleName;
  return resolve(baseOutputDir, outputName);
}

export function buildTopicScriptLiveCheckPlan(
  input: BuildTopicScriptLiveCheckPlanInput = {},
): TopicScriptLiveCheckPlan {
  const { samplePaths, familySetPath } = resolveLiveCheckSamplePaths(input);

  return {
    mode: "real_runtime_live_check",
    automated_gate: false,
    requires_real_env: true,
    family_set_path: familySetPath,
    total_samples: samplePaths.length,
    sample_paths: samplePaths,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    required_artifacts: [
      "topic-candidates.json",
      "topic-package.json",
      "script-input-bundle.json",
      "script-draft.json",
      "topic-candidate-preview-trace.json",
      "graph-trace-summary.json",
      "runtime-diagnostics.json",
      "trace.md",
    ],
    required_checks: [
      "确认已配置真实 .env，不把 live check 作为默认自动化 gate。",
      "确认指定 family set 或样本集，避免临时输入漂移。",
      "确认输出 graph trace、runtime diagnostics 与 script artifact。",
    ],
  };
}

export function writeTopicScriptLiveCheckPlan(
  input: BuildTopicScriptLiveCheckPlanInput = {},
): TopicScriptLiveCheckPlan {
  const plan = buildTopicScriptLiveCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });

  writeJson(plan.output_dir, "live-check-plan.json", plan);
  writeFileSync(
    resolve(plan.output_dir, "trace.md"),
    [
      "# topic-script live check plan",
      "",
      `- mode: ${plan.mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- requires_real_env: ${plan.requires_real_env}`,
      `- total_samples: ${plan.total_samples}`,
      `- family_set_path: ${plan.family_set_path}`,
      `- output_dir: ${plan.output_dir}`,
      "",
      "## Required Checks",
      "",
      ...plan.required_checks.map((item) => `- ${item}`),
      "",
      "## Required Artifacts",
      "",
      ...plan.required_artifacts.map((item) => `- ${item}`),
      "",
      "## Sample Paths",
      "",
      ...plan.sample_paths.map((item) => `- ${item}`),
    ].join("\n"),
    "utf8",
  );

  return plan;
}

export async function runTopicScriptLiveCheck(
  input: BuildTopicScriptLiveCheckPlanInput = {},
  dependencies: TopicScriptLiveCheckDependencies = {},
): Promise<TopicScriptLiveCheckResult> {
  const plan = writeTopicScriptLiveCheckPlan(input);
  const requireRealEnv = dependencies.requireRealEnv ?? true;
  const sampleRunner = dependencies.sampleRunner ?? runTopicScriptSmoke;

  if (requireRealEnv && !existsSync(resolve(process.cwd(), ".env"))) {
    throw new Error("live_check_real_env_missing");
  }

  const results: TopicScriptLiveCheckSampleResult[] = [];
  const sampleNameCounts = new Map<string, number>();

  for (const samplePath of plan.sample_paths) {
    const sampleName = basename(samplePath, ".sample.json");
    const occurrence = (sampleNameCounts.get(sampleName) ?? 0) + 1;
    sampleNameCounts.set(sampleName, occurrence);
    const sampleOutputDir = getSampleOutputDir(plan.output_dir, samplePath, occurrence);
    const smokeResult = await sampleRunner({
      samplePath,
      outputDir: sampleOutputDir,
    });

    results.push({
      sample_id: smokeResult.sample.sample_id,
      sample_path: samplePath,
      project_id: smokeResult.status.projectId,
      status: smokeResult.status.status,
      output_dir: smokeResult.outputDir,
      local_validation_decision: readDecisionArtifact(
        smokeResult.outputDir,
        "validation-result.json",
      ),
      semantic_review_decision: readDecisionArtifact(
        smokeResult.outputDir,
        "semantic-review-result.json",
      ),
      topic_package_sufficiency: readTopicPackageSufficiency(smokeResult.outputDir),
      graph_nodes: smokeResult.status.graphTraceSummary.nodes,
    });
  }

  const sampleReadySamples = results.filter((item) => item.status === "sample-ready").length;
  const failedSamples = results.filter((item) => item.status !== "sample-ready").length;
  const localValidationPassedSamples = results.filter(
    (item) => item.local_validation_decision === "pass",
  ).length;
  const localValidationFailedSamples = results.filter(
    (item) =>
      item.local_validation_decision !== null && item.local_validation_decision !== "pass",
  ).length;
  const localValidationUnknownSamples = results.filter(
    (item) => item.local_validation_decision === null,
  ).length;
  const semanticShadowPassedSamples = results.filter(
    (item) => item.semantic_review_decision === "pass",
  ).length;
  const semanticShadowSkippedSamples = results.filter(
    (item) => item.semantic_review_decision === "skipped",
  ).length;
  const semanticShadowAttentionSamples = results.filter(
    (item) =>
      item.semantic_review_decision !== null &&
      item.semantic_review_decision !== "pass" &&
      item.semantic_review_decision !== "skipped",
  ).length;
  const semanticShadowUnknownSamples = results.filter(
    (item) => item.semantic_review_decision === null,
  ).length;
  const topicPackageSufficiencyOkSamples = results.filter(
    (item) => item.topic_package_sufficiency?.status === "ok",
  ).length;
  const topicPackageSufficiencyObserveSamples = results.filter(
    (item) => item.topic_package_sufficiency?.status === "observe",
  ).length;
  const topicPackageSufficiencyNeedsAttentionSamples = results.filter(
    (item) => item.topic_package_sufficiency?.status === "needs_attention",
  ).length;
  const topicPackageSufficiencyUnknownSamples = results.filter(
    (item) => item.topic_package_sufficiency === null,
  ).length;

  const summary = {
    mode: plan.mode,
    automated_gate: plan.automated_gate,
    requires_real_env: plan.requires_real_env,
    total_samples: plan.total_samples,
    passed_samples: sampleReadySamples,
    failed_samples: failedSamples,
    sample_ready_samples: sampleReadySamples,
    local_validation_passed_samples: localValidationPassedSamples,
    local_validation_failed_samples: localValidationFailedSamples,
    local_validation_unknown_samples: localValidationUnknownSamples,
    semantic_shadow_passed_samples: semanticShadowPassedSamples,
    semantic_shadow_skipped_samples: semanticShadowSkippedSamples,
    semantic_shadow_attention_samples: semanticShadowAttentionSamples,
    semantic_shadow_unknown_samples: semanticShadowUnknownSamples,
    topic_package_sufficiency_ok_samples: topicPackageSufficiencyOkSamples,
    topic_package_sufficiency_observe_samples: topicPackageSufficiencyObserveSamples,
    topic_package_sufficiency_needs_attention_samples:
      topicPackageSufficiencyNeedsAttentionSamples,
    topic_package_sufficiency_unknown_samples:
      topicPackageSufficiencyUnknownSamples,
    samples: results,
  };

  writeJson(plan.output_dir, "live-check-summary.json", summary);
  writeFileSync(
    resolve(plan.output_dir, "trace.md"),
    [
      "# topic-script live check trace",
      "",
      `- mode: ${plan.mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- requires_real_env: ${plan.requires_real_env}`,
      `- total_samples: ${plan.total_samples}`,
      `- passed_samples: ${summary.passed_samples}`,
      `- failed_samples: ${summary.failed_samples}`,
      `- sample_ready_samples: ${summary.sample_ready_samples}`,
      `- local_validation_passed_samples: ${summary.local_validation_passed_samples}`,
      `- local_validation_failed_samples: ${summary.local_validation_failed_samples}`,
      `- local_validation_unknown_samples: ${summary.local_validation_unknown_samples}`,
      `- semantic_shadow_passed_samples: ${summary.semantic_shadow_passed_samples}`,
      `- semantic_shadow_skipped_samples: ${summary.semantic_shadow_skipped_samples}`,
      `- semantic_shadow_attention_samples: ${summary.semantic_shadow_attention_samples}`,
      `- semantic_shadow_unknown_samples: ${summary.semantic_shadow_unknown_samples}`,
      `- topic_package_sufficiency_ok_samples: ${summary.topic_package_sufficiency_ok_samples}`,
      `- topic_package_sufficiency_observe_samples: ${summary.topic_package_sufficiency_observe_samples}`,
      `- topic_package_sufficiency_needs_attention_samples: ${summary.topic_package_sufficiency_needs_attention_samples}`,
      `- topic_package_sufficiency_unknown_samples: ${summary.topic_package_sufficiency_unknown_samples}`,
      `- family_set_path: ${plan.family_set_path}`,
      `- output_dir: ${plan.output_dir}`,
      "",
      "## Required Checks",
      "",
      ...plan.required_checks.map((item) => `- ${item}`),
      "",
      "## Samples",
      "",
      ...results.flatMap((item) => [
        `- ${item.sample_id}: ${item.status}`,
        `  - output_dir: ${item.output_dir}`,
        `  - local_validation_decision: ${item.local_validation_decision ?? "unknown"}`,
        `  - semantic_review_decision: ${item.semantic_review_decision ?? "unknown"}`,
        `  - topic_package_sufficiency: ${item.topic_package_sufficiency?.status ?? "unknown"}`,
        ...item.graph_nodes.map(
          (node) =>
            `  - ${node.node_name}: ${node.input_ref ?? "null"} -> ${node.output_ref ?? "null"}`,
        ),
      ]),
    ].join("\n"),
    "utf8",
  );

  return {
    ...plan,
    passed_samples: summary.passed_samples,
    failed_samples: summary.failed_samples,
    sample_ready_samples: summary.sample_ready_samples,
    local_validation_passed_samples: summary.local_validation_passed_samples,
    local_validation_failed_samples: summary.local_validation_failed_samples,
    local_validation_unknown_samples: summary.local_validation_unknown_samples,
    semantic_shadow_passed_samples: summary.semantic_shadow_passed_samples,
    semantic_shadow_skipped_samples: summary.semantic_shadow_skipped_samples,
    semantic_shadow_attention_samples: summary.semantic_shadow_attention_samples,
    semantic_shadow_unknown_samples: summary.semantic_shadow_unknown_samples,
    topic_package_sufficiency_ok_samples:
      summary.topic_package_sufficiency_ok_samples,
    topic_package_sufficiency_observe_samples:
      summary.topic_package_sufficiency_observe_samples,
    topic_package_sufficiency_needs_attention_samples:
      summary.topic_package_sufficiency_needs_attention_samples,
    topic_package_sufficiency_unknown_samples:
      summary.topic_package_sufficiency_unknown_samples,
    results,
  };
}

function parseCliArgs(argv: string[]) {
  const result: BuildTopicScriptLiveCheckPlanInput & { planOnly: boolean } = {
    planOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--plan-only") {
      result.planOnly = true;
      continue;
    }

    if (current === "--family-set" && next) {
      result.familySetPath = next;
      index += 1;
      continue;
    }

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (current === "--sample" && next) {
      result.samplePaths = [...(result.samplePaths ?? []), next];
      index += 1;
      continue;
    }

    if (!current.startsWith("--") && !result.familySetPath && !result.samplePaths?.length) {
      result.familySetPath = current;
    }
  }

  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.planOnly) {
    const plan = writeTopicScriptLiveCheckPlan(args);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "live-check-plan-ready",
          output_dir: plan.output_dir,
          total_samples: plan.total_samples,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const result = await runTopicScriptLiveCheck(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "live-check-completed",
        output_dir: result.output_dir,
        total_samples: result.total_samples,
        passed_samples: result.passed_samples,
        failed_samples: result.failed_samples,
        sample_ready_samples: result.sample_ready_samples,
        local_validation_passed_samples: result.local_validation_passed_samples,
        local_validation_failed_samples: result.local_validation_failed_samples,
        local_validation_unknown_samples: result.local_validation_unknown_samples,
        semantic_shadow_passed_samples: result.semantic_shadow_passed_samples,
        semantic_shadow_skipped_samples: result.semantic_shadow_skipped_samples,
        semantic_shadow_attention_samples: result.semantic_shadow_attention_samples,
        semantic_shadow_unknown_samples: result.semantic_shadow_unknown_samples,
        topic_package_sufficiency_ok_samples:
          result.topic_package_sufficiency_ok_samples,
        topic_package_sufficiency_observe_samples:
          result.topic_package_sufficiency_observe_samples,
        topic_package_sufficiency_needs_attention_samples:
          result.topic_package_sufficiency_needs_attention_samples,
        topic_package_sufficiency_unknown_samples:
          result.topic_package_sufficiency_unknown_samples,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
