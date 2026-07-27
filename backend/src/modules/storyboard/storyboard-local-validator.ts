import type {
  ScriptDraftPackage,
  StoryboardPlan,
  StoryboardValidationResult,
} from "../../../../shared/src/index.js";
import { StoryboardValidationResult as StoryboardValidationResultSchema } from "../../../../shared/src/index.js";

interface LocatedExcerpt {
  start: number;
  end: number;
}

// LLM 在 script_text 与 excerpt 之间常出现标点风格漂移：
//   - 半角逗号 , (U+002C) ↔ 全角逗号 ，(U+FF0C)
//   - 半角句号 . (U+002E) ↔ 全角句号 。(U+3002)
//   - 半角冒号 : ↔ 全角冒号 ：(U+FF1A)
//   - 半角分号 ; ↔ 全角分号 ；(U+FF1B)
//   - 半角问号 ? ↔ 全角问号 ？(U+FF1F)
//   - 半角感叹号 ! ↔ 全角感叹号 ！(U+FF01)
//   - ASCII 空格、引号边界符
// indexOf 严格匹配会因单一字符不一致直接判 not_in_script，导致 regen 浪费且无法修复。
// 这里把两侧都归一化后做软匹配，定位真实起始位置；命中后位置仍以 script_text 的实际位置为准，
// 不影响后续 coverage / segment 顺序计算。
const NORMALIZE_PUNCT_MAP: Record<string, string> = {
  ",": "，",
  ".": "。",
  ":": "：",
  ";": "；",
  "?": "？",
  "!": "！",
  "“": "",
  "”": "",
  '"': "",
  "‘": "",
  "’": "",
  "'": "",
  "「": "",
  "」": "",
  "『": "",
  "』": "",
  " ": "",
  "\u00A0": "",
  "\u3000": "",
};

function normalizePunctuation(value: string) {
  let out = "";
  for (const ch of value) {
    out += NORMALIZE_PUNCT_MAP[ch] ?? ch;
  }
  return out;
}

// 判断字符在归一化后是否被删除（保留 vs 删除）。替换型映射（如 , → ，）仍占一个字符位置。
function isDroppedByNormalize(ch: string) {
  return (NORMALIZE_PUNCT_MAP[ch] ?? ch) === "";
}

// 在归一化等价的前提下，找到 excerpt 在 scriptText 中的真实起始字符位置。
// 返回 -1 表示即使归一化后也无法匹配。
function locateExcerptInScript(scriptText: string, excerpt: string): number {
  const direct = scriptText.indexOf(excerpt);
  if (direct !== -1) return direct;

  const normalizedScript = normalizePunctuation(scriptText);
  const normalizedExcerpt = normalizePunctuation(excerpt).trim();
  if (normalizedExcerpt.length === 0) return -1;

  const normalizedStart = normalizedScript.indexOf(normalizedExcerpt);
  if (normalizedStart === -1) return -1;

  // normalizedScript 中前 normalizedStart 个字符对应 scriptText 中第几个"保留字符"。
  // 替换型映射（, → ，）仍计入；删除型映射（引号、空格）跳过。
  let normalizedIndex = 0;
  for (let i = 0; i < scriptText.length; i++) {
    if (normalizedIndex === normalizedStart) {
      return i;
    }
    if (!isDroppedByNormalize(scriptText[i])) {
      normalizedIndex += 1;
    }
  }
  if (normalizedIndex === normalizedStart) {
    return scriptText.length;
  }
  return -1;
}

function pushUnique(target: string[], code: string) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function sumCoveredChars(spans: LocatedExcerpt[]) {
  if (spans.length === 0) {
    return 0;
  }

  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let covered = 0;
  let current = sorted[0];

  for (const span of sorted.slice(1)) {
    if (span.start <= current.end) {
      current = {
        start: current.start,
        end: Math.max(current.end, span.end),
      };
      continue;
    }

    covered += current.end - current.start;
    current = span;
  }

  covered += current.end - current.start;
  return covered;
}

function hasBlankVisualDescription(segment: StoryboardPlan["segments"][number]) {
  return (
    segment.visual_intent.trim().length === 0 ||
    segment.scene_description.trim().length === 0
  );
}

function getTraceSets(draft: ScriptDraftPackage) {
  return {
    beats: new Set(draft.beat_trace.map((trace) => trace.beat)),
    quotes: new Set(draft.quote_trace.map((trace) => trace.quote)),
  };
}

