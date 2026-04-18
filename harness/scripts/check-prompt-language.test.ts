import test from "node:test";
import assert from "node:assert/strict";

import { validatePromptContent } from "./check-prompt-language.ts";

test("缺少必需元数据时返回错误", () => {
  const content = `---
id: topic.candidate-builder
stage: topic
consumes:
  - RecommendationSeedSet
produces:
  - TopicCandidateCard[]
status: active
---

# 任务

生成选题候选。`;

  const issues = validatePromptContent(
    "harness/prompts/topic/candidate-builder.prompt.md",
    content,
  );

  assert.ok(issues.some((issue) => issue.includes("language")));
});

test("正文缺少中文时返回错误", () => {
  const content = `---
id: script.writer
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
produces:
  - ScriptDraftPackage
status: active
---

# Task

Write the script draft package.`;

  const issues = validatePromptContent(
    "harness/prompts/script/script-writer.prompt.md",
    content,
  );

  assert.ok(issues.some((issue) => issue.includes("中文")));
});

test("stage 与目录不一致时返回错误", () => {
  const content = `---
id: topic.light-review
stage: script
language: zh-CN
consumes:
  - TopicCandidateCard[]
produces:
  - TopicLightReviewResult
status: active
---

# 任务

对候选选题做轻量语义评审。`;

  const issues = validatePromptContent(
    "harness/prompts/topic/light-review.prompt.md",
    content,
  );

  assert.ok(issues.some((issue) => issue.includes("stage")));
});

test("合法 prompt 不返回错误", () => {
  const content = `---
id: script.semantic-reviewer
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
  - ScriptDraftPackage
produces:
  - ScriptSemanticReviewResult
status: active
---

# 任务

对脚本草稿进行单一语义审校，并且只输出结构化结论。`;

  const issues = validatePromptContent(
    "harness/prompts/script/semantic-reviewer.prompt.md",
    content,
  );

  assert.deepEqual(issues, []);
});
