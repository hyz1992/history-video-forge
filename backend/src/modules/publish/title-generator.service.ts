import { getPublishLlmGateway } from "./llm-helper";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";

export interface TitleCandidateResult {
  candidate_id: string;
  text: string;
  style: "standard" | "suspense" | "knowledge" | "emotional";
}

export interface TitleGenerationResult {
  candidates: TitleCandidateResult[];
}

export interface TitleGenerationInput {
  topicTitle: string;
  selectedAngle: string;
  scriptSummary: string;
  durationSec: number;
  currentTitle?: string;
  interactionLogWriter?: LlmInteractionLogWriter;
}

/**
 * Generate title candidates via LLM. Falls back to a basic
 * derivation from the topic title when the LLM is unavailable.
 */
export async function generateTitleCandidates(
  input: TitleGenerationInput,
): Promise<TitleGenerationResult> {
  try {
    const gateway = getPublishLlmGateway();

    const result = await gateway.invokeStructuredPrompt<{
      candidates: TitleCandidateResult[];
    }>({
      promptId: "publish.title-generator",
      operationName: "publish.title-generator",
      input: {
        topic_title: input.topicTitle,
        selected_angle: input.selectedAngle,
        script_summary: input.scriptSummary.slice(0, 300),
        duration_sec: input.durationSec,
        current_title: input.currentTitle ?? "",
      },
      interactionLogWriter: input.interactionLogWriter,
    });

    // Validate styles
    const validStyles = new Set(["standard", "suspense", "knowledge", "emotional"]);
    const candidates = (result.candidates ?? []).map((c, i) => ({
      candidate_id: c.candidate_id ?? `c${i + 1}`,
      text: c.text.slice(0, 30),
      style: validStyles.has(c.style) ? c.style : "standard",
    }));

    return { candidates };
  } catch {
    // Fallback: derive basic candidates from topic title
    const title = input.topicTitle || input.selectedAngle || "";
    const fallbackCandidates: TitleCandidateResult[] = [
      { candidate_id: "c1", text: title.slice(0, 30) || "未命名视频", style: "standard" },
    ];

    if (input.selectedAngle && input.selectedAngle !== title) {
      fallbackCandidates.push({
        candidate_id: "c2",
        text: input.selectedAngle.slice(0, 30),
        style: "suspense",
      });
    }

    return { candidates: fallbackCandidates };
  }
}
