import type { LoadedPrompt } from "../prompts/prompt-loader.js";

export interface StructuredPromptInvocation {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
}

export interface StructuredPromptProvider {
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
}
