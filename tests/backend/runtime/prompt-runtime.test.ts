import { describe, expect, it, vi } from "vitest";

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import type { StructuredPromptProvider } from "../../../backend/src/runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("prompt runtime", () => {
  it("loads topic.candidate-builder from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.metadata.id).toBe("topic.candidate-builder");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain("/harness/prompts/topic/");
    expect(prompt.body).toContain("根据当前推荐种子");
  });

  it("loads script.script-writer through registry compatibility lookup", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("script.script-writer");

    expect(prompt.metadata.id).toBe("script.writer");
    expect(prompt.aliases).toContain("script.script-writer");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain("/harness/prompts/script/");
  });

  it("loads script.semantic-reviewer from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("script.semantic-reviewer");

    expect(prompt.metadata.id).toBe("script.semantic-reviewer");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("执行单一语义审校");
  });

  it("delegates invokeStructuredPrompt through the provider contract", async () => {
    const provider: StructuredPromptProvider = {
      invokeStructuredPrompt: vi.fn(async ({ prompt, input, operationName }) => ({
        promptId: prompt.metadata.id,
        input,
        operationName,
      })),
    };
    const gateway = createLlmGateway({
      provider,
      registry: createPromptRegistry(),
    });

    const result = await gateway.invokeStructuredPrompt<{
      promptId: string;
      input: unknown;
      operationName: string;
    }>({
      promptId: "topic.candidate-builder",
      input: {
        requestId: "seed-1",
      },
    });

    expect(provider.invokeStructuredPrompt).toHaveBeenCalledTimes(1);
    expect(provider.invokeStructuredPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          requestId: "seed-1",
        },
        operationName: "topic.candidate-builder",
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "topic.candidate-builder",
            language: "zh-CN",
          }),
        }),
      }),
    );
    expect(result).toEqual({
      promptId: "topic.candidate-builder",
      input: {
        requestId: "seed-1",
      },
      operationName: "topic.candidate-builder",
    });
  });
});
