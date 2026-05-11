import { describe, expect, it } from "vitest";

import { validatePromptContent } from "./check-prompt-language.ts";

describe("check prompt language", () => {
  it("缺少必需元数据时返回错误", () => {
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

    expect(issues.some((issue) => issue.includes("language"))).toBe(true);
  });

  it("正文缺少中文时返回错误", () => {
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

    expect(issues.some((issue) => issue.includes("中文"))).toBe(true);
  });

  it("stage 与目录不一致时返回错误", () => {
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

    expect(issues.some((issue) => issue.includes("stage"))).toBe(true);
  });

  it("合法 prompt 不返回错误", () => {
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

    expect(issues).toEqual([]);
  });

  it("允许 storyboard prompt 使用 storyboard stage 并匹配目录", () => {
    const content = `---
id: storyboard.planner
stage: storyboard
language: zh-CN
consumes:
  - ScriptDraftPackage
produces:
  - StoryboardPlan
status: active
---

# 任务

生成视觉段落计划。`;

    const issues = validatePromptContent(
      "harness/prompts/storyboard/storyboard-planner.prompt.md",
      content,
    );

    expect(issues).toEqual([]);
  });

  it("允许 asset planning prompt 使用 asset_planning stage 并匹配目录", () => {
    const content = `---
id: asset-planning.planner
stage: asset_planning
language: zh-CN
consumes:
  - StoryboardPlan
produces:
  - AssetPlan
status: active
---

# 任务

生成 AssetPlan。`;

    const issues = validatePromptContent(
      "harness/prompts/asset-planning/asset-planner.prompt.md",
      content,
    );

    expect(issues).toEqual([]);
  });
});
