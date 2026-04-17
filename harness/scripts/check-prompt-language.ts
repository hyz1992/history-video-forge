import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function collectPromptFiles(dir: string, result: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectPromptFiles(fullPath, result);
      continue;
    }
    if (name.endsWith(".prompt.md")) {
      result.push(fullPath);
    }
  }
  return result;
}

const root = resolve(process.cwd(), "harness/prompts");
const promptFiles = collectPromptFiles(root);
const invalid: string[] = [];

for (const file of promptFiles) {
  const content = readFileSync(file, "utf8");
  if (!content.includes("language: zh-CN")) {
    invalid.push(file);
  }
}

if (invalid.length > 0) {
  console.error("以下正式 prompt 未显式声明 language: zh-CN：");
  for (const file of invalid) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`prompt-language 检查通过，共检查 ${promptFiles.length} 个 prompt 文件。`);

