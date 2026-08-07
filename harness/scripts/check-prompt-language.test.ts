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
      "prompts/topic/candidate-builder.prompt.md",
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
      "prompts/script/script-writer.prompt.md",
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
      "prompts/topic/light-review.prompt.md",
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
      "prompts/script/semantic-reviewer.prompt.md",
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
      "prompts/storyboard/storyboard-planner.prompt.md",
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
      "prompts/asset-planning/asset-planner.prompt.md",
      content,
    );

    expect(issues).toEqual([]);
  });

  it("允许 assets prompt 使用 assets stage 并匹配 asset 目录", () => {
    const content = `---
id: asset.prompt-optimizer
stage: assets
language: zh-CN
consumes:
  - AssetTask
produces:
  - OptimizedAssetPrompt
status: active
---

# 任务

优化素材生成提示词。`;

    const issues = validatePromptContent(
      "prompts/asset/prompt-optimizer.prompt.md",
      content,
    );

    expect(issues).toEqual([]);
  });

  it("允许 publish prompt 使用 publish stage 并匹配目录", () => {
    const content = `---
id: publish.title-generator
stage: publish
language: zh-CN
consumes:
  - PublishPackage
produces:
  - PublishTitleCandidate[]
status: active
---

# 任务

生成发布标题候选。`;

    const issues = validatePromptContent(
      "prompts/publish/title-generator.prompt.md",
      content,
    );

    expect(issues).toEqual([]);
  });

  it("允许 event-library prompt 使用 event_library stage 并匹配目录", () => {
    const content = `---
id: event-library.enrich
stage: event_library
language: zh-CN
consumes:
  - RawHistoricalEventSkeleton
produces:
  - EventLibraryFile
status: active
---

# 任务

完善事件库条目。`;

    const issues = validatePromptContent(
      "prompts/event-library/enrich.prompt.md",
      content,
    );

    expect(issues).toEqual([]);
  });
});
