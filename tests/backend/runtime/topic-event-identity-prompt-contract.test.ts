import { describe, expect, it } from "vitest";

import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("topic event identity prompt contract", () => {
  it("requires candidate-builder to emit event_identity for every candidate", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("event_identity");
  });
});
