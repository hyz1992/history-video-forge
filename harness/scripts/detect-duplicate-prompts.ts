import { createHash } from "node:crypto";
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

const root = resolve(process.cwd(), "prompts");
const promptFiles = collectPromptFiles(root);
const groups = new Map<string, string[]>();

for (const file of promptFiles) {
  const content = readFileSync(file, "utf8").trim();
  const digest = createHash("sha256").update(content).digest("hex");
  groups.set(digest, [...(groups.get(digest) ?? []), file]);
}

const duplicates = [...groups.values()].filter((group) => group.length > 1);

if (duplicates.length > 0) {
  console.error("发现完全重复的 prompt 文件：");
  for (const group of duplicates) {
    console.error(`- ${group.join(" | ")}`);
  }
  process.exit(1);
}

console.log(`duplicate-prompts 检查通过，共检查 ${promptFiles.length} 个 prompt 文件。`);

