import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_TOPIC_SCRIPT_REGRESSION_FAMILY_SET_PATH,
  loadTopicScriptRegressionFamilySet,
} from "./topic-script-regression";

export interface BuildTopicScriptRealRegressionPlanInput {
  samplePaths?: string[];
  familySetPath?: string;
  outputDir?: string;
}

export interface TopicScriptRealRegressionPlan {
  mode: "real_runtime_inspection";
  automated_gate: false;
  family_set_path: string;
  total_samples: number;
  sample_paths: string[];
  output_dir: string;
  suggested_live_check_command: string;
  required_checks: string[];
}

function resolveRealRegressionSamplePaths(
  input: BuildTopicScriptRealRegressionPlanInput,
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

export function buildTopicScriptRealRegressionPlan(
  input: BuildTopicScriptRealRegressionPlanInput = {},
): TopicScriptRealRegressionPlan {
  const { samplePaths, familySetPath } = resolveRealRegressionSamplePaths(input);

  return {
    mode: "real_runtime_inspection",
    automated_gate: false,
    family_set_path: familySetPath,
    total_samples: samplePaths.length,
    sample_paths: samplePaths,
    output_dir:
      input.outputDir ??
      resolve(process.cwd(), "harness/scripts/runtime/output/topic-script-real-regression"),
    suggested_live_check_command:
      "npm run harness:topic-script-live-check -- --family-set harness/samples/topic-script/family-set.md",
    required_checks: [
      "确认 topic candidates、topic package、script input bundle、script draft 全部落盘",
      "确认 local validation 为 pass，semantic review 为 pass 或 patch_once",
      "人工复核 trace 与 diagnostics 摘要，不把真实模型波动接入默认自动化门",
    ],
  };
}

export function writeTopicScriptRealRegressionPlan(
  input: BuildTopicScriptRealRegressionPlanInput = {},
): TopicScriptRealRegressionPlan {
  const plan = buildTopicScriptRealRegressionPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });

  writeFileSync(
    resolve(plan.output_dir, "real-regression-plan.json"),
    JSON.stringify(plan, null, 2),
    "utf8",
  );

  writeFileSync(
    resolve(plan.output_dir, "trace.md"),
    [
      "# topic-script real regression plan",
      "",
      `- mode: ${plan.mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- total_samples: ${plan.total_samples}`,
      `- family_set_path: ${plan.family_set_path}`,
      `- output_dir: ${plan.output_dir}`,
      `- suggested_live_check_command: ${plan.suggested_live_check_command}`,
      "",
      "## Required Checks",
      "",
      ...plan.required_checks.map((item) => `- ${item}`),
      "",
      "## Sample Paths",
      "",
      ...plan.sample_paths.map((item) => `- ${item}`),
    ].join("\n"),
    "utf8",
  );

  return plan;
}
