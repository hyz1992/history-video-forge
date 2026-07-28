import type {
  ScriptDraftPackage,
  StoryboardPlan,
  StoryboardValidationResult,
} from "../../../../shared/src/index.js";
import { StoryboardValidationResult as StoryboardValidationResultSchema } from "../../../../shared/src/index.js";
import { locateSubstringFuzzy } from "../../runtime/llm/text-match.js";

interface LocatedExcerpt {
  start: number;
  end: number;
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
      const located = locateSubstringFuzzy(scriptText, segment.script_excerpt);
      if (located.index !== -1) {
        start = located.index;
        drift = located.drifted;
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
