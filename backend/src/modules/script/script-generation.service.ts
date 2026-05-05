import { ScriptDraftPackage } from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

interface ScriptInputBundleInput {
  topic_package: {
    stakes?: string;
    source_anchor_refs?: string[];
    canonical_quotes?: string[];
    ambiguity_notes?: string[];
  };
  hard_lane: {
    event_identity: string;
    selected_angle: string;
    core_conflict?: string;
    stakes?: string;
    must_include_beats: string[];
    source_anchor_refs?: string[];
    canonical_quotes?: string[];
    ambiguity_notes?: string[];
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
  const draft = normalizeScriptDraft(
    rawDraft,
    input.bundle.hard_lane.must_include_beats,
  );

  return ScriptDraftPackage.parse(draft);
}

function normalizeScriptDraft(rawDraft: unknown, requiredBeats: string[]) {
  if (!rawDraft || typeof rawDraft !== "object") {
    return rawDraft;
  }

  const record = rawDraft as Record<string, unknown>;
  const unwrappedDraft =
    record.script_draft_package &&
    typeof record.script_draft_package === "object" &&
    !Array.isArray(record.script_draft_package)
      ? (record.script_draft_package as Record<string, unknown>)
      : record;
  const draft = { ...unwrappedDraft };
  draft.beat_trace = normalizeBeatTrace(draft.beat_trace, requiredBeats);
  draft.quote_trace = normalizeQuoteTrace(draft.quote_trace);
  draft.opening_span = normalizeTextSpan(draft.opening_span);
  draft.ending_span = normalizeTextSpan(draft.ending_span);

  return draft;
}

function normalizeBeatTrace(value: unknown, requiredBeats: string[]) {
  if (!Array.isArray(value)) {
    return value;
  }

  const unmatchedRequiredBeats = [...requiredBeats];

  return value.map((item, index) => {
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const beatLabel =
        typeof record.beat === "string"
          ? record.beat
          : typeof record.label === "string"
            ? record.label
            : extractFirstString(record) ?? "未命名 beat";
      const excerpt =
        typeof record.excerpt === "string"
          ? record.excerpt
          : typeof record.beat === "string"
            ? record.beat
            : extractFirstString(record) ?? "未提供 excerpt";
      const ordinalBeat = resolveOrdinalBeatPlaceholder(
        beatLabel,
        excerpt,
        index,
        requiredBeats,
        unmatchedRequiredBeats,
      );
      if (ordinalBeat) {
        return {
          beat: ordinalBeat,
          excerpt: ordinalBeat,
          confidence:
            typeof record.confidence === "number"
              ? record.confidence
              : 0.7,
        };
      }
      return {
        beat: canonicalizeBeatLabel(beatLabel, excerpt, unmatchedRequiredBeats),
        excerpt,
        confidence:
          typeof record.confidence === "number"
            ? record.confidence
            : 0.7,
      };
    }

    const excerpt = typeof item === "string" ? item : String(item);
    const ordinalBeat = resolveOrdinalBeatPlaceholder(
      excerpt,
      excerpt,
      index,
      requiredBeats,
      unmatchedRequiredBeats,
    );
    if (ordinalBeat) {
      return {
        beat: ordinalBeat,
        excerpt: ordinalBeat,
        confidence: 0.7,
      };
    }
    return {
      beat: canonicalizeBeatLabel(excerpt, excerpt, unmatchedRequiredBeats),
      excerpt,
      confidence: 0.7,
    };
  });
}

function resolveOrdinalBeatPlaceholder(
  beatLabel: string,
  excerpt: string,
  index: number,
  requiredBeats: string[],
  unmatchedRequiredBeats: string[],
) {
  const normalizedBeatLabel = beatLabel.trim();
  const normalizedExcerpt = excerpt.trim();
  if (!/^\d+$/.test(normalizedBeatLabel) && !/^\d+$/.test(normalizedExcerpt)) {
    return null;
  }

  const candidateBeat =
    requiredBeats[index] ??
    unmatchedRequiredBeats.find((requiredBeat) => requiredBeat.length > 0);
  if (!candidateBeat) {
    return null;
  }

  const matchedIndex = unmatchedRequiredBeats.indexOf(candidateBeat);
  if (matchedIndex >= 0) {
    unmatchedRequiredBeats.splice(matchedIndex, 1);
  }

  return candidateBeat;
}

function canonicalizeBeatLabel(
  beatLabel: string,
  excerpt: string,
  unmatchedRequiredBeats: string[],
) {
  const normalizedBeatLabel = beatLabel.trim();
  const normalizedExcerpt = excerpt.trim();
  const matchedIndex = unmatchedRequiredBeats.findIndex((requiredBeat) =>
    [normalizedBeatLabel, normalizedExcerpt].some(
      (text) =>
        text.length > 0 &&
        (text === requiredBeat ||
          text.includes(requiredBeat) ||
          requiredBeat.includes(text)),
    ),
  );

  if (matchedIndex === -1) {
    return normalizedBeatLabel;
  }

  const [matchedBeat] = unmatchedRequiredBeats.splice(matchedIndex, 1);
  return matchedBeat ?? normalizedBeatLabel;
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
  const openingSpan =
    bundle.soft_lane.strong_scene.trim() ||
    bundle.hard_lane.core_conflict?.trim() ||
    bundle.packaging_lane.hook_claim;
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
