import { env, type AppEnv } from "../../config/env.js";
import type { LoadedPrompt } from "../prompts/prompt-loader.js";
import { withRetry } from "./external-errors.js";
import { createRequestBudget, type RequestBudget } from "./request-budget.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";
import type {
  StrictStructuredInvocation,
  StrictStructuredStrategy,
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
  };
}

export interface OpenAiCompatibleStrictInvokeResult {
  rawOutput: string;
  argumentsJson: string;
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
  invokeApi?: (request: OpenAiCompatibleInvokeRequest) => Promise<string>;
  invokeStrictApi?: (
    request: OpenAiCompatibleStrictInvokeRequest,
  ) => Promise<OpenAiCompatibleStrictInvokeResult>;
  structuredOutputFixer?: StructuredOutputFixer;
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
    });
  const invokeStrictApi =
    options.invokeStrictApi ??
    createDefaultInvokeStrictApi({
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model,
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
      let rawOutput = "";

      try {
        rawOutput = await withRetry(
          () => {
            requestBudget.consume(request.operationName);

            return withTimeout(
              invokeApi({
                prompt: request.prompt,
                input: request.input,
                operationName: request.operationName,
                model,
              }),
              options.timeoutMs ?? env.llm.timeoutMs,
              request.operationName,
            );
          },
          {
            provider: "llm",
            operation: request.operationName,
            maxAttempts: options.maxAttempts ?? env.llm.maxAttempts,
            baseDelayMs: options.baseDelayMs ?? 1500,
            maxDelayMs: options.maxDelayMs ?? 8000,
          },
        );

        const parsedOutput = await fixer.fix<T>({
          operationName: request.operationName,
          rawOutput,
          parse: (candidate) => JSON.parse(candidate) as T,
          deterministicRecovery: recoverJsonCandidate,
        });

        await safeWrite(request.interactionLogWriter, {
          generatedAt: new Date().toISOString(),
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
        });

        return parsedOutput;
      } catch (error) {
        await safeWrite(request.interactionLogWriter, {
          generatedAt: new Date().toISOString(),
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
        });

        throw error;
      }
    },
    async invokeStrictStructured<T>(
      request: StrictStructuredInvocation<T>,
    ): Promise<T> {
      let rawOutput = "";
      let parsedOutput: T | undefined;

      try {
        const strictResult = await withRetry(
          () => {
            requestBudget.consume(request.operationName);

            return withTimeout(
              invokeStrictApi({
                prompt: request.prompt,
                input: request.input,
                operationName: request.operationName,
                model,
                schema: request.schema,
                options: {
                  strategy:
                    request.options?.strategy ??
                    providerConfig.structuredStrategy ??
                    "json_object",
                  temperature:
                    request.options?.temperature ??
                    providerConfig.structuredTemperature,
                  topP:
                    request.options?.topP ??
                    providerConfig.structuredTopP,
                  maxTokens:
                    request.options?.maxTokens ??
                    providerConfig.structuredMaxTokens,
                  thinking:
                    request.options?.thinking ??
                    providerConfig.structuredThinking,
                },
              }),
              options.timeoutMs ?? env.llm.timeoutMs,
              request.operationName,
            );
          },
          {
            provider: "llm",
            operation: request.operationName,
            maxAttempts: options.maxAttempts ?? env.llm.maxAttempts,
            baseDelayMs: options.baseDelayMs ?? 1500,
            maxDelayMs: options.maxDelayMs ?? 8000,
          },
        );

        rawOutput = strictResult.rawOutput;
        parsedOutput = request.parse(JSON.parse(strictResult.argumentsJson));

        await safeWrite(request.interactionLogWriter, {
          generatedAt: new Date().toISOString(),
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
        });

        return parsedOutput;
      } catch (error) {
        await safeWrite(request.interactionLogWriter, {
          generatedAt: new Date().toISOString(),
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
}): (request: OpenAiCompatibleInvokeRequest) => Promise<string> {
  return async (request) => {
    if (!options.apiKey || !options.baseUrl) {
      throw new Error("LLM API key or base URL is not configured.");
    }

    const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .join("")
        .trim();
      if (text) {
        return text;
      }
    }

    throw new Error("LLM response did not contain message content.");
  };
}

function createDefaultInvokeStrictApi(options: {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}): (
  request: OpenAiCompatibleStrictInvokeRequest,
) => Promise<OpenAiCompatibleStrictInvokeResult> {
  return async (request) => {
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
      tool_choice: "auto",
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

    const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await buildHttpErrorMessage(response));
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: {
              arguments?: string;
            };
          }>;
        };
      }>;
    };
    const rawOutput = JSON.stringify(payload);
    const argumentsJson =
      payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

    if (typeof argumentsJson !== "string" || !argumentsJson.trim()) {
      throw new Error("strict_structured_no_tool_call");
    }

    return {
      rawOutput,
      argumentsJson,
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
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`${operationName} timed out after ${timeoutMs}ms`);
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);

    promise
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
