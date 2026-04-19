import type { PromptRegistry } from "../prompts/prompt-registry.js";
import type { StructuredPromptProvider } from "./provider-contract.js";

export interface InvokeStructuredPromptOptions {
  promptId: string;
  input: unknown;
  operationName?: string;
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

    return this.provider.invokeStructuredPrompt<T>({
      prompt,
      input: options.input,
      operationName: options.operationName ?? options.promptId,
    });
  }
}

export function createLlmGateway(options: {
  registry: PromptRegistry;
  provider: StructuredPromptProvider;
}): LlmGateway {
  return new DefaultLlmGateway(options.registry, options.provider);
}
