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
      invokeApi: async () => ({ rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: {} }),
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

  it("aborts the underlying fetch when a timeout fires", async () => {
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

    // script.writer (core_semantic_generation) must not retry on timeout,
    // so exactly one fetch is issued and its signal is aborted.
    await expect(provider.invokeStructuredPrompt({ prompt, input: {}, operationName: "script.writer" }))
      .rejects.toMatchObject({ code: "timeout", attemptCount: 1 });
    expect(signals).toHaveLength(1);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("does not retry a timeout for core semantic generation even when maxAttempts allows it", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    let callCount = 0;
    const invokeApi = vi.fn(async () => {
      callCount += 1;
      const error = new Error("request timed out");
      error.name = "AbortError";
      throw error;
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    await expect(
      provider.invokeStructuredPrompt({
        prompt,
        input: { seed: "slot-1" },
        operationName: "script.writer",
      }),
    ).rejects.toMatchObject({ code: "timeout", attemptCount: 1 });

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(callCount).toBe(1);
  });

  it("does not retry a timeout for long structured generation", async () => {
    const prompt = createPromptRegistry().getPrompt("storyboard.storyboard-planner");
    const invokeApi = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "AbortError";
      throw error;
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    await expect(
      provider.invokeStructuredPrompt({
        prompt,
        input: {},
        operationName: "storyboard.planner",
      }),
    ).rejects.toMatchObject({ code: "timeout", attemptCount: 1 });

    expect(invokeApi).toHaveBeenCalledTimes(1);
  });

  it("retries transient 503 errors within policy cap for short structured decisions", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    let callCount = 0;
    const invokeApi = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("503 Service Unavailable");
      }
      return { rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: {} };
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 5,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    const result = await provider.invokeStructuredPrompt({
      prompt,
      input: {},
      // short_structured_decision: transient cap = 2 -> max 3 attempts total
      operationName: "topic.selector",
    });

    expect(result).toEqual({ ok: true });
    expect(invokeApi).toHaveBeenCalledTimes(2);
  });

  it("retries transient 429 rate-limit errors within policy cap", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    let callCount = 0;
    const invokeApi = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("429 Too Many Requests: throttled");
      }
      return { rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: {} };
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 5,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    const result = await provider.invokeStructuredPrompt({
      prompt,
      input: {},
      operationName: "topic.selector",
    });

    expect(result).toEqual({ ok: true });
    expect(invokeApi).toHaveBeenCalledTimes(2);
  });

  it("retries transient network errors within policy cap", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    let callCount = 0;
    const invokeApi = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error("fetch failed: ECONNRESET");
      }
      return { rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: {} };
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 5,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    const result = await provider.invokeStructuredPrompt({
      prompt,
      input: {},
      operationName: "topic.selector",
    });

    expect(result).toEqual({ ok: true });
    expect(invokeApi).toHaveBeenCalledTimes(2);
  });

  it("does not retry invalid_request (400) errors even for short structured decisions", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const invokeApi = vi.fn(async () => {
      throw new Error("400 Bad Request: invalid payload");
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    await expect(
      provider.invokeStructuredPrompt({
        prompt,
        input: {},
        operationName: "topic.selector",
      }),
    ).rejects.toMatchObject({ code: "invalid_request", attemptCount: 1 });

    expect(invokeApi).toHaveBeenCalledTimes(1);
  });

  it("does not retry configuration (401) errors", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const invokeApi = vi.fn(async () => {
      throw new Error("401 Unauthorized: api key invalid");
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    await expect(
      provider.invokeStructuredPrompt({
        prompt,
        input: {},
        operationName: "topic.selector",
      }),
    ).rejects.toMatchObject({ code: "configuration", attemptCount: 1 });

    expect(invokeApi).toHaveBeenCalledTimes(1);
  });

  it("does not trigger a second network call when JSON parsing fails (schema invalid)", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const invokeApi = vi.fn(async () => ({
      // 非法 JSON：attempt 成功返回，但下游 parse 失败。
      rawOutput: "not-json",
      content: "not-json",
      metadata: {},
    }));
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    await expect(
      provider.invokeStructuredPrompt({
        prompt,
        input: {},
        operationName: "topic.selector",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    // 解析失败发生在 withRetry 之外，不得触发额外网络重试。
    expect(invokeApi).toHaveBeenCalledTimes(1);
  });

  it("does not trigger a second network call when a business validator would fail downstream", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const invokeApi = vi.fn(async () => ({
      // 合法 JSON，provider 视为成功返回；下游业务 validator 是否通过不影响网络重试。
      rawOutput: '{"unexpected":1}',
      content: '{"unexpected":1}',
      metadata: {},
    }));
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    // provider 只负责 JSON.parse，业务 validator 在调用方；
    // 一旦 attempt 成功返回，即便下游业务校验失败也不会触发额外网络重试。
    const result = await provider.invokeStructuredPrompt<{ unexpected: number }>({
      prompt,
      input: {},
      operationName: "topic.selector",
    });

    expect(result).toEqual({ unexpected: 1 });
    expect(invokeApi).toHaveBeenCalledTimes(1);
  });

  it("timeout user message does not claim automatic retry happened", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const invokeApi = vi.fn(async () => {
      const error = new Error("timed out");
      error.name = "AbortError";
      throw error;
    });
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      timeoutMs: 60000,
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
      invokeApi,
    });

    const error = await provider
      .invokeStructuredPrompt({
        prompt,
        input: {},
        operationName: "script.writer",
      })
      .catch((e) => e);

    expect(error.userMessage).not.toContain("已自动重试");
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
      metadata: { finishReason: "tool_calls" },
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
        metadata: {},
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

  it("records each retry attempt with delay and succeeds on second attempt", async () => {
    vi.useFakeTimers();
    const entries: LlmInteractionLogEntry[] = [];
    const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
    const prompt = createPromptRegistry().getPrompt("script.writer");

    let callCount = 0;
    const invokeApi = vi.fn(async () => {
      callCount += 1;
      await new Promise((r) => setTimeout(r, 500));
      if (callCount === 1) {
        throw new Error("503 Service Unavailable");
      }
      return { rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: { finishReason: "stop" } };
    });

    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.1",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      maxAttempts: 3,
      baseDelayMs: 1500,
      maxDelayMs: 8000,
      invokeApi,
    });

    const resultPromise = provider.invokeStructuredPrompt({
      prompt,
      input: { seed: "slot-1" },
      operationName: "script.writer",
      interactionLogWriter: writer,
    });

    await vi.advanceTimersByTimeAsync(2600);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toEqual({ ok: true });
    expect(invokeApi).toHaveBeenCalledTimes(2);
    expect(entries).toHaveLength(1);

    const entry = entries[0];
    expect(entry.attempts).toBeDefined();
    expect(entry.attempts).toHaveLength(2);

    const a1 = entry.attempts![0];
    expect(a1.attempt).toBe(1);
    expect(a1.outcome).toBe("error");
    expect(a1.errorCode).toBe("service_unavailable");
    expect(a1.durationMs).toBeGreaterThan(0);
    expect(a1.finishedAt > a1.startedAt).toBe(true);
    expect(a1.retryDelayMs).toBe(1500);

    const a2 = entry.attempts![1];
    expect(a2.attempt).toBe(2);
    expect(a2.outcome).toBe("success");
    expect(a2.durationMs).toBeGreaterThan(0);
    expect(a2.finishedAt > a2.startedAt).toBe(true);
    expect(a2.retryDelayMs).toBeUndefined();
  });

  it("sends thinking and sampling parameters only when explicit diagnostics options are passed", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as typeof fetch;
    globalThis.fetch = fetchSpy;

    try {
      const provider = createOpenAiCompatibleProvider({
        model: "glm-5.1",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        maxAttempts: 1,
      });
      const prompt = createPromptRegistry().getPrompt("script.writer");

      const result = await provider.invokeStructuredPrompt({
        prompt,
        input: { seed: "slot-1" },
        operationName: "script.writer",
      });

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const defaultBody = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(defaultBody.response_format).toEqual({ type: "json_object" });
      expect(defaultBody.thinking).toBeUndefined();
      expect(defaultBody.max_tokens).toBeUndefined();
      expect(defaultBody.temperature).toBeUndefined();
      expect(defaultBody.top_p).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("passes explicit diagnostic options through to the request body and records them in effective request", async () => {
    const entries: LlmInteractionLogEntry[] = [];
    const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as typeof fetch;
    globalThis.fetch = fetchSpy;

    try {
      const provider = createOpenAiCompatibleProvider({
        model: "glm-5.1",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        maxAttempts: 1,
      });
      const prompt = createPromptRegistry().getPrompt("script.writer");

      const result = await provider.invokeStructuredPrompt({
        prompt,
        input: { seed: "slot-1" },
        operationName: "script.writer",
        interactionLogWriter: writer,
        options: {
          thinking: "disabled",
          maxTokens: 4096,
          temperature: 0.3,
          topP: 0.8,
          timeoutMs: 60000,
          maxAttempts: 2,
        },
      });

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBe(0.3);
      expect(body.top_p).toBe(0.8);

      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.effectiveRequest?.thinking).toBe("disabled");
      expect(entry.effectiveRequest?.maxTokens).toBe(4096);
      expect(entry.effectiveRequest?.temperature).toBe(0.3);
      expect(entry.effectiveRequest?.topP).toBe(0.8);
      expect(entry.effectiveRequest?.timeoutMs).toBe(60000);
      expect(entry.effectiveRequest?.maxAttempts).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
