import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { collectPromptFiles, validatePromptContent } from "./check-prompt-language.ts";
import { DOC_TERM_RULES, validateDocuments } from "./check-schema-doc-drift.ts";

const requiredPaths = [
  "AGENTS.md",
  "harness/README.md",
  "harness/docs/definition-of-done.md",
  "harness/docs/review-checklist.md",
  "harness/docs/prompt-management.md",
  "harness/docs/prompt-registry-spec.md",
  "harness/prompts/topic/candidate-builder.prompt.md",
  "harness/prompts/script/script-writer.prompt.md",
  "harness/scripts/check-prompt-language.ts",
  "harness/scripts/runtime/run-topic-to-script-sample.ts",
];

function checkRequiredPaths(): string[] {
  return requiredPaths.filter((item) => !existsSync(resolve(process.cwd(), item)));
}

function checkPromptAssets(): Array<{ file: string; issues: string[] }> {
  const promptRoot = resolve(process.cwd(), "harness/prompts");
  return collectPromptFiles(promptRoot)
    .map((file) => ({
      file,
      issues: validatePromptContent(file, readFileSync(file, "utf8")),
    }))
    .filter((item) => item.issues.length > 0);
}

function checkSchemaDocDrift(): string[] {
  const documents = Object.fromEntries(
    Object.keys(DOC_TERM_RULES).map((relativePath) => [
      relativePath,
      readFileSync(resolve(process.cwd(), relativePath), "utf8"),
    ]),
  );

  return validateDocuments(documents);
}

const missing = checkRequiredPaths();
if (missing.length > 0) {
  console.error("fast-checks 失败，缺少以下关键文件：");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

const promptIssues = checkPromptAssets();
if (promptIssues.length > 0) {
  console.error("fast-checks 失败，以下 prompt 资产未通过最小检查：");
  for (const item of promptIssues) {
    console.error(`- ${item.file}`);
    for (const issue of item.issues) {
      console.error(`  - ${issue}`);
    }
  }
  process.exit(1);
}

const driftIssues = checkSchemaDocDrift();
if (driftIssues.length > 0) {
  console.error("fast-checks 失败，schema-doc drift 检查未通过：");
  for (const issue of driftIssues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("fast-checks 通过：关键 harness 文件存在，正式 prompt 资产与 schema-doc 命名检查均通过。");
