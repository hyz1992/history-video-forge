import { describe, expect, it } from "vitest";

import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("topic prompt contract", () => {
  it("demands concrete single-event recommendation topics instead of abstract buckets", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("具体历史事件");
    expect(prompt.body).toContain("泛主题");
  });
});
