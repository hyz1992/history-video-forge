import { env, type AppEnv } from "../../config/env.js";
import type { LoadedPrompt } from "../prompts/prompt-loader.js";
import { withRetry } from "./external-errors.js";
import { createRequestBudget, type RequestBudget } from "./request-budget.js";
import type {
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
  structuredOutputFixer?: StructuredOutputFixer;
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleProviderOptions,
): StructuredPromptProvider {
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
  const fixer =
    options.structuredOutputFixer ??
    createStructuredOutputFixer();
  const requestBudget =
    options.requestBudget ??
    createRequestBudget({
      maxRequests: env.llm.requestBudgetMaxRequests,
    });

  return {
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

        await request.interactionLogWriter?.write({
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
        await request.interactionLogWriter?.write({
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
    };
  }

  return {
    apiKey: options.options.apiKey ?? options.envConfig.apiKey,
    baseUrl: options.options.baseUrl ?? options.envConfig.baseUrl,
    model: options.options.model ?? options.envConfig.model,
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
      throw new Error(`${response.status} ${response.statusText}`);
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