export function validateStoryboardPlan(input: {
  draft: ScriptDraftPackage;
  plan: StoryboardPlan;
}): StoryboardValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { draft, plan } = input;
  const scriptText = draft.script_text;
  const locatedExcerpts: LocatedExcerpt[] = [];
  const traceSets = getTraceSets(draft);

  plan.segments.forEach((segment, index) => {
    if (segment.order !== index) {
      pushUnique(errors, "storyboard_segment_order_invalid");
    }

    const previous = plan.segments[index - 1];
    if (segment.end_hint_sec <= segment.start_hint_sec) {
      // 真正的时间倒序（end ≤ start）才是严重错误
      pushUnique(errors, "storyboard_timing_invalid");
    } else if (previous && segment.start_hint_sec < previous.end_hint_sec) {
      // 时间重叠（起点 < 上一个终点）：LLM 容易出错，降级为 warning
      // 后续编辑器会按 segment 顺序排列，重叠不影响最终视频
      pushUnique(warnings, `storyboard_segment_overlap:${segment.segment_id}`);
    }

    if (hasBlankVisualDescription(segment)) {
      pushUnique(errors, "storyboard_empty_visual_description");
    }

    for (const beat of segment.linked_beats) {
      if (!traceSets.beats.has(beat)) {
        pushUnique(errors, "storyboard_trace_ref_invalid");
      }
    }

    for (const quote of segment.linked_quotes) {
      if (!traceSets.quotes.has(quote)) {
        pushUnique(errors, "storyboard_trace_ref_invalid");
      }
    }

    const strictStart = scriptText.indexOf(segment.script_excerpt);
    let start = strictStart;
    let drift = false;
    if (start === -1) {
      // 严格 indexOf 失败，尝试标点归一化软匹配。
      // LLM 在 script 与 excerpt 间常出现全/半角标点或引号边界漂移。
      const normalizedStart = locateExcerptInScript(scriptText, segment.script_excerpt);
      if (normalizedStart !== -1) {
        start = normalizedStart;
        drift = true;
      } else {
        pushUnique(errors, "storyboard_excerpt_not_in_script");
        return;
      }
    }

    const end = start + segment.script_excerpt.length;
    locatedExcerpts.push({ start, end });

    if (drift) {
      pushUnique(warnings, `storyboard_excerpt_drift:${segment.segment_id}`);
    }
  });

  const hasMissingExcerpt = errors.includes("storyboard_excerpt_not_in_script");
  if (!hasMissingExcerpt) {
    for (let index = 1; index < locatedExcerpts.length; index += 1) {
      const previous = locatedExcerpts[index - 1];
      const current = locatedExcerpts[index];
      if (current.start < previous.end) {
        pushUnique(errors, "storyboard_excerpt_order_invalid");
      }
    }

    const coveredCharCount = sumCoveredChars(locatedExcerpts);
    const coverageRatio =
      scriptText.length > 0 ? coveredCharCount / scriptText.length : 0;
    const firstExcerptStartIndex = locatedExcerpts.at(0)?.start ?? null;
    const lastExcerptEndDistance =
      locatedExcerpts.length > 0
        ? scriptText.length - (locatedExcerpts.at(-1)?.end ?? 0)
        : null;

    if (coverageRatio < 0.82) {
      pushUnique(errors, "storyboard_script_coverage_too_low");
    }

    if (typeof firstExcerptStartIndex === "number" && firstExcerptStartIndex > 20) {
      pushUnique(errors, "storyboard_opening_not_covered");
    }

    if (typeof lastExcerptEndDistance === "number" && lastExcerptEndDistance > 40) {
      pushUnique(errors, "storyboard_ending_not_covered");
    }
  }

  const linkedBeats = new Set(plan.segments.flatMap((segment) => segment.linked_beats));
  const linkedQuotes = new Set(plan.segments.flatMap((segment) => segment.linked_quotes));

  for (const beat of traceSets.beats) {
    if (!linkedBeats.has(beat)) {
      pushUnique(errors, "storyboard_trace_coverage_missing");
    }
  }

  for (const quote of traceSets.quotes) {
    if (!linkedQuotes.has(quote)) {
      pushUnique(errors, "storyboard_trace_coverage_missing");
    }
  }

  const totalDurationHintSec = plan.segments.reduce(
    (sum, segment) => sum + (segment.end_hint_sec - segment.start_hint_sec),
    0,
  );
  const durationDeviation =
    draft.estimated_duration_sec > 0
      ? Math.abs(totalDurationHintSec - draft.estimated_duration_sec) /
        draft.estimated_duration_sec
      : 0;

  if (plan.segments.length > 14) {
    warnings.push("storyboard_segment_count_high");
  }
  if (durationDeviation > 0.4) {
    warnings.push("storyboard_duration_hint_drift");
  }
  if (durationDeviation > 0.6) {
    // 总时长偏差超 60% 才视为严重错误（LLM 切 segment 时不易精确控制总时长）
    pushUnique(errors, "storyboard_timing_invalid");
  }

  const coveredCharCount = hasMissingExcerpt ? 0 : sumCoveredChars(locatedExcerpts);
  const metrics = {
    segment_count: plan.segments.length,
    coverage_ratio:
      !hasMissingExcerpt && scriptText.length > 0
        ? coveredCharCount / scriptText.length
        : null,
    covered_char_count: coveredCharCount,
    script_char_count: scriptText.length,
    total_duration_hint_sec: totalDurationHintSec,
    estimated_total_duration_sec: plan.estimated_total_duration_sec,
    first_excerpt_start_index: hasMissingExcerpt
      ? null
      : (locatedExcerpts.at(0)?.start ?? null),
    last_excerpt_end_distance: hasMissingExcerpt
      ? null
      : locatedExcerpts.length > 0
        ? scriptText.length - (locatedExcerpts.at(-1)?.end ?? 0)
        : null,
  };

  return StoryboardValidationResultSchema.parse({
    stage: "storyboard_local_validation",
    decision: errors.length > 0 ? "regen_once" : "pass",
    errors,
    warnings,
    metrics,
  });
}
