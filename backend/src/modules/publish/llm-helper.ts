import { createLlmGateway } from "../../runtime/llm/llm-gateway";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry";

let cachedGateway: ReturnType<typeof createLlmGateway> | null = null;

/**
 * Shared LLM gateway for publish-stage services.
 * Cached so description and title generators share the same instance.
 */
export function getPublishLlmGateway() {
  if (!cachedGateway) {
    const registry = createPromptRegistry();
    const provider = createOpenAiCompatibleProvider({});
    cachedGateway = createLlmGateway({ registry, provider });
  }
  return cachedGateway;
}
