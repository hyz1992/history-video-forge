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
    "stakes",
    "source_anchor_refs",
    "canonical_quotes",
    "ambiguity_notes",
    "GenerationConfigurationV1",
    "ProviderModelCatalog",
    "GenerationCostQuote",
    "RunConfigurationSnapshot",
    "GenerationRun",
    "UsageCostRecord",
  ],
  "docs/data/schema-design.md": [
    "TopicCandidateCard",
    "TopicPackage",
    "TopicDeliveryPack",
    "ScriptValidationResult",
    "viral_rubric",
    "narrative_tension_map",
    "provider_model_catalog",
    "run_configuration_snapshots",
    "generation_runs",
    "usage_cost_records",
    "api_video_suitability",
  ],
  "docs/architecture/api-design.md": [
    "viral_rubric",
    "narrative_tension_map",
    "hook_claim",
    "patch_intent",
    "script_local_validation",
    "discovery seed",
    "focus seed",
    "generation-preferences",
    "generation-configuration",
    "generation-capabilities",
    "costs/summary",
    "accept-fallback",
  ],
  "docs/architecture/topic-stage-design.md": [
    "Topic Package",
    "stakes",
    "source_anchor_refs",
    "canonical_quotes",
    "ambiguity_notes",
    "discovery seed",
    "focus seed",
  ],
  "docs/architecture/script-stage-design.md": [
    "Script Input Bundle",
    "hard_lane",
    "core_conflict",
    "stakes",
    "source_anchor_refs",
    "canonical_quotes",
    "ambiguity_notes",
  ],
  "docs/architecture/pipeline-io-spec.md": [
    "api_video_suitability",
    "RunConfigurationSnapshotV1",
    "StoryboardSegmentOverride",
    "UsageCostRecord",
    "pricing_overrun",
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
