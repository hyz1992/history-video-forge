import { describe, expect, it } from "vitest";

import { validateDocuments } from "./check-schema-doc-drift.ts";

describe("check schema doc drift", () => {
  it("field-design 缺少核心对象时返回错误", () => {
    const result = validateDocuments({
      "docs/data/field-design.md": "只写了 TopicCandidateCard 和 TopicDeliveryPack",
      "docs/data/schema-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
      "docs/architecture/api-design.md":
        "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
    });

    expect(
      result.some(
        (issue) =>
          issue.includes("docs/data/field-design.md") &&
          issue.includes("TopicPackage"),
      ),
    ).toBe(true);
  });

  it("schema-design 缺少关键字段时返回错误", () => {
    const result = validateDocuments({
      "docs/data/field-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review",
      "docs/data/schema-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric",
      "docs/architecture/api-design.md":
        "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
    });

    expect(
      result.some(
        (issue) =>
          issue.includes("docs/data/schema-design.md") &&
          issue.includes("narrative_tension_map"),
      ),
    ).toBe(true);
  });

  it("api-design 缺少脚本审校关键信号时返回错误", () => {
    const result = validateDocuments({
      "docs/data/field-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review",
      "docs/data/schema-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
      "docs/architecture/api-design.md":
        "viral_rubric narrative_tension_map hook_claim script_local_validation",
    });

    expect(
      result.some(
        (issue) =>
          issue.includes("docs/architecture/api-design.md") &&
          issue.includes("patch_intent"),
      ),
    ).toBe(true);
  });

  it("合法最小文档集合不返回错误", () => {
    const result = validateDocuments({
      "docs/data/field-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review stakes source_anchor_refs canonical_quotes ambiguity_notes",
      "docs/data/schema-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
      "docs/architecture/api-design.md":
        "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
      "docs/architecture/topic-stage-design.md":
        "Topic Package stakes source_anchor_refs canonical_quotes ambiguity_notes",
      "docs/architecture/script-stage-design.md":
        "Script Input Bundle hard_lane core_conflict stakes source_anchor_refs canonical_quotes ambiguity_notes",
    });

    expect(result).toEqual([]);
  });

  it("topic-stage-design 缺少 Topic Package 故事合同字段时返回错误", () => {
    const result = validateDocuments({
      "docs/data/field-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review stakes source_anchor_refs canonical_quotes ambiguity_notes",
      "docs/data/schema-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
      "docs/architecture/api-design.md":
        "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
      "docs/architecture/topic-stage-design.md":
        "Topic Package stakes canonical_quotes",
      "docs/architecture/script-stage-design.md":
        "Script Input Bundle hard_lane core_conflict stakes source_anchor_refs canonical_quotes ambiguity_notes",
    });

    expect(
      result.some(
        (issue) =>
          issue.includes("docs/architecture/topic-stage-design.md") &&
          issue.includes("source_anchor_refs"),
      ),
    ).toBe(true);
  });

  it("script-stage-design 缺少 hard_lane 承接关系时返回错误", () => {
    const result = validateDocuments({
      "docs/data/field-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review stakes source_anchor_refs canonical_quotes ambiguity_notes",
      "docs/data/schema-design.md":
        "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
      "docs/architecture/api-design.md":
        "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
      "docs/architecture/topic-stage-design.md":
        "Topic Package stakes source_anchor_refs canonical_quotes ambiguity_notes",
      "docs/architecture/script-stage-design.md":
        "Script Input Bundle core_conflict stakes canonical_quotes",
    });

    expect(
      result.some(
        (issue) =>
          issue.includes("docs/architecture/script-stage-design.md") &&
          issue.includes("hard_lane"),
      ),
    ).toBe(true);
  });
});
