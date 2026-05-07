import { ScriptDraftPackage } from "../../../../shared/src/index.js";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
    must_include_beats?: unknown;
  };
}

interface ScriptDraftInput {
  script_text?: unknown;
  beat_trace?: unknown;
  opening_span?: unknown;
  ending_span?: unknown;
}

interface ThinBodyRepairContext {
  issue: "script_body_too_thin";
  previous_script_chars: number;
  previous_sentence_count: number;
  min_script_chars_for_band: number;
  min_sentence_count_for_band: number;
  target_script_chars: number;
  target_sentence_count: number;
  shortfall_chars: number;
  shortfall_sentences: number;
  repair_instruction: string;
  beat_expansion_targets: Array<{
    beat: string;
    previous_excerpt: string;
    expand_with: ["action", "reaction", "consequence"];
  }>;
}

interface PreviousDraftSummary {
  script_text_excerpt: string;
  opening_span: string;
  ending_span: string;
  beat_trace_summary: Array<{
    beat: string;
    excerpt: string;
  }>;
}

interface RegenerationContext {
  reason: "local_validation_regen_once";
  errors: string[];
  metrics: Record<string, unknown>;
  previous_draft?: PreviousDraftSummary;
  thin_body_repair?: ThinBodyRepairContext;
}

export interface RegenerateScriptDraftInput {
  bundle: ScriptInputBundleInput;
  draft?: ScriptDraftInput;
  regenerateUsed: boolean;
  localValidation?: {
    decision?: unknown;
    errors?: unknown[];
    warnings?: unknown[];
    metrics?: Record<string, unknown>;
  };
  generateDraft: (input?: {
    regenerationContext?: RegenerationContext;
  }) => Promise<unknown>;
}

export async function regenerateScriptDraft(
  input: RegenerateScriptDraftInput,
) {
  if (input.regenerateUsed) {
    throw new Error("regen_once opportunity already consumed");
  }

  const errors = (input.localValidation?.errors ?? []).filter(
    (error): error is string => typeof error === "string",
  );
  const metrics = input.localValidation?.metrics ?? {};
  const previousDraft = buildPreviousDraftSummary(input.draft);
  const regenerationContext: RegenerationContext = {
    reason: "local_validation_regen_once",
    errors,
    metrics,
  };
  if (previousDraft) {
    regenerationContext.previous_draft = previousDraft;
  }
  const thinBodyRepair = buildThinBodyRepairContext({
    errors,
    metrics,
    previousDraft,
  });
  if (thinBodyRepair) {
    regenerationContext.thin_body_repair = thinBodyRepair;
  }

  const regenerated = await input.generateDraft({
    regenerationContext,
  });
  return ScriptDraftPackage.parse(regenerated);
}

function buildPreviousDraftSummary(
  draft: ScriptDraftInput | undefined,
): PreviousDraftSummary | undefined {
  if (!draft) {
    return undefined;
  }

  return {
    script_text_excerpt:
      typeof draft.script_text === "string"
        ? draft.script_text.trim().slice(0, 500)
        : "",
    opening_span:
      typeof draft.opening_span === "string" ? draft.opening_span : "",
    ending_span: typeof draft.ending_span === "string" ? draft.ending_span : "",
    beat_trace_summary: Array.isArray(draft.beat_trace)
      ? draft.beat_trace
          .map((trace) => {
            if (!trace || typeof trace !== "object") {
              return null;
            }

            const record = trace as Record<string, unknown>;
            if (
              typeof record.beat !== "string" ||
              typeof record.excerpt !== "string"
            ) {
              return null;
            }

            return {
              beat: record.beat,
              excerpt: record.excerpt,
            };
          })
          .filter(
            (
              trace,
            ): trace is {
              beat: string;
              excerpt: string;
            } => trace !== null,
          )
      : [],
  };
}

function buildThinBodyRepairContext(input: {
  errors: string[];
  metrics: Record<string, unknown>;
  previousDraft: PreviousDraftSummary | undefined;
}): ThinBodyRepairContext | undefined {
  if (!input.errors.includes("script_body_too_thin")) {
    return undefined;
  }

  const previousScriptChars = readMetricNumber(input.metrics.script_char_count);
  const previousSentenceCount = readMetricNumber(
    input.metrics.script_sentence_count,
  );
  const minScriptChars = readMetricNumber(
    input.metrics.min_script_chars_for_band,
  );
  const minSentenceCount = readMetricNumber(
    input.metrics.min_sentence_count_for_band,
  );

  if (
    previousScriptChars === null ||
    previousSentenceCount === null ||
    minScriptChars === null ||
    minSentenceCount === null
  ) {
    return undefined;
  }

  return {
    issue: "script_body_too_thin",
    previous_script_chars: previousScriptChars,
    previous_sentence_count: previousSentenceCount,
    min_script_chars_for_band: minScriptChars,
    min_sentence_count_for_band: minSentenceCount,
    target_script_chars: minScriptChars + 40,
    target_sentence_count: minSentenceCount + 1,
    shortfall_chars: Math.max(0, minScriptChars - previousScriptChars),
    shortfall_sentences: Math.max(0, minSentenceCount - previousSentenceCount),
    repair_instruction:
      "正文仍是压缩摘要体。请只围绕既有 must_include_beats 扩写场面动作、对方反应和压力后果，明显越过结构下限；不得用解释、评价或口号凑字数，不得新增人物、事件、结局或改写因果。",
    beat_expansion_targets:
      input.previousDraft?.beat_trace_summary.map((trace) => ({
        beat: trace.beat,
        previous_excerpt: trace.excerpt,
        expand_with: ["action", "reaction", "consequence"],
      })) ?? [],
  };
}

function readMetricNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
