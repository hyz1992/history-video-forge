import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

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
import { ScriptDraftPackage } from "../../../shared/src/index.js";

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

  it("shares one request budget across structured and strict provider calls", async () => {
    const invokeApi = vi.fn(async () => ({
      rawOutput: '{"ok":true}',
      content: '{"ok":true}',
      metadata: {},
    }));
    const argumentsJson = '{"ranked_candidates":[]}';
    const invokeStrictApi = vi.fn(async () => ({
      rawOutput: argumentsJson,
      argumentsJson,
      metadata: { finishReason: "tool_calls" },
    }));
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.2",
      requestBudget: createRequestBudget({ maxRequests: 2 }),
      invokeApi,
      invokeStrictApi,
    });

    await expect(
      provider.invokeStructuredPrompt({
        prompt: createPromptRegistry().getPrompt("topic.candidate-builder"),
        input: { seed: "shared-budget" },
        operationName: "topic.candidate-builder",
      }),
    ).resolves.toEqual({ ok: true });

    await expect(
      provider.invokeStrictStructured?.({
        prompt: createPromptRegistry().getPrompt("topic.selector"),
        input: { selector_pool: [] },
        operationName: "topic.selector",
        schema: {
          name: "rank_topic_candidates",
          description: "Rank topic candidates.",
          parameters: {
            type: "object",
            properties: {
              ranked_candidates: { type: "array", items: { type: "object" } },
            },
            required: ["ranked_candidates"],
            additionalProperties: false,
          },
        },
        parse: (candidate) => candidate as { ranked_candidates: unknown[] },
      }),
    ).resolves.toEqual({ ranked_candidates: [] });

    await expect(
      provider.invokeStructuredPrompt({
        prompt: createPromptRegistry().getPrompt("topic.candidate-builder"),
        input: { seed: "budget-exceeded" },
        operationName: "topic.candidate-builder",
      }),
    ).rejects.toMatchObject({
      code: "budget_exceeded",
      retryable: false,
    });
    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(invokeStrictApi).toHaveBeenCalledTimes(1);
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

  it("does not trigger a second network call when a real business validator fails downstream", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    const invokeApi = vi.fn(async () => ({
      // 合法 JSON，但不符合 ScriptDraftPackage 业务 schema（缺 script_text 等必需字段）。
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

    // provider 只负责 JSON.parse 成功返回；业务 validator 在调用方执行。
    const result = await provider.invokeStructuredPrompt<{ unexpected: number }>({
      prompt,
      input: {},
      operationName: "script.writer",
    });
    expect(invokeApi).toHaveBeenCalledTimes(1);

    // 真实业务 validator 必须失败（证明这是 validator failure 而非网络失败）。
    expect(() => ScriptDraftPackage.parse(result)).toThrow();

    // 业务 validator 失败不得扩大为额外网络重试。
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

  it("keeps limited retry for non-core operation timeouts and succeeds on second attempt", async () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");
    let callCount = 0;
    const invokeApi = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        const error = new Error("request timed out");
        error.name = "AbortError";
        throw error;
      }
      return { rawOutput: '{"ok":true}', content: '{"ok":true}', metadata: {} };
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

    // topic.selector 是 short_structured_decision，policy 允许 timeout 有限重试。
    const result = await provider.invokeStructuredPrompt({
      prompt,
      input: {},
      operationName: "topic.selector",
    });

    expect(result).toEqual({ ok: true });
    expect(invokeApi).toHaveBeenCalledTimes(2);
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
      // script.writer 是 Task 10 批准关闭 thinking 的 operation；
      // operation policy 会让 effective thinking 为 disabled（不再是 provider_default）。
      expect(entry.effectiveRequest?.thinking).toBe("disabled");
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

  it("forces the declared target function when strict tool choice requests it", async () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const entries: LlmInteractionLogEntry[] = [];
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            tool_calls: [{
              type: "function",
              function: {
                name: "select_topic_candidates",
                arguments: JSON.stringify({ selected_candidate_ids: ["c1"] }),
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.2",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      maxAttempts: 1,
      fetchImpl,
    });

    const result = await provider.invokeStrictStructured?.({
      prompt,
      input: { selector_pool: [] },
      operationName: "probe.strict-tool-call",
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
        toolChoice: "target_function",
      },
      interactionLogWriter: {
        write(entry) {
          entries.push(entry);
        },
      },
    });

    expect(result).toEqual({ selected_candidate_ids: ["c1"] });
    expect(capturedBody?.tool_choice).toEqual({
      type: "function",
      function: { name: "select_topic_candidates" },
    });
    expect(entries[0]?.effectiveRequest?.toolChoice).toBe("target_function");
  });

  it("rejects a different returned function when the target function is forced", async () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.2",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      maxAttempts: 1,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            tool_calls: [{
              type: "function",
              function: {
                name: "wrong_function",
                arguments: JSON.stringify({ selected_candidate_ids: ["c1"] }),
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    await expect(provider.invokeStrictStructured?.({
      prompt,
      input: { selector_pool: [] },
      operationName: "probe.strict-tool-call",
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
        toolChoice: "target_function",
      },
    })).rejects.toThrow(
      "strict_structured_target_tool_mismatch: expected=select_topic_candidates actual=wrong_function",
    );
  });

  it("throws strict_structured_no_tool_call when the strict response omits tool_calls entirely", async () => {
    // Task 10：覆盖 provider 合同链的未测环节——真实 invokeStrictStructured 在收到
    // 缺少 tool_calls 的响应（仅有普通 content）时必须抛 strict_structured_no_tool_call，
    // 以便 topic selector 侧的 shouldFallbackToStructuredSelector 进入受控 structured fallback。
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.2",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      maxAttempts: 1,
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ selected_candidate_ids: ["c1"] }),
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    await expect(provider.invokeStrictStructured?.({
      prompt,
      input: { selector_pool: [] },
      operationName: "probe.strict-tool-call",
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
        toolChoice: "target_function",
      },
    })).rejects.toThrow("strict_structured_no_tool_call");
  });

  it("retries strict tool-call invocations when arguments JSON is malformed", async () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");
    const entries: LlmInteractionLogEntry[] = [];
    let calls = 0;
    const provider = createOpenAiCompatibleProvider({
      model: "glm-5.2",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        const argumentsJson = calls === 1
          ? '{"selected_candidate_ids":["c1"]} trailing'
          : JSON.stringify({ selected_candidate_ids: ["c1"] });

        return new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              tool_calls: [{
                type: "function",
                function: {
                  name: "select_topic_candidates",
                  arguments: argumentsJson,
                },
              }],
            },
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
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
        toolChoice: "target_function",
      },
      interactionLogWriter: {
        write(entry) {
          entries.push(entry);
        },
      },
    });

    expect(result).toEqual({ selected_candidate_ids: ["c1"] });
    expect(calls).toBe(2);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.attempts).toMatchObject([
      { attempt: 1, outcome: "error", errorCode: "invalid_response" },
      { attempt: 2, outcome: "success" },
    ]);
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

  it("does not send sampling parameters when an unapproved operation omits explicit options", async () => {
    // Task 10 / Task 12 之后 script.writer / storyboard.planner / topic.candidate-builder
    // 会从 operation policy 获得 thinking=disabled。这里用同 class 但仍未批准的
    // storyboard.segment-regen 验证：未显式传参时仍不发送 thinking / sampling。
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
      const prompt = createPromptRegistry().getPrompt("storyboard.segment-regen");

      const result = await provider.invokeStructuredPrompt({
        prompt,
        input: { seed: "slot-1" },
        operationName: "storyboard.segment-regen",
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

  it("applies Task 10 approved thinking=disabled to script.writer and storyboard.planner plain JSON requests without explicit options", async () => {
    // 即使 invocation options 不传 thinking，operation policy 也会让这两个 operation
    // 在普通 JSON mode 请求体与 interaction log 中显式携带 thinking=disabled。
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as typeof fetch;
    globalThis.fetch = fetchSpy;

    const registry = createPromptRegistry();
    try {
      const provider = createOpenAiCompatibleProvider({
        model: "glm-5.2",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        maxAttempts: 1,
      });

      for (const operationName of ["script.writer", "storyboard.planner"] as const) {
        fetchSpy.mockClear();
        const prompt = registry.getPrompt(operationName);
        const entries: LlmInteractionLogEntry[] = [];
        const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };

        const result = await provider.invokeStructuredPrompt({
          prompt,
          input: { seed: "slot-1" },
          operationName,
          interactionLogWriter: writer,
        });

        expect(result).toEqual({ ok: true });
        const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
        expect(body.thinking).toEqual({ type: "disabled" });
        // 未显式传入的 sampling 参数仍不发。
        expect(body.max_tokens).toBeUndefined();
        expect(body.temperature).toBeUndefined();
        expect(body.top_p).toBeUndefined();

        // interaction log 的 effective request 与请求体一致。
        expect(entries).toHaveLength(1);
        expect(entries[0]?.effectiveRequest?.thinking).toBe("disabled");
      }
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

  // S2-3 Task 3：interaction log promptSha256 + promptVersion
  describe("interaction log prompt sha256 and version", () => {
    it("records promptSha256 and promptVersion on successful invokeStructuredPrompt", async () => {
      const entries: LlmInteractionLogEntry[] = [];
      const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
      const prompt = createPromptRegistry().getPrompt("script.writer");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ) as typeof fetch;

      try {
        const provider = createOpenAiCompatibleProvider({
          model: "glm-5.1",
          baseUrl: "https://llm.example.test/v1",
          apiKey: "test-key",
          maxAttempts: 1,
        });

        await provider.invokeStructuredPrompt({
          prompt,
          input: { seed: "sha-test" },
          operationName: "script.writer",
          interactionLogWriter: writer,
        });

        expect(entries).toHaveLength(1);
        const entry = entries[0];

        // promptSha256 是 64 位 hex 字符串
        expect(entry.promptSha256).toMatch(/^[a-f0-9]{64}$/);
        // 等于 sha256(prompt.body.trim())
        expect(entry.promptSha256).toBe(
          createHash("sha256").update(prompt.body.trim()).digest("hex"),
        );
        // promptVersion 等于 metadata.version
        expect(entry.promptVersion).toBe("v1.0.0");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("records promptSha256 and promptVersion on successful invokeStrictStructured", async () => {
      const entries: LlmInteractionLogEntry[] = [];
      const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
      const prompt = createPromptRegistry().getPrompt("topic.selector");
      const argumentsJson = JSON.stringify({ selected_candidate_ids: ["c1"] });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{
            finish_reason: "tool_calls",
            message: {
              tool_calls: [{
                type: "function",
                function: { name: "select_topic_candidates", arguments: argumentsJson },
              }],
            },
          }],
          usage: { prompt_tokens: 200, completion_tokens: 50 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ) as typeof fetch;

      try {
        const provider = createOpenAiCompatibleProvider({
          model: "glm-5.1",
          baseUrl: "https://llm.example.test/v1",
          apiKey: "test-key",
          maxAttempts: 1,
        });

        await provider.invokeStrictStructured?.({
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
          options: { strategy: "tool_call", thinking: "disabled" },
          interactionLogWriter: writer,
        });

        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.promptSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(entry.promptSha256).toBe(
          createHash("sha256").update(prompt.body.trim()).digest("hex"),
        );
        expect(entry.promptVersion).toBe("v1.0.0");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("same prompt produces identical promptSha256 across invocations", async () => {
      const entries: LlmInteractionLogEntry[] = [];
      const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
      const prompt = createPromptRegistry().getPrompt("script.writer");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ) as typeof fetch;

      try {
        const provider = createOpenAiCompatibleProvider({
          model: "glm-5.1",
          baseUrl: "https://llm.example.test/v1",
          apiKey: "test-key",
          maxAttempts: 1,
        });

        await provider.invokeStructuredPrompt({
          prompt,
          input: { seed: "run-1" },
          operationName: "script.writer",
          interactionLogWriter: writer,
        });
        await provider.invokeStructuredPrompt({
          prompt,
          input: { seed: "run-2" },
          operationName: "script.writer",
          interactionLogWriter: writer,
        });

        expect(entries).toHaveLength(2);
        expect(entries[0].promptSha256).toBe(entries[1].promptSha256);
        expect(entries[0].promptVersion).toBe(entries[1].promptVersion);
        expect(entries[0].promptVersion).toBe("v1.0.0");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("different prompts produce different promptSha256", async () => {
      const entries: LlmInteractionLogEntry[] = [];
      const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
      const promptA = createPromptRegistry().getPrompt("script.writer");
      const promptB = createPromptRegistry().getPrompt("topic.candidate-builder");

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ) as typeof fetch;

      try {
        const provider = createOpenAiCompatibleProvider({
          model: "glm-5.1",
          baseUrl: "https://llm.example.test/v1",
          apiKey: "test-key",
          maxAttempts: 1,
        });

        await provider.invokeStructuredPrompt({
          prompt: promptA,
          input: { seed: "a" },
          operationName: "script.writer",
          interactionLogWriter: writer,
        });
        await provider.invokeStructuredPrompt({
          prompt: promptB,
          input: { seed: "b" },
          operationName: "topic.candidate-builder",
          interactionLogWriter: writer,
        });

        expect(entries).toHaveLength(2);
        expect(entries[0].promptSha256).not.toBe(entries[1].promptSha256);
        // Both should still have valid sha256 and version
        expect(entries[0].promptSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(entries[1].promptSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(entries[0].promptVersion).toBe("v1.0.0");
        expect(entries[1].promptVersion).toBe("v1.0.0");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("records promptSha256 and promptVersion even on error", async () => {
      const entries: LlmInteractionLogEntry[] = [];
      const writer = { write: (entry: LlmInteractionLogEntry) => { entries.push(entry); } };
      const prompt = createPromptRegistry().getPrompt("script.writer");

      const invokeApi = vi.fn(async () => {
        throw new Error("401 Unauthorized: api key invalid");
      });

      const provider = createOpenAiCompatibleProvider({
        model: "glm-5.1",
        baseUrl: "https://llm.example.test/v1",
        apiKey: "test-key",
        maxAttempts: 1,
        invokeApi,
      });

      await expect(
        provider.invokeStructuredPrompt({
          prompt,
          input: { seed: "error-test" },
          operationName: "topic.selector",
          interactionLogWriter: writer,
        }),
      ).rejects.toBeDefined();

      expect(entries).toHaveLength(1);
      const entry = entries[0];
      expect(entry.promptSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.promptSha256).toBe(
        createHash("sha256").update(prompt.body.trim()).digest("hex"),
      );
      expect(entry.promptVersion).toBe("v1.0.0");
      expect(entry.errorMessage).toBeDefined();
    });
  });
});
