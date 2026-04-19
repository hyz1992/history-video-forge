import { ScriptDraftPackage } from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
    selected_angle: string;
    must_include_beats: string[];
  };
  soft_lane: {
    narrative_tension_map: {
      hook_claim: string;
      pressure_escalation: string;
      mid_reveal: string;
      peak_payoff: string;
      ending_residue: string;
    };
    strong_scene: string;
  };
  packaging_lane: {
    hook_claim: string;
  };
  topic_package: {
    canonical_quotes?: string[];
  };
}

export interface GenerateScriptDraftInput {
  bundle: ScriptInputBundleInput;
  llmGateway?: LlmGateway;
}

export async function generateScriptDraft(input: GenerateScriptDraftInput) {
  const gateway = input.llmGateway ?? createScriptWriterGateway();
  const draft = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "script.writer",
    input: input.bundle,
  });

  return ScriptDraftPackage.parse(draft);
}

function createScriptWriterGateway(): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubScriptWriterProvider()
      : createOpenAiCompatibleProvider({
          ...getValidatedRuntimeEnv().llm,
        });

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createStubScriptWriterProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>({ input }): Promise<T> {
      return buildDeterministicDraft(input as ScriptInputBundleInput) as T;
    },
  };
}

function buildDeterministicDraft(input: ScriptInputBundleInput) {
  const bundle = input;
  const beats = bundle.hard_lane.must_include_beats;
  const quote = bundle.topic_package.canonical_quotes?.[0];
  const openingSpan = bundle.packaging_lane.hook_claim;
  const endingSpan = bundle.soft_lane.narrative_tension_map.ending_residue;

  const lines = [
    openingSpan,
    `${bundle.hard_lane.event_identity}这件事里，最先顶上来的不是答案，而是公开压场。`,
    ...beats.map(
      (beat, index) =>
        `${index + 1}. ${beat}，真正把局势往前推了一层。`,
    ),
    `${bundle.soft_lane.narrative_tension_map.mid_reveal}。`,
    `${bundle.soft_lane.narrative_tension_map.peak_payoff}。`,
  ];

  if (quote) {
    lines.push(`那句最关键的话就是“${quote}”。`);
  }

  lines.push(endingSpan);

  const scriptText = lines.join("\n");

  return {
    script_text: scriptText,
    estimated_duration_sec: 88,
    beat_trace: beats.map((beat) => ({
      beat,
      excerpt: `${beat}，真正把局势往前推了一层。`,
      confidence: 0.92,
    })),
    quote_trace: quote
      ? [
          {
            quote,
            usage_type: "exact" as const,
            excerpt: `“${quote}”`,
          },
        ]
      : [],
    opening_span: openingSpan,
    ending_span: endingSpan,
  };
}
