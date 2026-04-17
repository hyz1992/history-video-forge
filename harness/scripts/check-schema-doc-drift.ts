import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredTerms = [
  "TopicCandidateCard",
  "TopicPackage",
  "TopicDeliveryPack",
  "ScriptValidationResult",
];

const targetDocs = [
  "docs/data/field-design.md",
  "docs/data/schema-design.md",
  "docs/architecture/api-design.md",
  "docs/plans/2026-04-17-topic-script-foundation-implementation-plan.md",
];

let hasError = false;

for (const relativePath of targetDocs) {
  const absolutePath = resolve(process.cwd(), relativePath);
  const content = readFileSync(absolutePath, "utf8");
  for (const term of requiredTerms) {
    if (!content.includes(term)) {
      console.error(`schema-doc drift 检查失败：${relativePath} 缺少关键对象名 ${term}`);
      hasError = true;
    }
  }
}

if (hasError) {
  process.exit(1);
}

console.log("schema-doc drift 检查通过：关键对象名在核心文档中均存在。");

