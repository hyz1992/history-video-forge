import { ScriptDraftPackage } from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
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
  regenerationContext?: {
    reason: "local_validation_regen_once";
    errors: string[];
    metrics: Record<string, unknown>;
    previous_draft?: {
      script_text_excerpt: string;
      opening_span: string;
      ending_span: string;
      beat_trace_summary: Array<{
        beat: string;
        excerpt: string;
      }>;
    };
    user_feedback?: string;
  };
}

export async function generateScriptDraft(input: GenerateScriptDraftInput) {
  const gateway = input.llmGateway ?? createScriptWriterGateway();
  const rawDraft = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "script.writer",
    input: buildScriptWriterPromptInput(input),
    interactionLogWriter: input.interactionLogWriter,
  });
  const draft = normalizeScriptDraft(
    rawDraft,
    input.bundle.hard_lane.must_include_beats,
  );

  return ScriptDraftPackage.parse(draft);
}

function buildScriptWriterPromptInput(input: GenerateScriptDraftInput) {
  if (!input.regenerationContext) {
    return input.bundle;
  }

  return {
    bundle: input.bundle,
    regeneration_context: input.regenerationContext,
  };
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
  draft.beat_trace = normalizeBeatTrace(
    draft.beat_trace,
    requiredBeats,
    typeof draft.script_text === "string" ? draft.script_text : "",
  );
  draft.quote_trace = normalizeQuoteTrace(draft.quote_trace);
  draft.opening_span = normalizeTextSpan(draft.opening_span);
  draft.ending_span = normalizeTextSpan(draft.ending_span);

  return draft;
}

function normalizeBeatTrace(
  value: unknown,
  requiredBeats: string[],
  scriptText: string,
) {
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
          excerpt: strengthenBeatExcerpt(ordinalBeat, ordinalBeat, scriptText),
          confidence:
            typeof record.confidence === "number"
              ? record.confidence
              : 0.7,
        };
      }
      const beat = canonicalizeBeatLabel(
        beatLabel,
        excerpt,
        unmatchedRequiredBeats,
      );
      return {
        beat,
        excerpt: strengthenBeatExcerpt(beat, excerpt, scriptText),
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
        excerpt: strengthenBeatExcerpt(ordinalBeat, ordinalBeat, scriptText),
        confidence: 0.7,
      };
    }
    const beat = canonicalizeBeatLabel(excerpt, excerpt, unmatchedRequiredBeats);
    return {
      beat,
      excerpt: strengthenBeatExcerpt(beat, excerpt, scriptText),
      confidence: 0.7,
    };
  });
}

function strengthenBeatExcerpt(
  beat: string,
  excerpt: string,
  scriptText: string,
) {
  const trimmedExcerpt = excerpt.trim();
  if (trimmedExcerpt.length >= 8) {
    return trimmedExcerpt;
  }

  return findSentenceContainingBeat(scriptText, beat) ?? trimmedExcerpt;
}

function findSentenceContainingBeat(scriptText: string, beat: string) {
  const trimmedBeat = beat.trim();
  if (!trimmedBeat) {
    return null;
  }

  const sentences = scriptText
    .split(/(?<=[。！？!?；;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return (
    sentences.find(
      (sentence) => sentence.includes(trimmedBeat) && sentence.length >= 8,
    ) ?? null
  );
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
  const provider = env.llm.provider === "stub"
    ? createStubScriptWriterProvider()
    : createValidatedScriptWriterProvider();

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createValidatedScriptWriterProvider(): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createOpenAiCompatibleProvider({
    profile: "main",
  });
}

function createStubScriptWriterProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      const promptInput = request.input as
        | ScriptInputBundleInput
        | { bundle: ScriptInputBundleInput };
      const bundle = "bundle" in promptInput ? promptInput.bundle : promptInput;
      const draft = buildDeterministicDraft(bundle) as T;

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
  const canonicalQuotes = bundle.topic_package.canonical_quotes ?? [];
  const quote = canonicalQuotes[0];
  const openingSpan =
    bundle.soft_lane.strong_scene.trim() ||
    bundle.hard_lane.core_conflict?.trim() ||
    bundle.packaging_lane.hook_claim;
  const endingSpan = bundle.soft_lane.narrative_tension_map.ending_residue;
  const coreConflict = bundle.hard_lane.core_conflict?.trim();
  const stakes = bundle.hard_lane.stakes?.trim() || bundle.topic_package.stakes?.trim();
  const beatSentences = beats.map((beat, index) => {
    const pressurePrefix =
      index === 0 ? "第一层压力落下来时" : `第${index + 1}层压力再压上来时`;
    return `${pressurePrefix}，${beat}不只是被提到，而是把局面逼到更难退的一步，当事人必须当场接住。`;
  });

  const lines = [
    openingSpan,
    coreConflict
      ? `${bundle.hard_lane.event_identity}这件事的核心冲突很直接：${coreConflict}`
      : `${bundle.hard_lane.event_identity}这件事里，压力先落到人身上，再落到场面上。`,
    stakes
      ? `当事人不能随便低头，因为${stakes}`
      : "当事人不能随便低头，因为一退就会让后面的压力继续压上来。",
    bundle.soft_lane.narrative_tension_map.pressure_escalation,
    ...beatSentences,
    bundle.soft_lane.narrative_tension_map.mid_reveal,
    bundle.soft_lane.narrative_tension_map.peak_payoff,
  ];

  if (quote) {
    lines.push(`如果要用原文锚点，就落在这句：“${quote}”。这不是装饰，而是高潮兑现的抓手。`);
  }

  lines.push(endingSpan);

  const scriptText = lines.join("\n");
  const quoteTrace = canonicalQuotes
    .filter((canonicalQuote) => scriptText.includes(canonicalQuote))
    .map((canonicalQuote) => ({
      quote: canonicalQuote,
      usage_type: "exact" as const,
      excerpt: `“${canonicalQuote}”`,
    }));

  return {
    script_text: scriptText,
    estimated_duration_sec: 88,
    beat_trace: beats.map((beat, index) => ({
      beat,
      excerpt: beatSentences[index],
      confidence: 0.92,
    })),
    quote_trace: quoteTrace,
    opening_span: openingSpan,
    ending_span: endingSpan,
  };
}
