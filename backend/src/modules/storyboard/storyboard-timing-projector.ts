import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringify, NarrationTimingMapV1, NarrationReference, StoryboardSegment,
  StoryboardPlanV2 } from "../../../../shared/src/index.js";

const integer = z.number().int().safe().nonnegative();
const id = z.string().min(1);
const SegmentInput = StoryboardSegment.innerType().omit({ script_excerpt: true, start_hint_sec: true, end_hint_sec: true }).extend({
  start_boundary_id: id, end_boundary_id: id,
  script_excerpt: z.string().optional(), start_hint_sec: z.number().optional(), end_hint_sec: z.number().optional(),
  source_start: integer.optional(), source_end: integer.optional(),
  visual_start_ms: integer.optional(), visual_end_ms: integer.optional(),
}).strict();
const PlanInput = z.object({
  plan_version: z.literal("storyboard_v2"), source_script_record_id: id, source_topic_package_id: id,
  segments: z.array(SegmentInput).min(1), global_visual_notes: z.array(z.string().min(1)),
  narration_reference: NarrationReference.optional(), estimated_total_duration_sec: z.number().optional(),
}).strict();
export interface StoryboardTimingContext { timingMap: unknown; narrationReference: unknown; }
function source(context: StoryboardTimingContext) {
  const timingMap = NarrationTimingMapV1.parse(context.timingMap);
  const reference = NarrationReference.parse(context.narrationReference);
  const timingHash = createHash("sha256").update(canonicalStringify(timingMap)).digest("hex");
  if (reference.audio_hash !== timingMap.audioHash || reference.timing_map_hash !== timingHash ||
    reference.duration_ms !== timingMap.durationMs) throw new Error("storyboard_narration_source_mismatch");
  return { timingMap, reference };
}
/** 唯一投影：合法边界同时决定UTF-16正文切片和视觉毫秒；不重排、不缩放原生时间。 */
export function projectStoryboardTiming(input: StoryboardTimingContext & { plan: unknown }): StoryboardPlanV2 {
  const { timingMap, reference } = source(input);
  const plan = PlanInput.parse(input.plan);
  if (plan.narration_reference && canonicalStringify(plan.narration_reference) !== canonicalStringify(reference))
    throw new Error("storyboard_narration_source_mismatch");
  if (plan.estimated_total_duration_sec !== undefined && plan.estimated_total_duration_sec !== timingMap.durationMs / 1000)
    throw new Error("storyboard_narration_duration_mismatch");
  const boundaries = new Map(timingMap.boundaries.map(b => [b.id, b]));
  let nextBoundary = timingMap.boundaries[0]!.id;
  const segments = plan.segments.map((segment, index) => {
    const start = boundaries.get(segment.start_boundary_id), end = boundaries.get(segment.end_boundary_id);
    if (!start || !end || start.id !== nextBoundary || end.visualTimeMs <= start.visualTimeMs || segment.order !== index)
      throw new Error("storyboard_narration_boundary_invalid");
    const derived = { source_start: start.sourceOffset, source_end: end.sourceOffset,
      visual_start_ms: start.visualTimeMs, visual_end_ms: end.visualTimeMs,
      start_hint_sec: start.visualTimeMs / 1000, end_hint_sec: end.visualTimeMs / 1000,
      script_excerpt: timingMap.sourceText.slice(start.sourceOffset, end.sourceOffset) };
    for (const key of Object.keys(derived) as Array<keyof typeof derived>)
      if (segment[key] !== undefined && segment[key] !== derived[key]) throw new Error("storyboard_narration_range_mismatch");
    nextBoundary = end.id;
    return { ...segment, ...derived };
  });
  if (nextBoundary !== timingMap.boundaries.at(-1)!.id) throw new Error("storyboard_narration_coverage_invalid");
  return StoryboardPlanV2.parse({ ...plan, narration_reference: reference,
    estimated_total_duration_sec: timingMap.durationMs / 1000, segments });
}
/** 持久化对象先校验正式完整合同，再逐段复核同一来源边界。 */
export function validateStoryboardTiming(plan: unknown, context: StoryboardTimingContext): StoryboardPlanV2 {
  const parsed = StoryboardPlanV2.parse(plan);
  return projectStoryboardTiming({ ...context, plan: parsed });
}
