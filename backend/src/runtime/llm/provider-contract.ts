import type { LoadedPrompt } from "../prompts/prompt-loader.js";
import type { LlmInteractionLogWriter } from "./interaction-log.js";

export type StrictStructuredStrategy = "json_object" | "tool_call" | "auto";

export type StrictStructuredThinking = "enabled" | "disabled";

export type LlmThinkingStatus =
  | "enabled"
  | "disabled"
  | "provider_default"
  | "unsupported";

export interface LlmEffectiveRequest {
  profile: "main" | "structured";
  model: string;
  strategy: StrictStructuredStrategy;
  thinking: LlmThinkingStatus;
  timeoutMs: number;
  maxAttempts: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface LlmAttemptObservation {
  attempt: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: "success" | "error";
  errorCode?: string;
  retryDelayMs?: number;
}

export interface LlmResponseMetadata {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  finishReason?: string;
}

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
  options?: {
    thinking?: "enabled" | "disabled";
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    timeoutMs?: number;
    maxAttempts?: number;
  };
}

export interface StructuredPromptProvider {
  capabilities?: LlmProviderCapabilities;
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
  invokeStrictStructured?<T>(request: StrictStructuredInvocation<T>): Promise<T>;
}
