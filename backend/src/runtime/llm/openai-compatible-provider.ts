import { env, type AppEnv } from "../../config/env.js";
import type { LoadedPrompt } from "../prompts/prompt-loader.js";
import { withRetry } from "./external-errors.js";
import { createRequestBudget, type RequestBudget } from "./request-budget.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";
import {
  classifyOperation,
  getOperationPolicy,
  resolveEffectiveRequest,
  type LlmOperationClass,
} from "./operation-policy.js";
import type {
  LlmResponseMetadata,
  StrictStructuredInvocation,
  StrictStructuredStrategy,
  StrictStructuredToolChoice,
  StrictStructuredToolSchema,
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "./provider-contract.js";
import {
  createStructuredOutputFixer,
  type StructuredOutputFixer,
} from "./structured-output-fix.js";

export interface OpenAiCompatibleInvokeRequest {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  model: string;
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface OpenAiCompatibleStrictInvokeRequest {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  model: string;
  schema: StrictStructuredToolSchema;
  options: {
    strategy: StrictStructuredStrategy;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: "enabled" | "disabled";
    toolChoice?: StrictStructuredToolChoice;
  };
}

export interface OpenAiCompatibleResponseEnvelope {
  rawOutput: string;
  content?: string;
  argumentsJson?: string;
  metadata: LlmResponseMetadata;
}

export interface OpenAiCompatibleProviderOptions {
  profile?: "main" | "structured";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  requestBudget?: RequestBudget;
  invokeApi?: (request: OpenAiCompatibleInvokeRequest, options?: { signal?: AbortSignal }) => Promise<OpenAiCompatibleResponseEnvelope>;
  invokeStrictApi?: (
    request: OpenAiCompatibleStrictInvokeRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<OpenAiCompatibleResponseEnvelope>;
  fetchImpl?: typeof fetch;
  structuredOutputFixer?: StructuredOutputFixer;
}

/**
 * 根据 operation policy 解析本次调用的 retry 策略。
 *
 * - timeout 是否重试由 policy.retryOnTimeout 决定（core_semantic / long_structured 默认 false）。
 * - 瞬时错误（rate_limited / service_unavailable / network）在 policy.transientRetryByClass 上限内重试。
 * - 400/401/invalid_response/configuration 等非瞬时错误永不重试。
 * - effective maxAttempts 取 min(requested, transientCap + 1)，避免通过增大全局 timeout/attempts 掩盖问题。
 */
function resolveRetryStrategy(operationName: string, requestedMaxAttempts: number): {
  maxAttempts: number;
  shouldRetry: (error: { code: string; retryable: boolean }, attempt: number) => boolean;
  operationClass: LlmOperationClass | "unknown";
} {
  const operationClass = classifyOperation(operationName);
  const policy = getOperationPolicy(operationName);
  const transientCap =
    operationClass === "unknown"
      ? 1
      : policy.transientRetryByClass?.[operationClass] ?? 1;
  const transientMaxAttempts = transientCap + 1;
  const maxAttempts = Math.max(1, Math.min(requestedMaxAttempts, transientMaxAttempts));

  const shouldRetry = (error: { code: string; retryable: boolean }, attempt: number) => {
    if (attempt >= maxAttempts) return false;

    if (error.code === "timeout") {
      return policy.retryOnTimeout === true;
    }

    // 瞬时错误：rate_limited / service_unavailable / network。
    // invalid_request / configuration / invalid_response 的 retryable 已为 false，不会进入这里。
    return error.retryable;
  };

  return { maxAttempts, shouldRetry, operationClass };
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions,
): StructuredPromptProvider {
  // Best-effort trace write — never let log failures break the main flow.
  async function safeWrite(
    writer: LlmInteractionLogWriter | undefined | null,
    entry: Parameters<LlmInteractionLogWriter["write"]>[0],
  ) {
    if (!writer) return;
    try {
      await writer.write(entry);
    } catch {
      console.warn("openai_compatible_provider: failed to write interaction log entry");
    }
  }

  const providerConfig = resolveOpenAiCompatibleProviderConfig({
    envConfig: env.llm,
    options,
  });
  const model = providerConfig.model;
  const invokeApi =
    options.invokeApi ??
    createDefaultInvokeApi({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      fetchImpl: options.fetchImpl,
    });
  const invokeStrictApi =
    options.invokeStrictApi ??
    createDefaultInvokeStrictApi({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
      fetchImpl: options.fetchImpl,
    });
  const fixer =
    options.structuredOutputFixer ??
    createStructuredOutputFixer();
  const requestBudget =
    options.requestBudget ??
    createRequestBudget({
      maxRequests: env.llm.requestBudgetMaxRequests,
    });

  return {
    capabilities: {
      jsonObject: true,
      toolCall: true,
      thinkingControl: true,
      samplingControl: true,
    },
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      // 单一真相源：invocation options > operation policy > profile/env defaults > provider default
      const effective = resolveEffectiveRequest({
        operationName: request.operationName,
        operationPolicy: getOperationPolicy(request.operationName),
        profileDefault: {
          maxAttempts: options.maxAttempts ?? env.llm.maxAttempts,
          timeoutMs: options.timeoutMs ?? env.llm.timeoutMs,
        },
        invocationOptions: request.options,
      });
      const effectiveTimeoutMs = effective.timeoutMs;
      const effectiveThinking = effective.thinking === "provider_default" ? undefined : effective.thinking;
      const effectiveMaxTokens = effective.maxTokens;
      const effectiveTemperature = effective.temperature;
      const effectiveTopP = effective.topP;
      // retry safety cap：与参数优先级分离，单独按 operation policy 收敛 attempt 上限
      const retryStrategy = resolveRetryStrategy(
        request.operationName,
        effective.maxAttempts,
      );
      const effectiveMaxAttempts = retryStrategy.maxAttempts;
      const invocationStartedAt = new Date().toISOString();
      let rawOutput = "";
      let responseMetadata: LlmResponseMetadata | undefined;
      const attempts: Array<{
        attempt: number;
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        outcome: "success" | "error";
        errorCode?: string;
        retryDelayMs?: number;
      }> = [];

      try {
        let attemptStartedAt = "";
        const envelope = await withRetry(
          () => {
            requestBudget.consume(request.operationName);

            attemptStartedAt = new Date().toISOString();
            return withTimeout(
              (signal) =>
                invokeApi(
                  {
                    prompt: request.prompt,
                    input: request.input,
                    operationName: request.operationName,
                    model,
                    thinking: effectiveThinking,
                    maxTokens: effectiveMaxTokens,
                    temperature: effectiveTemperature,
                    topP: effectiveTopP,
                  },
                  { signal },
                ).then((env) => {
                  attempts.push({
                    attempt: attempts.length + 1,
                    startedAt: attemptStartedAt,
                    finishedAt: new Date().toISOString(),
                    durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
                    outcome: "success",
                  });
                  return env;
                }),
              effectiveTimeoutMs,
              request.operationName,
            );
          },
          {
            provider: "llm",
            operation: request.operationName,
            maxAttempts: effectiveMaxAttempts,
            shouldRetry: retryStrategy.shouldRetry,
            baseDelayMs: options.baseDelayMs ?? 1500,
            maxDelayMs: options.maxDelayMs ?? 8000,
            onAttempt: (obs) => {
              attempts.push({
                attempt: obs.attempt,
                startedAt: attemptStartedAt,
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
                outcome: "error",
                errorCode: obs.errorCode,
                retryDelayMs: obs.delayMs,
              });
            },
          },
        );

        rawOutput = envelope.rawOutput;
        responseMetadata = envelope.metadata;
        const content = envelope.content ?? "";

        const parsedOutput = await fixer.fix<T>({
          operationName: request.operationName,
          rawOutput: content,
          parse: (candidate) => JSON.parse(candidate) as T,
          deterministicRecovery: recoverJsonCandidate,
        });

        const invocationFinishedAt = new Date().toISOString();
        await safeWrite(request.interactionLogWriter, {
          generatedAt: invocationFinishedAt,
          provider: "openai-compatible",
          model,
          operationName: request.operationName,
          promptId: request.prompt.metadata.id,
          promptStage: request.prompt.metadata.stage,
          promptLanguage: request.prompt.metadata.language,
          promptFilePath: request.prompt.filePath,
          systemPrompt: request.prompt.body,
          input: request.input,
          rawOutput: content,
          parsedOutput,
          errorMessage: null,
          timing: {
            startedAt: invocationStartedAt,
            finishedAt: invocationFinishedAt,
            durationMs: Date.now() - new Date(invocationStartedAt).getTime(),
          },
          effectiveRequest: {
            profile: "main",
            model,
            strategy: "json_object",
            thinking: effectiveThinking ?? "provider_default",
            timeoutMs: effectiveTimeoutMs,
            maxAttempts: effectiveMaxAttempts,
            maxTokens: effectiveMaxTokens,
            temperature: effectiveTemperature,
            topP: effectiveTopP,
          },
          attempts,
          responseMetadata,
        });

        return parsedOutput;
      } catch (error) {
        const invocationFinishedAt = new Date().toISOString();
        await safeWrite(request.interactionLogWriter, {
          generatedAt: invocationFinishedAt,
          provider: "openai-compatible",
          model,
          operationName: request.operationName,
          promptId: request.prompt.metadata.id,
          promptStage: request.prompt.metadata.stage,
          promptLanguage: request.prompt.metadata.language,
          promptFilePath: request.prompt.filePath,
          systemPrompt: request.prompt.body,
          input: request.input,
          rawOutput,
          errorMessage: error instanceof Error ? error.message : String(error),
          timing: {
            startedAt: invocationStartedAt,
            finishedAt: invocationFinishedAt,
            durationMs: Date.now() - new Date(invocationStartedAt).getTime(),
          },
          effectiveRequest: {
            profile: "main",
            model,
            strategy: "json_object",
            thinking: effectiveThinking ?? "provider_default",
            timeoutMs: effectiveTimeoutMs,
            maxAttempts: effectiveMaxAttempts,
            maxTokens: effectiveMaxTokens,
            temperature: effectiveTemperature,
            topP: effectiveTopP,
          },
          attempts,
          responseMetadata,
        });

        throw error;
      }
    },
    async invokeStrictStructured<T>(
      request: StrictStructuredInvocation<T>,
    ): Promise<T> {
      // 单一真相源：invocation options > operation policy > profile/env defaults > provider default
      // profile 级 thinking/maxTokens/temperature/topP 通过 profileDefault 承载，
      // 由 resolveEffectiveRequest 统一按优先级解析；policy 不得被 profile 覆盖。
      const strictEffective = resolveEffectiveRequest({
        operationName: request.operationName,
        operationPolicy: getOperationPolicy(request.operationName),
        profileDefault: {
          maxAttempts: options.maxAttempts ?? env.llm.maxAttempts,
          timeoutMs: options.timeoutMs ?? env.llm.timeoutMs,
          thinking: providerConfig.structuredThinking,
          maxTokens: providerConfig.structuredMaxTokens,
          temperature: providerConfig.structuredTemperature,
          topP: providerConfig.structuredTopP,
        },
        invocationOptions: request.options,
      });
      const effectiveTimeoutMs = strictEffective.timeoutMs;
      const strictRetryStrategy = resolveRetryStrategy(
        request.operationName,
        strictEffective.maxAttempts,
      );
      const effectiveMaxAttempts = strictRetryStrategy.maxAttempts;
      const invocationStartedAt = new Date().toISOString();
      let rawOutput = "";
      let parsedOutput: T | undefined;
      let responseMetadata: LlmResponseMetadata | undefined;
      const attempts: Array<{
        attempt: number;
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        outcome: "success" | "error";
        errorCode?: string;
        retryDelayMs?: number;
      }> = [];
      const effectiveStrategy =
        request.options?.strategy ??
        providerConfig.structuredStrategy ??
        "json_object";
      const effectiveThinking =
        strictEffective.thinking === "provider_default"
          ? undefined
          : strictEffective.thinking;
      const effectiveMaxTokens = strictEffective.maxTokens;
      const effectiveTemperature = strictEffective.temperature;
      const effectiveTopP = strictEffective.topP;
      const effectiveToolChoice = request.options?.toolChoice ?? "auto";

      try {
        let attemptStartedAt = "";
        const strictResult = await withRetry(
          () => {
            requestBudget.consume(request.operationName);

            attemptStartedAt = new Date().toISOString();
            return withTimeout(
              (signal) =>
                invokeStrictApi(
                  {
                    prompt: request.prompt,
                    input: request.input,
                    operationName: request.operationName,
                    model,
                    schema: request.schema,
                    options: {
                      strategy: effectiveStrategy,
                      temperature: effectiveTemperature,
                      topP: effectiveTopP,
                      maxTokens: effectiveMaxTokens,
                      thinking: effectiveThinking,
                      toolChoice: effectiveToolChoice,
                    },
                  },
                  { signal },
                ).then((env) => {
                  attempts.push({
                    attempt: attempts.length + 1,
                    startedAt: attemptStartedAt,
                    finishedAt: new Date().toISOString(),
                    durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
                    outcome: "success",
                  });
                  return env;
                }),
              effectiveTimeoutMs,
              request.operationName,
            );
          },
          {
            provider: "llm",
            operation: request.operationName,
            maxAttempts: effectiveMaxAttempts,
            shouldRetry: strictRetryStrategy.shouldRetry,
            baseDelayMs: options.baseDelayMs ?? 1500,
            maxDelayMs: options.maxDelayMs ?? 8000,
            onAttempt: (obs) => {
              attempts.push({
                attempt: obs.attempt,
                startedAt: attemptStartedAt,
                finishedAt: new Date().toISOString(),
                durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
                outcome: "error",
                errorCode: obs.errorCode,
                retryDelayMs: obs.delayMs,
              });
            },
          },
        );

        rawOutput = strictResult.rawOutput;
        responseMetadata = strictResult.metadata;
        parsedOutput = request.parse(JSON.parse(strictResult.argumentsJson ?? "{}"));

        const invocationFinishedAt = new Date().toISOString();
        await safeWrite(request.interactionLogWriter, {
          generatedAt: invocationFinishedAt,
          provider: "openai-compatible",
          model,
          operationName: request.operationName,
          promptId: request.prompt.metadata.id,
          promptStage: request.prompt.metadata.stage,
          promptLanguage: request.prompt.metadata.language,
          promptFilePath: request.prompt.filePath,
          systemPrompt: request.prompt.body,
          input: request.input,
          rawOutput,
          parsedOutput,
          errorMessage: null,
          timing: {
            startedAt: invocationStartedAt,
            finishedAt: invocationFinishedAt,
            durationMs: Date.now() - new Date(invocationStartedAt).getTime(),
          },
          effectiveRequest: {
            profile: "structured",
            model,
            strategy: effectiveStrategy,
            thinking: effectiveThinking ?? "provider_default",
            timeoutMs: effectiveTimeoutMs,
            maxAttempts: effectiveMaxAttempts,
            temperature: effectiveTemperature,
            topP: effectiveTopP,
            maxTokens: effectiveMaxTokens,
            toolChoice: effectiveToolChoice,
          },
          attempts,
          responseMetadata,
        });

        return parsedOutput;
      } catch (error) {
        const invocationFinishedAt = new Date().toISOString();
        await safeWrite(request.interactionLogWriter, {
          generatedAt: invocationFinishedAt,
          provider: "openai-compatible",
          model,
          operationName: request.operationName,
          promptId: request.prompt.metadata.id,
          promptStage: request.prompt.metadata.stage,
          promptLanguage: request.prompt.metadata.language,
          promptFilePath: request.prompt.filePath,
          systemPrompt: request.prompt.body,
          input: request.input,
          rawOutput,
          errorMessage: error instanceof Error ? error.message : String(error),
          timing: {
            startedAt: invocationStartedAt,
            finishedAt: invocationFinishedAt,
            durationMs: Date.now() - new Date(invocationStartedAt).getTime(),
          },
          effectiveRequest: {
            profile: "structured",
            model,
            strategy: effectiveStrategy,
            thinking: effectiveThinking ?? "provider_default",
            timeoutMs: effectiveTimeoutMs,
            maxAttempts: effectiveMaxAttempts,
            temperature: effectiveTemperature,
            topP: effectiveTopP,
            maxTokens: effectiveMaxTokens,
            toolChoice: effectiveToolChoice,
          },
          attempts,
          responseMetadata,
        });

        throw error;
      }
    },
  };
}

export function resolveOpenAiCompatibleProviderConfig(options: {
  envConfig: AppEnv["llm"];
  options: OpenAiCompatibleProviderOptions;
}): {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  structuredStrategy?: StrictStructuredStrategy;
  structuredThinking?: "enabled" | "disabled";
  structuredTemperature?: number;
  structuredTopP?: number;
  structuredMaxTokens?: number;
} {
  const useStructuredProfile =
    options.options.profile === "structured" ||
    (!options.options.profile && !options.options.model);

  if (useStructuredProfile) {
    return {
      apiKey:
        options.options.apiKey ??
        options.envConfig.structuredApiKey ??
        options.envConfig.apiKey,
      baseUrl:
        options.options.baseUrl ??
        options.envConfig.structuredBaseUrl ??
        options.envConfig.baseUrl,
      model:
        options.options.model ??
        options.envConfig.structuredModel ??
        options.envConfig.model,
      structuredStrategy: options.envConfig.structuredStrategy,
      structuredThinking: options.envConfig.structuredThinking,
      structuredTemperature: options.envConfig.structuredTemperature,
      structuredTopP: options.envConfig.structuredTopP,
      structuredMaxTokens: options.envConfig.structuredMaxTokens,
    };
  }

  return {
    apiKey: options.options.apiKey ?? options.envConfig.apiKey,
    baseUrl: options.options.baseUrl ?? options.envConfig.baseUrl,
    model: options.options.model ?? options.envConfig.model,
    structuredStrategy: options.envConfig.structuredStrategy,
    structuredThinking: options.envConfig.structuredThinking,
    structuredTemperature: options.envConfig.structuredTemperature,
    structuredTopP: options.envConfig.structuredTopP,
    structuredMaxTokens: options.envConfig.structuredMaxTokens,
  };
}

function createDefaultInvokeApi(options: {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fetchImpl?: typeof fetch;
}): (request: OpenAiCompatibleInvokeRequest, requestOptions?: { signal?: AbortSignal }) => Promise<OpenAiCompatibleResponseEnvelope> {
  return async (request, requestOptions) => {
    if (!options.apiKey || !options.baseUrl) {
      throw new Error("LLM API key or base URL is not configured.");
    }

    const body: Record<string, unknown> = {
      model: options.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: request.prompt.body,
        },
        {
          role: "user",
          content: JSON.stringify(request.input, null, 2),
        },
      ],
    };

    if (request.thinking !== undefined) {
      body.thinking = { type: request.thinking };
    }
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.topP !== undefined) {
      body.top_p = request.topP;
    }

    const response = await (options.fetchImpl ?? fetch)(`${trimTrailingSlash(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: requestOptions?.signal,
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const metadata = extractResponseMetadata(payload);
    const choices = payload.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    const rawOutput = JSON.stringify(payload);

    if (typeof content === "string") {
      return { rawOutput, content, metadata };
    }

    if (Array.isArray(content)) {
      const text = (content as Array<{ type?: string; text?: string }>)
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .join("")
        .trim();
      if (text) {
        return { rawOutput, content: text, metadata };
      }
    }

    throw new Error("LLM response did not contain message content.");
  };
}

function createDefaultInvokeStrictApi(options: {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fetchImpl?: typeof fetch;
}): (
  request: OpenAiCompatibleStrictInvokeRequest,
  requestOptions?: { signal?: AbortSignal },
) => Promise<OpenAiCompatibleResponseEnvelope> {
  return async (request, requestOptions) => {
    if (!options.apiKey || !options.baseUrl) {
      throw new Error("LLM API key or base URL is not configured.");
    }

    if (request.options.strategy !== "tool_call") {
      throw new Error("strict_structured_strategy_not_supported");
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: [
        {
          role: "system",
          content: request.prompt.body,
        },
        {
          role: "user",
          content: JSON.stringify(request.input, null, 2),
        },
      ],
      tools: [
        {
          type: "function",
          function: request.schema,
        },
      ],
      tool_choice: request.options.toolChoice === "target_function"
        ? {
            type: "function",
            function: { name: request.schema.name },
          }
        : "auto",
    };

    if (request.options.temperature !== undefined) {
      body.temperature = request.options.temperature;
    }
    if (request.options.topP !== undefined) {
      body.top_p = request.options.topP;
    }
    if (request.options.maxTokens !== undefined) {
      body.max_tokens = request.options.maxTokens;
    }
    if (request.options.thinking !== undefined) {
      body.thinking = {
        type: request.options.thinking,
      };
    }

    const response = await (options.fetchImpl ?? fetch)(`${trimTrailingSlash(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: requestOptions?.signal,
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const metadata = extractResponseMetadata(payload);
    const rawOutput = JSON.stringify(payload);
    const choices = payload.choices as Array<Record<string, unknown>> | undefined;
    const message = choices?.[0]?.message as Record<string, unknown> | undefined;
    const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined;
    const func = toolCalls?.[0]?.function as Record<string, unknown> | undefined;
    const toolName = func?.name as string | undefined;
    const argumentsJson = func?.arguments as string | undefined;

    if (typeof argumentsJson !== "string" || !argumentsJson.trim()) {
      throw new Error("strict_structured_no_tool_call");
    }

    if (
      request.options.toolChoice === "target_function"
      && toolName !== request.schema.name
    ) {
      throw new Error(
        `strict_structured_target_tool_mismatch: expected=${request.schema.name} actual=${toolName ?? "missing"}`,
      );
    }

    return {
      rawOutput,
      argumentsJson,
      metadata,
    };
  };
}

function recoverJsonCandidate(rawOutput: string): string | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/u);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}

function extractResponseMetadata(payload: Record<string, unknown>): LlmResponseMetadata {
  const usage = payload.usage as Record<string, unknown> | undefined;
  const details = usage?.completion_tokens_details as Record<string, unknown> | undefined;
  const choices = payload.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];

  return {
    promptTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined,
    completionTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined,
    reasoningTokens: typeof details?.reasoning_tokens === "number" ? details.reasoning_tokens : undefined,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

async function buildHttpErrorMessage(response: Response): Promise<string> {
  const statusLine = `${response.status} ${response.statusText}`.trim();

  try {
    const body = await response.text();
    const trimmed = body.trim();

    return trimmed ? `${statusLine}: ${trimmed}` : statusLine;
  } catch {
    return statusLine;
  }
}

function withTimeout<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${operationName} timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      controller.abort(error);
      reject(error);
    }, timeoutMs);

    invoke(controller.signal)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
