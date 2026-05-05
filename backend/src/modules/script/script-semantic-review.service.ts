import { ScriptSemanticReviewResult } from "../../../../shared/src/index";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

interface ScriptInputBundleInput {
  hard_lane: {
    must_include_beats: string[];
    scope_label: string;
    selected_angle: string;
  };
  soft_lane: {
    narrative_tension_map: {
      hook_claim: string;
      pressure_escalation: string;
      mid_reveal: string;
      peak_payoff: string;
      ending_residue: string;
    };
  };
}

interface ScriptDraftInput {
  opening_span: string;
  ending_span: string;
  script_text: string;
}

export interface ReviewScriptSemanticsInput {
  bundle: ScriptInputBundleInput;
  draft: ScriptDraftInput;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
}

export async function reviewScriptSemantics(input: ReviewScriptSemanticsInput) {
  const gateway = input.llmGateway ?? createSemanticReviewerGateway();
  if (!gateway) {
    return buildSkippedSemanticReview();
  }

  try {
    const rawReview = await gateway.invokeStructuredPrompt<unknown>({
      promptId: "script.semantic-reviewer",
      input: {
        bundle: input.bundle,
        draft: input.draft,
      },
      interactionLogWriter: input.interactionLogWriter,
    });

    return ScriptSemanticReviewResult.parse(rawReview);
  } catch {
    return buildSkippedSemanticReview();
  }
}

function buildSkippedSemanticReview() {
  return ScriptSemanticReviewResult.parse({
    stage: "script_semantic_review",
    decision: "skipped",
    patch_intent: null,
    hard_issues: [],
    soft_issues: [],
    patch_targets: [],
    summary: "当前环境未接入真实语义审校，跳过语义裁判。",
    confidence: 0.5,
  });
}

function createSemanticReviewerGateway(): LlmGateway | null {
  if (env.llm.provider === "stub") {
    return null;
  }

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider: createOpenAiCompatibleProvider({
      ...getValidatedRuntimeEnv().llm,
    }),
  });
}
