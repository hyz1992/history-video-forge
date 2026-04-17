import { existsSync } from "node:fs";
import { resolve } from "node:path";

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

const missing = requiredPaths.filter((item) => !existsSync(resolve(process.cwd(), item)));

if (missing.length > 0) {
  console.error("fast-checks 失败，缺少以下文件：");
  for (const item of missing) {
    console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log("fast-checks 通过：关键 harness 文件存在。");

