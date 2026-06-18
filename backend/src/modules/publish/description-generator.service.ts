import { getPublishLlmGateway } from "./llm-helper";

export interface DescriptionGenerationInput {
  topicTitle: string;
  selectedAngle: string;
  scriptSummary: string;
  durationSec: number;
  platformProfile?: string;
}

export interface DescriptionGenerationResult {
  description: string;
}

/**
 * Generate a publish description via LLM. Falls back to a short
 * derivation from the topic title and script summary when the LLM
 * is unavailable.
 */
export async function generateDescription(
  input: DescriptionGenerationInput,
): Promise<DescriptionGenerationResult> {
  try {
    const gateway = getPublishLlmGateway();

    const result = await gateway.invokeStructuredPrompt<{
      description: string;
    }>({
      promptId: "publish.description-generator",
      input: {
        topic_title: input.topicTitle,
        selected_angle: input.selectedAngle,
        script_summary: input.scriptSummary.slice(0, 500),
        duration_sec: input.durationSec,
        platform_profile: input.platformProfile ?? "generic",
      },
      interactionLogWriter: null,
    });

    return { description: (result.description ?? "").slice(0, 200) };
  } catch {
    // Fallback: derive a basic description from the inputs
    const title = input.topicTitle || input.selectedAngle || "";
    const fallback =
      title.length > 0
        ? `${title}。一段关于${input.selectedAngle || title}的历史故事，带你回到那个风云变幻的年代。`.slice(0, 200)
        : "";
    return { description: fallback };
  }
}
