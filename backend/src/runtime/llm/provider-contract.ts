import type { LoadedPrompt } from "../prompts/prompt-loader.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";

export type StrictStructuredStrategy = "json_object" | "tool_call" | "auto";

export type StrictStructuredThinking = "enabled" | "disabled";

export interface LlmProviderCapabilities {
  jsonObject: boolean;
  toolCall: boolean;
  thinkingControl: boolean;
  samplingControl: boolean;
}

export interface StrictStructuredToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface StrictStructuredInvocation<T> {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  schema: StrictStructuredToolSchema;
  parse: (candidate: unknown) => T;
  options?: {
    strategy?: StrictStructuredStrategy;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: StrictStructuredThinking;
  };
  interactionLogWriter?: LlmInteractionLogWriter;
}

export interface StructuredPromptInvocation {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  interactionLogWriter?: LlmInteractionLogWriter;
}

export interface StructuredPromptProvider {
  capabilities?: LlmProviderCapabilities;
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
  invokeStrictStructured?<T>(request: StrictStructuredInvocation<T>): Promise<T>;
}
