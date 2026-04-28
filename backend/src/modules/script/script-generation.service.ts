import { ScriptDraftPackage } from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
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
  interactionLogWriter?: LlmInteractionLogWriter;
}

export async function generateScriptDraft(input: GenerateScriptDraftInput) {
  const gateway = input.llmGateway ?? createScriptWriterGateway();
  const rawDraft = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "script.writer",
    input: input.bundle,
    interactionLogWriter: input.interactionLogWriter,
  });
  const draft = normalizeScriptDraft(rawDraft);

  return ScriptDraftPackage.parse(draft);
}

function normalizeScriptDraft(rawDraft: unknown) {
  if (!rawDraft || typeof rawDraft !== "object") {
    return rawDraft;
  }

  const draft = { ...(rawDraft as Record<string, unknown>) };
  draft.beat_trace = normalizeBeatTrace(draft.beat_trace);
  draft.quote_trace = normalizeQuoteTrace(draft.quote_trace);
  draft.opening_span = normalizeTextSpan(draft.opening_span);
  draft.ending_span = normalizeTextSpan(draft.ending_span);

  return draft;
}

function normalizeBeatTrace(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return {
        beat:
          typeof record.beat === "string"
            ? record.beat
            : typeof record.label === "string"
              ? record.label
              : extractFirstString(record) ?? "未命名 beat",
        excerpt:
          typeof record.excerpt === "string"
            ? record.excerpt
            : typeof record.beat === "string"
              ? record.beat
              : extractFirstString(record) ?? "未提供 excerpt",
        confidence:
          typeof record.confidence === "number"
            ? record.confidence
            : 0.7,
      };
    }

    const excerpt = typeof item === "string" ? item : String(item);
    return {
      beat: excerpt,
      excerpt,
      confidence: 0.7,
    };
  });
}

function normalizeQuoteTrace(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((item) => {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return {
        quote:
          typeof record.quote === "string"
            ? record.quote
            : extractFirstString(record) ?? "未命名引用",
        usage_type:
          record.usage_type === "paraphrase" ? "paraphrase" : "exact",
        excerpt:
          typeof record.excerpt === "string"
            ? record.excerpt
            : typeof record.quote === "string"
              ? record.quote
              : extractFirstString(record) ?? "未提供 excerpt",
      };
    }

    const excerpt = typeof item === "string" ? item : String(item);
    return {
      quote: excerpt,
      usage_type: "exact" as const,
      excerpt,
    };
  });
}

function normalizeTextSpan(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return extractFirstString(value as Record<string, unknown>) ?? JSON.stringify(value);
  }

  return String(value ?? "");
}

function extractFirstString(record: Record<string, unknown>) {
  const preferredKeys = ["text", "content", "summary", "label", "value", "quote", "beat"];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return null;
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
    async invokeStructuredPrompt<T>(request): Promise<T> {
      const draft = buildDeterministicDraft(
        request.input as ScriptInputBundleInput,
      ) as T;

      await request.interactionLogWriter?.write({
        generatedAt: new Date().toISOString(),
        provider: "stub",
        model: "stub",
        operationName: request.operationName,
        promptId: request.prompt.metadata.id,
        promptStage: request.prompt.metadata.stage,
        promptLanguage: request.prompt.metadata.language,
        promptFilePath: request.prompt.filePath,
        systemPrompt: request.prompt.body,
        input: request.input,
        rawOutput: JSON.stringify(draft, null, 2),
        parsedOutput: draft,
        errorMessage: null,
      });

      return draft;
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
