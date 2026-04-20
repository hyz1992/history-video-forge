import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
    output_dir:
      input.outputDir ??
      resolve(process.cwd(), "harness/scripts/runtime/output/topic-script-live-check"),
    required_artifacts: [
      "topic-candidates.json",
      "topic-package.json",
      "script-input-bundle.json",
      "script-draft.json",
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

  writeFileSync(
    resolve(plan.output_dir, "live-check-plan.json"),
    JSON.stringify(plan, null, 2),
    "utf8",
  );

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

function parseCliArgs(argv: string[]) {
  const result: BuildTopicScriptLiveCheckPlanInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

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
    }
  }

  return result;
}

async function main() {
  const plan = writeTopicScriptLiveCheckPlan(parseCliArgs(process.argv.slice(2)));
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
