import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
      graph_nodes: smokeResult.status.graphTraceSummary.nodes,
    });
  }

  const summary = {
    mode: plan.mode,
    automated_gate: plan.automated_gate,
    requires_real_env: plan.requires_real_env,
    total_samples: plan.total_samples,
    passed_samples: results.filter((item) => item.status === "sample-ready").length,
    failed_samples: results.filter((item) => item.status !== "sample-ready").length,
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
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
