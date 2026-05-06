import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  runTopicScriptLiveCheck,
  type BuildTopicScriptLiveCheckPlanInput,
  type TopicScriptLiveCheckDependencies,
  type TopicScriptLiveCheckPlan,
  type TopicScriptLiveCheckResult,
} from "./topic-script-live-check";

const FIVE_ROUND_SAMPLE_PATHS = [
  "harness/samples/topic-script/yanzi-shichu.sample.json",
  "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
  "harness/samples/topic-script/julu-zhizhan.sample.json",
  "harness/samples/topic-script/hongmenyan.sample.json",
  "harness/samples/topic-script/yanzi-shichu.sample.json",
];

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/topic-script-five-round-quality-check",
);

export interface TopicScriptFiveRoundQualityCheckInput
  extends Omit<BuildTopicScriptLiveCheckPlanInput, "samplePaths" | "familySetPath"> {}

export function buildTopicScriptFiveRoundQualityCheckPlan(
  input: TopicScriptFiveRoundQualityCheckInput = {},
): TopicScriptLiveCheckPlan {
  return {
    mode: "real_runtime_live_check",
    automated_gate: false,
    requires_real_env: true,
    family_set_path: "inline:topic-script-five-round-quality-check",
    total_samples: FIVE_ROUND_SAMPLE_PATHS.length,
    sample_paths: FIVE_ROUND_SAMPLE_PATHS,
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
      "Requires real .env and must be run explicitly outside the default automated gate.",
      "Runs 5 topic -> script samples, including one repeated sample to observe model variance.",
      "Semantic reviewer remains shadow-only and must not drive patch or main-chain actions.",
      "Review live-check-summary.json plus script artifacts by reading the generated outputs.",
    ],
  };
}

export async function runTopicScriptFiveRoundQualityCheck(
  input: TopicScriptFiveRoundQualityCheckInput = {},
  dependencies: TopicScriptLiveCheckDependencies = {},
): Promise<TopicScriptLiveCheckResult> {
  return runTopicScriptLiveCheck(
    {
      samplePaths: FIVE_ROUND_SAMPLE_PATHS,
      outputDir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    },
    dependencies,
  );
}

export function parseFiveRoundQualityCheckCliArgs(argv: string[]) {
  const result: TopicScriptFiveRoundQualityCheckInput = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
    }

    if (!current.startsWith("--") && !result.outputDir) {
      result.outputDir = current;
    }
  }

  return result;
}

async function main() {
  const result = await runTopicScriptFiveRoundQualityCheck(
    parseFiveRoundQualityCheckCliArgs(process.argv.slice(2)),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "five-round-quality-check-completed",
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
