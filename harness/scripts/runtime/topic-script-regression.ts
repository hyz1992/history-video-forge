import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  runTopicScriptSmoke,
  type TopicScriptSmokeSample,
} from "./topic-script-smoke";

export const DEFAULT_TOPIC_SCRIPT_REGRESSION_FAMILY_SET_PATH =
  "harness/samples/topic-script/family-set.md";

export interface TopicScriptRegressionSampleResult {
  sample_id: string;
  output_dir: string;
  status: string;
  stage: string;
  project_id?: string;
  error_code?: string;
}

export interface RunTopicScriptRegressionInput {
  samplePaths?: string[];
  familySetPath?: string;
  outputDir?: string;
}

export interface RunTopicScriptRegressionResult {
  mode: "automated_regression";
  family_set_path: string;
  total_samples: number;
  passed_samples: number;
  failed_samples: number;
  results: TopicScriptRegressionSampleResult[];
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function loadSmokeSample(samplePath: string): TopicScriptSmokeSample {
  return JSON.parse(readFileSync(resolve(process.cwd(), samplePath), "utf8")) as TopicScriptSmokeSample;
}

export function loadTopicScriptRegressionFamilySet(
  familySetPath = DEFAULT_TOPIC_SCRIPT_REGRESSION_FAMILY_SET_PATH,
): string[] {
  const content = readFileSync(resolve(process.cwd(), familySetPath), "utf8");
  const matches = [...content.matchAll(/`([^`]+\.sample\.json)`/g)];
  const samplePaths = matches.map((match) => match[1]);

  if (samplePaths.length === 0) {
    throw new Error("topic_script_regression_family_set_empty");
  }

  return samplePaths;
}

function resolveRegressionSamplePaths(input: RunTopicScriptRegressionInput): {
  samplePaths: string[];
  familySetPath: string;
} {
  const familySetPath =
    input.familySetPath ?? DEFAULT_TOPIC_SCRIPT_REGRESSION_FAMILY_SET_PATH;
  const samplePaths =
    input.samplePaths && input.samplePaths.length > 0
      ? input.samplePaths
      : loadTopicScriptRegressionFamilySet(familySetPath);

  if (samplePaths.length === 0) {
    throw new Error("topic_script_regression_samples_missing");
  }

  return {
    samplePaths,
    familySetPath,
  };
}

export async function runTopicScriptRegression(
  input: RunTopicScriptRegressionInput = {},
): Promise<RunTopicScriptRegressionResult> {
  const { samplePaths, familySetPath } = resolveRegressionSamplePaths(input);
  const finalOutputDir =
    input.outputDir ??
    resolve(process.cwd(), "harness/scripts/runtime/output/topic-script-regression");

  mkdirSync(finalOutputDir, { recursive: true });

  const results: TopicScriptRegressionSampleResult[] = [];

  for (const samplePath of samplePaths) {
    const sample = loadSmokeSample(samplePath);
    const sampleOutputDir = resolve(finalOutputDir, sample.sample_id);

    try {
      const smokeResult = await runTopicScriptSmoke({
        samplePath,
        outputDir: sampleOutputDir,
      });

      results.push({
        sample_id: sample.sample_id,
        output_dir: sampleOutputDir,
        status: smokeResult.status.status,
        stage: smokeResult.status.stage,
        project_id: smokeResult.status.projectId,
      });
    } catch (error) {
      const errorCode =
        error instanceof Error && error.message.length > 0
          ? error.message
          : "topic_script_regression_failed";

      mkdirSync(sampleOutputDir, { recursive: true });
      writeJson(sampleOutputDir, "error.json", {
        sample_id: sample.sample_id,
        error_code: errorCode,
      });

      results.push({
        sample_id: sample.sample_id,
        output_dir: sampleOutputDir,
        status: "sample-failed",
        stage: "topic-to-script",
        error_code: errorCode,
      });
    }
  }

  const passedSamples = results.filter((item) => item.status === "sample-ready").length;
  const summary: RunTopicScriptRegressionResult = {
    mode: "automated_regression",
    family_set_path: familySetPath,
    total_samples: results.length,
    passed_samples: passedSamples,
    failed_samples: results.length - passedSamples,
    results,
  };

  writeJson(finalOutputDir, "regression-summary.json", {
    mode: summary.mode,
    family_set_path: summary.family_set_path,
    total_samples: summary.total_samples,
    passed_samples: summary.passed_samples,
    failed_samples: summary.failed_samples,
    samples: summary.results,
  });

  writeFileSync(
    resolve(finalOutputDir, "trace.md"),
    [
      "# topic-script regression trace",
      "",
      `- mode: ${summary.mode}`,
      `- family_set_path: ${summary.family_set_path}`,
      `- total_samples: ${summary.total_samples}`,
      `- passed_samples: ${summary.passed_samples}`,
      `- failed_samples: ${summary.failed_samples}`,
      "",
      "## Samples",
      "",
      ...summary.results.map(
        (item) =>
          `- ${item.sample_id}: ${item.status} (${item.stage}) -> ${item.output_dir}`,
      ),
      "",
      "## 说明",
      "",
      "- 自动化回归层复用正式 topic -> script smoke 链路，不复制业务编排逻辑。",
      "- 真实模型巡检与自动化稳定回归分层，避免把实时 LLM 波动引入默认回归门。",
    ].join("\n"),
    "utf8",
  );

  return summary;
}
