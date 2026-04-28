import type { PromptRegistry } from "../prompts/prompt-registry.js";
import { classifyExternalError } from "./external-errors.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";
import type { StructuredPromptProvider } from "./provider-contract.js";

export interface InvokeStructuredPromptOptions {
  promptId: string;
  input: unknown;
  operationName?: string;
  interactionLogWriter?: LlmInteractionLogWriter;
}

export interface LlmGateway {
  invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T>;
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
