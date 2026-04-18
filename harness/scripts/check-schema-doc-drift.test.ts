import test from "node:test";
import assert from "node:assert/strict";

import { validateDocuments } from "./check-schema-doc-drift.ts";

test("field-design 缺少核心对象时返回错误", () => {
  const result = validateDocuments({
    "docs/data/field-design.md": "只写了 TopicCandidateCard 和 TopicDeliveryPack",
    "docs/data/schema-design.md": "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
    "docs/architecture/api-design.md": "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
  });

  assert.ok(
    result.some((issue) =>
      issue.includes("docs/data/field-design.md") && issue.includes("TopicPackage"),
    ),
  );
});

test("schema-design 缺少关键字段时返回错误", () => {
  const result = validateDocuments({
    "docs/data/field-design.md":
      "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review",
    "docs/data/schema-design.md":
      "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric",
    "docs/architecture/api-design.md":
      "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
  });

  assert.ok(
    result.some((issue) =>
      issue.includes("docs/data/schema-design.md") && issue.includes("narrative_tension_map"),
    ),
  );
});

test("api-design 缺少脚本审校关键信号时返回错误", () => {
  const result = validateDocuments({
    "docs/data/field-design.md":
      "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review",
    "docs/data/schema-design.md":
      "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
    "docs/architecture/api-design.md":
      "viral_rubric narrative_tension_map hook_claim script_local_validation",
  });

  assert.ok(
    result.some((issue) =>
      issue.includes("docs/architecture/api-design.md") && issue.includes("patch_intent"),
    ),
  );
});

test("合法最小文档集合不返回错误", () => {
  const result = validateDocuments({
    "docs/data/field-design.md":
      "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map hook_claim hook_emotion reveal_position patch_intent script_local_validation script_semantic_review",
    "docs/data/schema-design.md":
      "TopicCandidateCard TopicPackage TopicDeliveryPack ScriptValidationResult viral_rubric narrative_tension_map",
    "docs/architecture/api-design.md":
      "viral_rubric narrative_tension_map hook_claim patch_intent script_local_validation",
  });

  assert.deepEqual(result, []);
});
