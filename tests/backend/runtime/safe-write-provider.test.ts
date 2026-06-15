import { describe, expect, it, vi } from "vitest";
import type { LlmInteractionLogWriter } from "../../../backend/src/runtime/llm/interaction-log.js";

// ---------------------------------------------------------------------------
// Best-effort trace writing: unit test on the provider layer.
// Verifies that log write failures never propagate to the caller.
// ---------------------------------------------------------------------------

describe("openai-compatible provider safeWrite", () => {
  it("returns parsed result even when interactionLogWriter.write throws", async () => {
    // We import dynamically so vi.mock hoisting works correctly
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );

    // Mock fetch to return a valid chat completion
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ optimized_prompt: "测试优化", change_summary: ["改动1"] }),
            },
          },
        ],
      }),
    } as unknown as Response);

    const writer: LlmInteractionLogWriter = {
      write: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://mock.test/v1",
      model: "mock-model",
      apiKey: "test-key",
    });

    const result = await provider.invokeStructuredPrompt({
      operationName: "test.optimize",
      prompt: {
        metadata: {
          id: "test.prompt",
          stage: "assets",
          language: "zh-CN",
          consumes: [],
          produces: [],
          status: "active" as const,
        },
        filePath: "/fake/prompt.md",
        body: "test system prompt",
        aliases: [],
      },
      input: { current_prompt: "原始提示词", user_feedback: "增强光影" },
      interactionLogWriter: writer,
    });

    // Must return the parsed result despite the writer throwing
    expect(result).toEqual({ optimized_prompt: "测试优化", change_summary: ["改动1"] });
    // Writer should have been called
    expect(writer.write).toHaveBeenCalled();

    // Cleanup
    globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
  });

  it("propagates the original LLM error, not the trace write error", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );

    // Mock fetch to throw a network error
    const mockFetch = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const writer: LlmInteractionLogWriter = {
      write: vi.fn().mockRejectedValue(new Error("disk full")),
    };

    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://mock.test/v1",
      model: "mock-model",
      apiKey: "test-key",
    });

    await expect(
      provider.invokeStructuredPrompt({
        operationName: "test.optimize",
        prompt: {
          metadata: {
            id: "test.prompt", stage: "assets", language: "zh-CN",
            consumes: [], produces: [], status: "active" as const,
          },
          filePath: "/fake/prompt.md",
          body: "test",
          aliases: [],
        },
        input: { current_prompt: "test" },
        interactionLogWriter: writer,
      }),
      // Should throw the original network error, not "disk full"
    ).rejects.toThrow(/connect ECONNREFUSED/);

    globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
  });

  it("does not log sensitive fields (api_key, Authorization, Bearer)", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );

    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ result: "ok" }) } }],
      }),
    } as unknown as Response);

    let capturedEntry: Record<string, unknown> | null = null;
    const writer: LlmInteractionLogWriter = {
      write: vi.fn().mockImplementation(async (entry) => {
        capturedEntry = entry as Record<string, unknown>;
      }),
    };

    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://mock.test/v1",
      model: "mock-model",
      apiKey: "sk-sensitive-key",
    });

    await provider.invokeStructuredPrompt({
      operationName: "test.optimize",
      prompt: {
        metadata: {
          id: "test.prompt", stage: "assets", language: "zh-CN",
          consumes: [], produces: [], status: "active" as const,
        },
        filePath: "/fake/prompt.md",
        body: "test",
        aliases: [],
      },
      input: { current_prompt: "test", user_feedback: "test" },
      interactionLogWriter: writer,
    });

    expect(capturedEntry).not.toBeNull();
    const serialized = JSON.stringify(capturedEntry);
    expect(serialized).not.toContain("sk-sensitive-key");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    // Verify user-visible fields ARE present
    expect(serialized).toContain("current_prompt");
    expect(serialized).toContain("user_feedback");
    expect(serialized).toContain("test.prompt");

    globalThis.fetch = undefined as unknown as typeof globalThis.fetch;
  });
});
