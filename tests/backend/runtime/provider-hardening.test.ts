import { describe, expect, it, vi } from "vitest";

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import {
  ExternalServiceError,
  withRetry,
} from "../../../backend/src/runtime/llm/external-errors.js";
import {
  createOpenAiCompatibleProvider,
  resolveOpenAiCompatibleProviderConfig,
} from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import { createRequestBudget } from "../../../backend/src/runtime/llm/request-budget.js";
import type { LlmInteractionLogEntry } from "../../../backend/src/runtime/llm/interaction-log.js";

describe("provider hardening", () => {
  it("routes structured profile to structured endpoint while preserving main profile", () => {
    const config = {
      provider: "openai" as const,
      baseUrl: "https://main.example.test/v1",
      apiKey: "main-key",
      model: "deepseek-v4-pro",
      structuredBaseUrl: "https://structured.example.test/v1",
      structuredApiKey: "structured-key",
      structuredModel: "glm-4",
      timeoutMs: 45000,
      maxAttempts: 3,
      requestBudgetMaxRequests: 20,
    };

    expect(
      resolveOpenAiCompatibleProviderConfig({
        envConfig: config,
        options: {
          profile: "structured",
        },
      }),
    ).toMatchObject({
      model: "glm-4",
      baseUrl: "https://structured.example.test/v1",
      apiKey: "structured-key",
    });

    expect(
      resolveOpenAiCompatibleProviderConfig({
        envConfig: config,
        options: {
          profile: "main",
        },
      }),
    ).toMatchObject({
      model: "deepseek-v4-pro",
      baseUrl: "https://main.example.test/v1",
      apiKey: "main-key",
    });
  });

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

  it("includes provider error response body when structured requests are rejected", async () => {
    const originalFetch = globalThis.fetch;
    const prompt = createPromptRegistry().getPrompt("script.writer");
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message:
              "When response_format is json_object, messages must include json.",
            type: "invalid_request_error",
          },
        }),
        {
          status: 400,
          statusText: "Bad Request",
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    ) as typeof fetch;
    const provider = createOpenAiCompatibleProvider({
      model: "deepseek-v4-pro",
      baseUrl: "https://api.deepseek.example",
      apiKey: "test-key",
      maxAttempts: 1,
    });

    try {
      await expect(
        provider.invokeStructuredPrompt({
          prompt,
          input: {
            bundle: {},
          },
          operationName: "script.writer",
        }),
      ).rejects.toMatchObject({
        name: "ExternalServiceError",
        code: "invalid_request",
        debugMessage: expect.stringContaining(
          "messages must include json",
        ) as unknown,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aborts the underlying fetch before retrying a timeout", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const signals: AbortSignal[] = [];
    const fetchImpl = vi.fn((_url: string, init: RequestInit = {}) => {
      signals.push(init.signal as AbortSignal);
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    });
    const provider = createOpenAiCompatibleProvider({
      model: "test-model",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 5,
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      fetchImpl,
    });

    await expect(provider.invokeStructuredPrompt({ prompt, input: {}, operationName: "script.writer" }))
      .rejects.toMatchObject({ code: "timeout", attemptCount: 2 });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("invokes strict structured requests through tool calls and parses function arguments", async () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const argumentsJson = JSON.stringify({
      selected_candidate_ids: [
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
      ],
    });
    const invokeStrictApi = vi.fn(async () => ({
      rawOutput: JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "select_topic_candidates",
                    arguments: argumentsJson,
                  },
                },
              ],
            },
          },
        ],
      }),
      argumentsJson,
    }));
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      invokeStrictApi,
    });

    const result = await provider.invokeStrictStructured?.({
      prompt,
      input: {
        selector_pool: [],
      },
      operationName: "topic.selector",
      schema: {
        name: "select_topic_candidates",
        description: "Select topic candidates.",
        parameters: {
          type: "object",
          properties: {
            selected_candidate_ids: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["selected_candidate_ids"],
          additionalProperties: false,
        },
      },
      parse: (candidate) => candidate as { selected_candidate_ids: string[] },
      options: {
        strategy: "tool_call",
        thinking: "disabled",
        temperature: 0.5,
        topP: 0.9,
        maxTokens: 2048,
      },
    });

    expect(result).toEqual({
      selected_candidate_ids: [
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
      ],
    });
    expect(invokeStrictApi).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "glm-5.1",
        operationName: "topic.selector",
        schema: expect.objectContaining({
          name: "select_topic_candidates",
        }),
        options: expect.objectContaining({
          strategy: "tool_call",
          thinking: "disabled",
        }),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("fails strict structured tool calls when arguments use an answer wrapper", async () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      invokeStrictApi: async () => ({
        rawOutput: "tool-response",
        argumentsJson: JSON.stringify({
          answer: {
            selected_ids: [
              "selector_candidate_1",
              "selector_candidate_2",
              "selector_candidate_3",
            ],
          },
        }),
      }),
    });

    await expect(
      provider.invokeStrictStructured?.({
        prompt,
        input: {},
        operationName: "topic.selector",
        schema: {
          name: "select_topic_candidates",
          description: "Select topic candidates.",
          parameters: {
            type: "object",
            properties: {
              selected_candidate_ids: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["selected_candidate_ids"],
            additionalProperties: false,
          },
        },
        parse: (candidate) => {
          const record = candidate as Record<string, unknown>;
          if (!Array.isArray(record.selected_candidate_ids)) {
            throw new Error("topic_selector_strict_schema_failed");
          }

          return record as { selected_candidate_ids: string[] };
        },
        options: {
          strategy: "tool_call",
        },
      }),
    ).rejects.toThrow("topic_selector_strict_schema_failed");
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

  it("logs effective request, attempt, and response metadata for ordinary JSON invocations", async () => {
    const entries: LlmInteractionLogEntry[] = [];
    const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
    const prompt = createPromptRegistry().getPrompt("script.writer");

    const fetchPayload = {
      choices: [{
        finish_reason: "stop",
        message: { content: '{"ok":true}' },
      }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        completion_tokens_details: { reasoning_tokens: 9 },
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fetchPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    try {
      const provider = createOpenAiCompatibleProvider({
        model: "glm-5.1",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        maxAttempts: 1,
      });

      const result = await provider.invokeStructuredPrompt({
        prompt,
        input: { seed: "slot-1" },
        operationName: "script.writer",
        interactionLogWriter: writer,
      });

      expect(result).toEqual({ ok: true });
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.effectiveRequest).toBeDefined();
      expect(entry.effectiveRequest?.profile).toBe("main");
      expect(entry.effectiveRequest?.model).toBe("glm-5.1");
      expect(entry.effectiveRequest?.strategy).toBe("json_object");
      expect(entry.effectiveRequest?.thinking).toBe("provider_default");
      expect(typeof entry.effectiveRequest?.timeoutMs).toBe("number");
      expect(typeof entry.effectiveRequest?.maxAttempts).toBe("number");

      expect(Array.isArray(entry.attempts)).toBe(true);
      expect(entry.attempts?.length).toBeGreaterThanOrEqual(1);
      const firstAttempt = entry.attempts![0];
      expect(firstAttempt.attempt).toBe(1);
      expect(typeof firstAttempt.startedAt).toBe("string");
      expect(typeof firstAttempt.finishedAt).toBe("string");
      expect(typeof firstAttempt.durationMs).toBe("number");
      expect(firstAttempt.outcome).toBe("success");

      expect(entry.responseMetadata).toBeDefined();
      expect(entry.responseMetadata?.finishReason).toBe("stop");
      expect(entry.responseMetadata?.promptTokens).toBe(120);
      expect(entry.responseMetadata?.completionTokens).toBe(30);
      expect(entry.responseMetadata?.reasoningTokens).toBe(9);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("logs effective request, attempt, and response metadata for strict tool-call invocations", async () => {
    const entries: LlmInteractionLogEntry[] = [];
    const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const argumentsJson = JSON.stringify({
      selected_candidate_ids: ["c1", "c2", "c3"],
    });

    const fetchPayload = {
      choices: [{
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{
            type: "function",
            function: { name: "select_topic_candidates", arguments: argumentsJson },
          }],
        },
      }],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 50,
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fetchPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as typeof fetch;

    try {
      const provider = createOpenAiCompatibleProvider({
        model: "glm-5.1",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        maxAttempts: 1,
      });

      const result = await provider.invokeStrictStructured?.({
        prompt,
        input: { selector_pool: [] },
        operationName: "topic.selector",
        schema: {
          name: "select_topic_candidates",
          description: "Select topic candidates.",
          parameters: {
            type: "object",
            properties: {
              selected_candidate_ids: { type: "array", items: { type: "string" } },
            },
            required: ["selected_candidate_ids"],
            additionalProperties: false,
          },
        },
        parse: (candidate) => candidate as { selected_candidate_ids: string[] },
        options: {
          strategy: "tool_call",
          thinking: "disabled",
          temperature: 0.5,
          topP: 0.9,
          maxTokens: 2048,
        },
        interactionLogWriter: writer,
      });

      expect(result).toEqual({ selected_candidate_ids: ["c1", "c2", "c3"] });
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.effectiveRequest).toBeDefined();
      expect(entry.effectiveRequest?.profile).toBe("structured");
      expect(entry.effectiveRequest?.model).toBe("glm-5.1");
      expect(entry.effectiveRequest?.strategy).toBe("tool_call");
      expect(entry.effectiveRequest?.thinking).toBe("disabled");

      expect(Array.isArray(entry.attempts)).toBe(true);
      const firstAttempt = entry.attempts![0];
      expect(firstAttempt.outcome).toBe("success");

      expect(entry.responseMetadata).toBeDefined();
      expect(entry.responseMetadata?.finishReason).toBe("tool_calls");
      expect(entry.responseMetadata?.promptTokens).toBe(200);
      expect(entry.responseMetadata?.completionTokens).toBe(50);
      expect(entry.responseMetadata?.reasoningTokens).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
