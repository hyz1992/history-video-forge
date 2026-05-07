import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { LlmGateway } from "../../../backend/src/runtime/llm/llm-gateway";
import { runScriptWritingBriefShadow } from "./script-writing-brief-shadow";

export interface RunScriptBriefShadowFiveRoundCheckInput {
  sourceOutputDir: string;
  llmGateway?: LlmGateway;
}

export async function runScriptBriefShadowFiveRoundCheck(
  input: RunScriptBriefShadowFiveRoundCheckInput,
) {
  const root = resolve(process.cwd(), input.sourceOutputDir);
  const sampleDirs = readdirSync(root)
    .map((entry) => join(root, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .filter((entry) => existsSync(join(entry, "topic-package.json")));
  const writtenFiles: string[] = [];

  for (const sampleDir of sampleDirs) {
    const result = await runScriptWritingBriefShadow({
      topicPackagePath: join(sampleDir, "topic-package.json"),
      outputDir: sampleDir,
      llmGateway: input.llmGateway,
    });
    writtenFiles.push(result.outputPath);
  }

  return {
    sourceOutputDir: root,
    processedSamples: sampleDirs.length,
    writtenFiles,
  };
}

export function parseScriptBriefShadowFiveRoundArgs(argv: string[]): {
  sourceOutputDir: string | undefined;
} {
  const flagIndex = argv.indexOf("--source-output-dir");
  if (flagIndex >= 0) {
    return {
      sourceOutputDir: argv[flagIndex + 1],
    };
  }

  return {
    sourceOutputDir: argv[2],
  };
}

if (require.main === module) {
  const { sourceOutputDir } = parseScriptBriefShadowFiveRoundArgs(process.argv);
  if (!sourceOutputDir) {
    throw new Error("missing --source-output-dir");
  }
  runScriptBriefShadowFiveRoundCheck({ sourceOutputDir })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
