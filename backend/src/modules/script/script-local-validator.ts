import { ScriptLocalValidationResult } from "../../../../shared/src/index";
import {
  isTextEquivalentWithDrift,
  locateSubstringFuzzy,
} from "../../runtime/llm/text-match.js";

interface ScriptInputBundleInput {
  hard_lane?: {
    must_include_beats?: string[];
    forbidden_expansions?: string[];
    duration_band?: string;
  };
  topic_package?: {
    canonical_quotes?: string[];
  };
}

interface ScriptDraftInput {
  script_text?: unknown;
  estimated_duration_sec?: unknown;
  beat_trace?: unknown;
  quote_trace?: unknown;
  opening_span?: unknown;
  ending_span?: unknown;
}

export interface ValidateScriptDraftInput {
  bundle: ScriptInputBundleInput;
  draft: ScriptDraftInput;
}

function getDurationRange(durationBand: unknown) {
  if (durationBand === "medium") {
    return { min: 75, max: 95 };
  }

  if (durationBand === "short") {
    return { min: 45, max: 70 };
  }

  return { min: 90, max: 140 };
}

function getDurationDeltaRatio(
  estimatedDurationSec: number,
  durationRange: { min: number; max: number },
) {
  if (estimatedDurationSec < durationRange.min) {
    return (durationRange.min - estimatedDurationSec) / durationRange.min;
  }

  if (estimatedDurationSec > durationRange.max) {
    return (estimatedDurationSec - durationRange.max) / durationRange.max;
  }

  return 0;
}

function pushUnique(target: string[], code: string) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function getBodyFloor(durationBand: string) {
  if (durationBand === "short") {
    return { minScriptChars: 180, minSentenceCount: 6 };
  }

  if (durationBand === "medium") {
    return { minScriptChars: 320, minSentenceCount: 8 };
  }

  return { minScriptChars: 420, minSentenceCount: 10 };
}

