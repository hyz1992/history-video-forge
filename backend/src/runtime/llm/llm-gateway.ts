import type { PromptRegistry } from "../prompts/prompt-registry.js";
import { classifyExternalError } from "./external-errors.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";
import type {
  StrictStructuredInvocation,
  StrictStructuredStrategy,
  StrictStructuredThinking,
  StrictStructuredToolSchema,
  StructuredPromptProvider,
} from "./provider-contract.js";

export interface InvokeStructuredPromptOptions {
  promptId: string;
  input: unknown;
  operationName?: string;
  interactionLogWriter?: LlmInteractionLogWriter;
  options?: {
    thinking?: "enabled" | "disabled";
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    timeoutMs?: number;
    maxAttempts?: number;
  };
}

export interface InvokeStrictStructuredOptions<T> {
  promptId: string;
  input: unknown;
  operationName?: string;
  schema: StrictStructuredToolSchema;
  parse: StrictStructuredInvocation<T>["parse"];
  options?: {
    strategy?: StrictStructuredStrategy;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: StrictStructuredThinking;
  };
  interactionLogWriter?: LlmInteractionLogWriter;
}

export interface LlmGateway {
  invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T>;
  invokeStrictStructured<T>(options: InvokeStrictStructuredOptions<T>): Promise<T>;
}

class DefaultLlmGateway implements LlmGateway {
  constructor(
    private readonly registry: PromptRegistry,
    private readonly provider: StructuredPromptProvider,
  ) {}

  async invokeStructuredPrompt<T>(
    options: InvokeStructuredPromptOptions,
  ): Promise<T> {
    const prompt = this.registry.getPrompt(options.promptId);
    const operationName = options.operationName ?? options.promptId;

    try {
      return await this.provider.invokeStructuredPrompt<T>({
        prompt,
        input: options.input,
        operationName,
        interactionLogWriter: options.interactionLogWriter,
        options: options.options,
      });
    } catch (error) {
      throw classifyExternalError(error, {
        provider: "llm",
        operation: operationName,
      });
    }
  }

  async invokeStrictStructured<T>(
    options: InvokeStrictStructuredOptions<T>,
  ): Promise<T> {
    if (!this.provider.invokeStrictStructured) {
      throw classifyExternalError(
        new Error("strict_structured_provider_not_supported"),
        {
          provider: "llm",
          operation: options.operationName ?? options.promptId,
        },
      );
    }

    const prompt = this.registry.getPrompt(options.promptId);
    const operationName = options.operationName ?? options.promptId;

    try {
      return await this.provider.invokeStrictStructured<T>({
        prompt,
        input: options.input,
        operationName,
        schema: options.schema,
        parse: options.parse,
        options: options.options,
        interactionLogWriter: options.interactionLogWriter,
      });
    } catch (error) {
      throw classifyExternalError(error, {
        provider: "llm",
        operation: operationName,
      });
    }
  }
}

export function createLlmGateway(options: {
  registry: PromptRegistry;
  provider: StructuredPromptProvider;
}): LlmGateway {
  return new DefaultLlmGateway(options.registry, options.provider);
}
