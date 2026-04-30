import { describe, expect, it } from "vitest";

import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("topic prompt contract", () => {
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
});
