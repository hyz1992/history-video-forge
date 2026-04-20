import { describe, expect, it } from "vitest";

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import {
  ExternalServiceError,
  withRetry,
} from "../../../backend/src/runtime/llm/external-errors.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import { createRequestBudget } from "../../../backend/src/runtime/llm/request-budget.js";

describe("provider hardening", () => {
  it("keeps timeout / retry classification stable and records final attempt metadata", async () => {
    await expect(
      withRetry(
        async () => {
          const error = new Error("request timed out");
          error.name = "AbortError";
          throw error;
        },
        {
          provider: "llm",
          operation: "script.writer",
          maxAttempts: 2,
          baseDelayMs: 0,
          maxDelayMs: 0,
        },
      ),
    ).rejects.toMatchObject({
      name: "ExternalServiceError",
      code: "timeout",
      retryable: true,
      attemptCount: 2,
      failureMetadata: {
        failure_reason: "timeout",
        operation: "script.writer",
      },
    });
  });

  it("returns a clear external error when request budget / limit is exceeded", async () => {
    const provider = createOpenAiCompatibleProvider({
      model: "glm-4.5",
      requestBudget: createRequestBudget({
        maxRequests: 1,
      }),
      invokeApi: async () => '{"ok":true}',
    });
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    const firstResult = await provider.invokeStructuredPrompt<{ ok: boolean }>({
      prompt,
      input: {
        seed: "slot-1",
      },
      operationName: "topic.candidate-builder",
    });

    expect(firstResult).toEqual({ ok: true });

    await expect(
      provider.invokeStructuredPrompt({
        prompt,
        input: {
          seed: "slot-2",
        },
        operationName: "topic.candidate-builder",
      }),
    ).rejects.toMatchObject({
      name: "ExternalServiceError",
      code: "budget_exceeded",
      retryable: false,
      failureMetadata: {
        failure_reason: "budget_exceeded",
        operation: "topic.candidate-builder",
      },
    });
  });

  it("preserves provider failure metadata so graph runners can consume failure reasons", async () => {
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: {
        async invokeStructuredPrompt() {
          throw new ExternalServiceError({
            provider: "llm",
            operation: "topic.candidate-builder",
            retryable: false,
            code: "rate_limited",
            userMessage: "外部服务限流，请稍后重试。",
            debugMessage: "429 rate limit exceeded",
          });
        },
      },
    });

    await expect(
      gateway.invokeStructuredPrompt({
        promptId: "topic.candidate-builder",
        input: {
          seed: "slot-1",
        },
      }),
    ).rejects.toMatchObject({
      name: "ExternalServiceError",
      failureMetadata: {
        failure_reason: "rate_limited",
        operation: "topic.candidate-builder",
        provider: "llm",
      },
    });
  });
});
