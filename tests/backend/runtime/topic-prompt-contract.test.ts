import { describe, expect, it } from "vitest";

import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("topic prompt contract", () => {
  it("registers a zh-CN topic.selector prompt dedicated to final diversity selection", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("只从给定候选池中选择");
  });

  it("keeps selector responsibilities separate from builder responsibilities", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("不得发明新的候选");
    expect(prompt.body).toContain("优先选择事件不同的候选");
  });

  it("requires candidate-builder to generate a larger raw candidate pool", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("输出 8 个候选");
  });

  it("requires candidate-builder to define stable event_identity naming rules", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("必须使用中文");
    expect(prompt.body).toContain("非必要不带年份");
    expect(prompt.body).toContain(
      "不得把包装文案、角度句式或脚本化表达写进 `event_identity`",
    );
  });

  it("requires candidate-builder to consume recent_event_memory", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("recent_event_memory");
  });

  it("requires candidate-builder to define a strict structured output contract", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("不得包 `TopicCandidateCard` 外层对象");
    expect(prompt.body).toContain("`viral_rubric` 只能使用正式字段");
    expect(prompt.body).toContain("不得自定义额外评分键");
  });

  it("demands concrete single-event recommendation topics instead of abstract buckets", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("具体历史事件");
    expect(prompt.body).toContain("泛主题");
  });

  it("treats the selected era as a hard boundary instead of a soft hint", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("严格服从推荐种子给定的时代范围");
    expect(prompt.body).toContain("不得超出该时段");
    expect(prompt.body).toContain("先秦至两汉");
    expect(prompt.body).toContain("魏晋至唐宋");
    expect(prompt.body).toContain("元明清");
  });

  it("requires topic.selector prompt to consume recent_event_memory", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("recent_event_memory");
  });
});
