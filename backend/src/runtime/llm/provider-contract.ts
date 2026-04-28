import type { LoadedPrompt } from "../prompts/prompt-loader.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";

export interface StructuredPromptInvocation {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  interactionLogWriter?: LlmInteractionLogWriter;
}

export interface StructuredPromptProvider {
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
}
