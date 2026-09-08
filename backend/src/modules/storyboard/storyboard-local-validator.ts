import type {
  ScriptDraftPackage,
  StoryboardPlan,
  StoryboardValidationResult,
} from "../../../../shared/src/index.js";
import { validateStoryboardTiming, type StoryboardTimingContext } from "./storyboard-timing-projector.js";
import { StoryboardValidationResult as StoryboardValidationResultSchema } from "../../../../shared/src/index.js";
import {
  isTextEquivalentWithDrift,
  locateSubstringFuzzy,
  normalizeTextForMatching,
} from "../../runtime/llm/text-match.js";

interface LocatedExcerpt {
  start: number;
  end: number;
}

/**
 * trace 列表的轻量包装，用于按"标点风格归一化后等价"的方式查找。
 *
 * 只保留 rawValues 数组（按原始顺序）。lookupTrace 用 isTextEquivalentWithDrift
 * 逐项比较，找到第一个等价项即返回。
 *
 * 设计上 trace 列表通常 < 10 项，O(n) 遍历足够；不需要构造 normalizedKey → rawValue
 * 的 Map（之前实现里有，但实际从未被读，是死代码）。
 *
 * 反向覆盖检查（"trace 里每个 beat 都被 linked 引用"）走 buildLinkedNormalizedSet
 * 构造归一化 key 集合，避免对每个 trace 项做 O(n) 比较。
 */
interface TraceLookup {
  rawValues: string[];
}

function buildTraceLookup(rawValues: string[]): TraceLookup {
  return { rawValues };
}

function getTraceLookups(draft: ScriptDraftPackage) {
  return {
    beats: buildTraceLookup(draft.beat_trace.map((trace) => trace.beat)),
    quotes: buildTraceLookup(draft.quote_trace.map((trace) => trace.quote)),
  };
}

/**
 * 在 trace lookup 中查找 query 对应的 raw value。
 * 返回 { found, drifted }：
 *   - 严格匹配（raw === query）→ drifted=false
 *   - 归一化匹配 → drifted=true
 *   - 未匹配 → found=false
 */
function lookupTrace(
  lookup: TraceLookup,
  query: string,
): { found: boolean; drifted: boolean } {
  for (const raw of lookup.rawValues) {
    const cmp = isTextEquivalentWithDrift(raw, query);
    if (cmp.equivalent) {
      return { found: true, drifted: cmp.drifted };
    }
  }
  return { found: false, drifted: false };
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

// 用于反向覆盖检查：构造 linked 集合的 normalized key 集合。
function buildLinkedNormalizedSet(values: string[]): Set<string> {
  const set = new Set<string>();
  for (const v of values) {
    set.add(normalizeTextForMatching(v));
  }
  return set;
}

export function validateStoryboardPlan(input: {
  draft: ScriptDraftPackage;
  plan: StoryboardPlan;
  narrationTiming?: StoryboardTimingContext;
}): StoryboardValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { draft, plan } = input;
  const scriptText = draft.script_text;
  const locatedExcerpts: LocatedExcerpt[] = [];
  const traceSets = getTraceLookups(draft);
  if (plan.plan_version === "storyboard_v2") {
    try {
      if (!input.narrationTiming) throw new Error("missing_narration_timing");
      const verified = validateStoryboardTiming(plan, input.narrationTiming);
      const sourceText = (input.narrationTiming.timingMap as { sourceText: string }).sourceText;
      if (sourceText !== scriptText || verified.segments.at(-1)!.source_end !== scriptText.length) throw new Error("source_text_mismatch");
      locatedExcerpts.push(...verified.segments.map(s => ({ start: s.source_start, end: s.source_end })));
    } catch { pushUnique(errors, "storyboard_narration_timing_invalid"); }
  }

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
      // 归一化等价比较：storyboard LLM 输出的 linked_beats 与 script LLM 输出的
      // beat_trace 是两次独立调用，标点风格漂移很常见，严格 Set.has 会假阴性。
      const found = lookupTrace(traceSets.beats, beat);
      if (!found.found) {
        pushUnique(errors, "storyboard_trace_ref_invalid");
      } else if (found.drifted) {
        pushUnique(warnings, `storyboard_trace_ref_drift:${beat}`);
      }
    }

    for (const quote of segment.linked_quotes) {
      const found = lookupTrace(traceSets.quotes, quote);
      if (!found.found) {
        pushUnique(errors, "storyboard_trace_ref_invalid");
      } else if (found.drifted) {
        pushUnique(warnings, `storyboard_trace_ref_drift:${quote}`);
      }
    }

    if (plan.plan_version === "storyboard_v2") return;
    const strictStart = scriptText.indexOf(segment.script_excerpt);
    let start = strictStart;
    // end 默认按 needle 长度算（strict 命中场景）。
    // drift 命中时改用归一化映射回的真实 end（haystack 与 needle 在删除型字符上
    // 长度可能不同），否则 coverage / segment 顺序检查会偏。
    let end = strictStart + segment.script_excerpt.length;
    let drift = false;
    if (start === -1) {
      // 严格 indexOf 失败，尝试标点归一化软匹配。
      // LLM 在 script 与 excerpt 间常出现全/半角标点或引号边界漂移。
      const located = locateSubstringFuzzy(scriptText, segment.script_excerpt);
      if (located.index !== -1) {
        start = located.index;
        end = located.end;
        drift = located.drifted;
      } else {
        pushUnique(errors, "storyboard_excerpt_not_in_script");
        return;
      }
    }

    locatedExcerpts.push({ start, end });

    if (drift) {
      pushUnique(warnings, `storyboard_excerpt_drift:${segment.segment_id}`);
    }
  });

  const hasMissingExcerpt = errors.includes("storyboard_excerpt_not_in_script");
  if (plan.plan_version === "storyboard_v1" && !hasMissingExcerpt) {
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

  // 反向覆盖检查：trace 里的每个 beat/quote 都应被 linked 引用覆盖。
  // 同样走归一化等价：若 linked 用了标点漂移后的名字，仍算覆盖。
  const linkedBeatKeys = buildLinkedNormalizedSet(
    plan.segments.flatMap((segment) => segment.linked_beats),
  );
  const linkedQuoteKeys = buildLinkedNormalizedSet(
    plan.segments.flatMap((segment) => segment.linked_quotes),
  );

  for (const beat of traceSets.beats.rawValues) {
    if (!linkedBeatKeys.has(normalizeTextForMatching(beat))) {
      pushUnique(errors, "storyboard_trace_coverage_missing");
    }
  }

  for (const quote of traceSets.quotes.rawValues) {
    if (!linkedQuoteKeys.has(normalizeTextForMatching(quote))) {
      pushUnique(errors, "storyboard_trace_coverage_missing");
    }
  }

  const totalDurationHintSec = plan.segments.reduce(
    (sum, segment) => sum + (segment.end_hint_sec - segment.start_hint_sec),
    0,
  );
  const durationDeviation =
    plan.plan_version === "storyboard_v1" && draft.estimated_duration_sec > 0
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
