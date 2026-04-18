import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOC_TERM_RULES: Record<string, string[]> = {
  "docs/data/field-design.md": [
    "TopicCandidateCard",
    "TopicPackage",
    "TopicDeliveryPack",
    "ScriptValidationResult",
    "viral_rubric",
    "narrative_tension_map",
    "hook_claim",
    "hook_emotion",
    "reveal_position",
    "patch_intent",
    "script_local_validation",
    "script_semantic_review",
  ],
  "docs/data/schema-design.md": [
    "TopicCandidateCard",
    "TopicPackage",
    "TopicDeliveryPack",
    "ScriptValidationResult",
    "viral_rubric",
    "narrative_tension_map",
  ],
  "docs/architecture/api-design.md": [
    "viral_rubric",
    "narrative_tension_map",
    "hook_claim",
    "patch_intent",
    "script_local_validation",
  ],
};

export function validateDocuments(documents: Record<string, string>): string[] {
  const issues: string[] = [];

  for (const [relativePath, requiredTerms] of Object.entries(DOC_TERM_RULES)) {
    const content = documents[relativePath];
    if (typeof content !== "string") {
      issues.push(`缺少目标文档内容：${relativePath}`);
      continue;
    }

    for (const term of requiredTerms) {
      if (!content.includes(term)) {
        issues.push(`${relativePath} 缺少关键术语：${term}`);
      }
    }
  }

  return issues;
}

function loadTargetDocuments(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(DOC_TERM_RULES).map((relativePath) => [
      relativePath,
      readFileSync(resolve(process.cwd(), relativePath), "utf8"),
    ]),
  );
}

function run(): number {
  const issues = validateDocuments(loadTargetDocuments());

  if (issues.length > 0) {
    console.error("schema-doc drift 检查失败：");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    return 1;
  }

  console.log("schema-doc drift 检查通过：核心文档中的关键对象与字段命名保持一致。");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exit(run());
}