function countScriptSentences(scriptText: string) {
  return scriptText
    .split(/(?<=[。！？!?；;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function getMinimumCharsForEstimatedDuration(estimatedDurationSec: number) {
  return Math.ceil(estimatedDurationSec * 3.6);
}

function getCharsPerEstimatedSecond(
  scriptCharCount: number,
  estimatedDurationSec: number,
) {
  if (estimatedDurationSec <= 0) {
    return null;
  }

  return Math.round((scriptCharCount / estimatedDurationSec) * 100) / 100;
}

// 用 text-match 的归一化软匹配统一全/半角标点、引号边界、空格漂移。
// 之前这里只 strip 引号，没处理全/半角逗号/句号/问号等，导致 LLM 在 beat excerpt
// 与 script_text 间漂移标点时仍触发 beat_trace_excerpt_drift warning。
// 改用 locateSubstringFuzzy 后行为与 storyboard / asset-planning 一致。
function scriptContainsTraceExcerpt(scriptText: string, excerpt: string) {
  return locateSubstringFuzzy(scriptText, excerpt).index !== -1;
}

export function validateScriptDraft(input: ValidateScriptDraftInput) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (
    !input.bundle ||
    !input.bundle.hard_lane ||
    !Array.isArray(input.bundle.hard_lane.must_include_beats) ||
    !Array.isArray(input.bundle.hard_lane.forbidden_expansions) ||
    typeof input.bundle.hard_lane.duration_band !== "string"
  ) {
    return ScriptLocalValidationResult.parse({
      stage: "script_local_validation",
      decision: "hard_fail",
      errors: ["bundle_missing_field"],
      warnings: [],
      metrics: {},
    });
  }

  const draft = input.draft ?? {};
  const hasRequiredShape =
    "script_text" in draft &&
    "estimated_duration_sec" in draft &&
    "beat_trace" in draft &&
    "quote_trace" in draft &&
    "opening_span" in draft &&
    "ending_span" in draft;

  if (!hasRequiredShape) {
    return ScriptLocalValidationResult.parse({
      stage: "script_local_validation",
      decision: "hard_fail",
      errors: ["draft_missing_field"],
      warnings: [],
      metrics: {},
    });
  }

  if (
    typeof draft.script_text !== "string" ||
    typeof draft.estimated_duration_sec !== "number" ||
    !Array.isArray(draft.beat_trace) ||
    !Array.isArray(draft.quote_trace) ||
    typeof draft.opening_span !== "string" ||
    typeof draft.ending_span !== "string"
  ) {
    return ScriptLocalValidationResult.parse({
      stage: "script_local_validation",
      decision: "hard_fail",
      errors: ["draft_missing_field"],
      warnings: [],
      metrics: {},
    });
  }

  if (draft.script_text.trim().length < 20) {
    pushUnique(errors, "script_empty_or_short");
  }

  const bodyFloor = getBodyFloor(input.bundle.hard_lane.duration_band);
  const scriptCharCount = draft.script_text.trim().length;
  const scriptSentenceCount = countScriptSentences(draft.script_text);
  const minScriptCharsForEstimatedDuration =
    getMinimumCharsForEstimatedDuration(draft.estimated_duration_sec);
  const charsPerEstimatedSecond = getCharsPerEstimatedSecond(
    scriptCharCount,
    draft.estimated_duration_sec,
  );
  if (
    scriptCharCount < bodyFloor.minScriptChars ||
    scriptSentenceCount < bodyFloor.minSentenceCount
  ) {
    pushUnique(errors, "script_body_too_thin");
  }
  if (
    draft.estimated_duration_sec > 0 &&
    scriptCharCount < minScriptCharsForEstimatedDuration
  ) {
    pushUnique(errors, "duration_body_mismatch");
  }

  if (draft.opening_span.trim().length === 0) {
    pushUnique(errors, "opening_missing");
  }

  if (draft.ending_span.trim().length === 0) {
    pushUnique(errors, "ending_missing");
  }

  for (const forbidden of input.bundle.hard_lane.forbidden_expansions) {
    if (
      typeof forbidden === "string" &&
      forbidden.length > 0 &&
      draft.script_text.includes(forbidden)
    ) {
      pushUnique(errors, "forbidden_expansion_hit");
    }
  }

  const durationRange = getDurationRange(input.bundle.hard_lane.duration_band);
  const durationDeviation = getDurationDeltaRatio(
    draft.estimated_duration_sec,
    durationRange,
  );

  if (durationDeviation > 0.35) {
    pushUnique(errors, "duration_extreme");
  } else if (durationDeviation > 0.15) {
    pushUnique(errors, "duration_severe");
  } else if (durationDeviation > 0) {
    pushUnique(warnings, "duration_mild_drift");
  }

  const beatTrace = draft.beat_trace as Array<Record<string, unknown>>;
  for (const requiredBeat of input.bundle.hard_lane.must_include_beats) {
    // 用归一化等价比较：LLM 在 topic package 与 script 两次独立调用间
    // 经常漂移 beat 名字的全/半角标点、引号边界。严格 === 比较会假阴性
    // 导致 beat_missing → regen，但 regen 仍可能漂移，链路卡死。
    let matched: Record<string, unknown> | undefined;
    let beatNameDrifted = false;
    for (const trace of beatTrace) {
      const traceBeat = trace.beat;
      if (typeof traceBeat !== "string") continue;
      const cmp = isTextEquivalentWithDrift(traceBeat, requiredBeat);
      if (cmp.equivalent) {
        matched = trace;
        beatNameDrifted = cmp.drifted;
        break;
      }
    }
    if (!matched) {
      pushUnique(errors, "beat_missing");
      continue;
    }

    if (beatNameDrifted) {
      pushUnique(warnings, `beat_name_drift:${requiredBeat}`);
    }

    if (typeof matched.excerpt !== "string" || matched.excerpt.trim().length < 14) {
      pushUnique(errors, "beat_trace_weak");
      continue;
    }

    if (!scriptContainsTraceExcerpt(draft.script_text, matched.excerpt)) {
      // LLM 写 script 时会对 beat excerpt 做字符级改写（标点、断句、修饰），
      // 导致严格 includes 失败。这是 LLM 固有不精确性，regen 也未必能修复。
      // 降级为 warning，不再强制 regen。
      pushUnique(warnings, `beat_trace_excerpt_drift:${requiredBeat}`);
    }
  }

  const quoteTrace = draft.quote_trace as Array<Record<string, unknown>>;
  for (const quote of input.bundle.topic_package?.canonical_quotes ?? []) {
    if (typeof quote === "string" && draft.script_text.includes(quote)) {
      // 同 beat，用归一化等价比较 quote 名字。
      let matched: Record<string, unknown> | undefined;
      let quoteNameDrifted = false;
      for (const trace of quoteTrace) {
        const traceQuote = trace.quote;
        if (typeof traceQuote !== "string") continue;
        const cmp = isTextEquivalentWithDrift(traceQuote, quote);
        if (cmp.equivalent) {
          matched = trace;
          quoteNameDrifted = cmp.drifted;
          break;
        }
      }
      if (quoteNameDrifted) {
        pushUnique(warnings, `quote_name_drift:${quote}`);
      }
      if (
        !matched ||
        (matched.usage_type !== "exact" && matched.usage_type !== "paraphrase") ||
        typeof matched.excerpt !== "string" ||
        matched.excerpt.trim().length === 0
      ) {
        pushUnique(errors, "quote_trace_incomplete");
      }
    }
  }

  if (/TODO|待补充|placeholder|XXX/u.test(draft.script_text)) {
    pushUnique(errors, "placeholder_found");
  }

  const decision = errors.some((code) =>
    ["bundle_missing_field", "draft_missing_field", "duration_extreme", "forbidden_expansion_hit"].includes(code),
  )
    ? "hard_fail"
    : errors.length > 0
      ? "regen_once"
      : "pass";

  return ScriptLocalValidationResult.parse({
    stage: "script_local_validation",
    decision,
    errors,
    warnings,
    metrics: {
      estimated_duration_sec: draft.estimated_duration_sec,
      script_char_count: scriptCharCount,
      script_sentence_count: scriptSentenceCount,
      min_script_chars_for_band: bodyFloor.minScriptChars,
      min_sentence_count_for_band: bodyFloor.minSentenceCount,
      min_script_chars_for_estimated_duration: minScriptCharsForEstimatedDuration,
      chars_per_estimated_second: charsPerEstimatedSecond,
      beat_trace_count: beatTrace.length,
      quote_trace_count: quoteTrace.length,
    },
  });
}
