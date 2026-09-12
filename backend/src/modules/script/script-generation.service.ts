import { ScriptDraftPackage, type ResolvedCapabilityMap } from "../../../../shared/src/index.js";
import { createHash } from "node:crypto";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { parseLlmOutput } from "../../runtime/llm/llm-output-error.js";
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
  /**
   * S2-2C（详细设计 §6.1）：付费 dispatch 路径的快照冻结 capabilities
   * （来源 `billingContext.resolved.resolved_capabilities` 只读引用）。
   * 提供时 gateway 按快照模型构造（auto/fixed 一律）；缺省走 env 解析。
   */
  snapshotCapabilities?: ResolvedCapabilityMap;
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

/** 口播语速实测样本：5.33 字/秒（2026-09-05，459 字/86.16s）、4.93 字/秒
 * （2026-09-11，698 字/141.7s）。回填取 5.3，与 script.writer prompt 的语速说明一致；
 * 该值只作"约"级预估，档位与实测时长的一致性由口播确认门禁负责。 */
const NARRATION_CHARS_PER_SECOND = 5.3;

/** 按正文去空白字数与实测语速回填预估口播时长（秒，四舍五入，下限 1）。 */
export function estimateNarrationDurationSec(scriptText: string | null | undefined) {
  if (!scriptText) return 0;
  const chars = scriptText.replace(/\s/gu, "").length;
  if (chars === 0) return 0;
  return Math.max(1, Math.round(chars / NARRATION_CHARS_PER_SECOND));
}

export async function generateScriptDraft(input: GenerateScriptDraftInput) {
  const gateway = input.llmGateway ?? createScriptWriterGateway(input.snapshotCapabilities);
  const rawDraft = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "script.writer",
    input: buildScriptWriterPromptInput(input),
    interactionLogWriter: input.interactionLogWriter,
  });
  const draft = normalizeScriptDraft(
    rawDraft,
    input.bundle.hard_lane.must_include_beats,
  );

  return parseLlmOutput(
    ScriptDraftPackage,
    draft,
    "script_draft_schema_invalid",
  );
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

  // 预估时长不再信任 LLM 输出（曾为凑档位谎报），按正文字数与实测语速本地回填。
  if (typeof draft.script_text === "string") {
    draft.estimated_duration_sec = estimateNarrationDurationSec(draft.script_text);
  }

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

/**
 * 构造 script writer gateway（S2-2C：快照提供且非 stub 时按快照模型构造）。
 * 导出供 S2-2C 接线测试（vi.mock env/工厂断言快照参数透传）。
 */
export function createScriptWriterGateway(snapshotCapabilities?: ResolvedCapabilityMap): LlmGateway {
  const provider = env.llm.provider === "stub"
    ? createStubScriptWriterProvider()
    : createValidatedScriptWriterProvider(snapshotCapabilities);

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createValidatedScriptWriterProvider(snapshotCapabilities?: ResolvedCapabilityMap): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createTierAwareProviderFromEnv(
    snapshotCapabilities ? { snapshotCapabilities } : undefined,
  );
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
        promptSha256: createHash("sha256").update(request.prompt.body.trim()).digest("hex"),
        promptVersion: request.prompt.metadata.version,
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
