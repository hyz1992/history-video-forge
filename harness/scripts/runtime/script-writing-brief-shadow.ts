import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createLlmGateway, type LlmGateway } from "../../../backend/src/runtime/llm/llm-gateway";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry";
import { ScriptWritingBriefShadow } from "../../../shared/src/index";

export interface RunScriptWritingBriefShadowInput {
  topicPackagePath: string;
  outputDir: string;
  llmGateway?: LlmGateway;
}

export async function runScriptWritingBriefShadow(
  input: RunScriptWritingBriefShadowInput,
) {
  const topicPackage = JSON.parse(
    readFileSync(resolve(process.cwd(), input.topicPackagePath), "utf8"),
  );
  const gateway =
    input.llmGateway ??
    createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({}),
    });

  const rawBrief = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "script.writing-brief-shadow",
    input: {
      topic_package: topicPackage,
    },
  });
  const brief = ScriptWritingBriefShadow.parse(rawBrief);
  const finalOutputDir = resolve(process.cwd(), input.outputDir);
  mkdirSync(finalOutputDir, { recursive: true });
  const outputPath = join(finalOutputDir, "script-writing-brief-shadow.json");
  writeFileSync(outputPath, JSON.stringify(brief, null, 2), "utf8");

  return {
    outputPath,
    brief,
  };
}
