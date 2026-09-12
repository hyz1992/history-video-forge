import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringify, NarrationBoundary, NarrationTimingMapV1, NarrationReference, StoryboardSegment,
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
/** 唯一投影：合法边界同时决定UTF-16正文切片和视觉毫秒；不重排、不缩放原生时间。
 *  对不存在的 boundary ID 做唯一最近吸附（见 snap-design）：LLM 从 450 个边界
 *  原样复制 ID 时有数字漂移，实测漂移 ≤320ms；仅当存在唯一最近真实边界且
 *  |Δ| ≤ 500ms 时修复，等距歧义或超限仍拒绝（不可拆 span 内切点不因此放行）。 */
const MAX_BOUNDARY_SNAP_MS = 500;
const BOUNDARY_ID_PATTERN = /^boundary:(\d+):(\d+)$/;
const SNAP_REPORT_LIMIT = 8;
interface ResolvedBoundary { boundary: NarrationBoundary; snapped: boolean; deltaMs: number; }
export function projectStoryboardTiming(input: StoryboardTimingContext & { plan: unknown }): StoryboardPlanV2 {
  const { timingMap, reference } = source(input);
  const plan = PlanInput.parse(input.plan);
  if (plan.narration_reference && canonicalStringify(plan.narration_reference) !== canonicalStringify(reference))
    throw new Error("storyboard_narration_source_mismatch");
  if (plan.estimated_total_duration_sec !== undefined && plan.estimated_total_duration_sec !== timingMap.durationMs / 1000)
    throw new Error("storyboard_narration_duration_mismatch");
  const boundaries = new Map(timingMap.boundaries.map(b => [b.id, b]));
  const byTime = [...timingMap.boundaries].sort((a, b) => a.visualTimeMs - b.visualTimeMs);
  const snaps: Array<{ segment: number; requested: string; resolved: string; deltaMs: number }> = [];
  const resolveBoundary = (id: string): ResolvedBoundary | null => {
    const exact = boundaries.get(id);
    if (exact) return { boundary: exact, snapped: false, deltaMs: 0 };
    const match = BOUNDARY_ID_PATTERN.exec(id);
    if (!match) return null;
    const target = Number(match[1]);
    let best: NarrationBoundary | null = null, bestDelta = Number.POSITIVE_INFINITY, tied = false;
    for (const b of byTime) {
      const delta = Math.abs(b.visualTimeMs - target);
      if (delta > MAX_BOUNDARY_SNAP_MS) continue;
      if (delta < bestDelta) { best = b; bestDelta = delta; tied = false; }
      else if (delta === bestDelta) tied = true;
    }
    if (!best || tied) return null;
    return { boundary: best, snapped: true, deltaMs: best.visualTimeMs - target };
  };
  let nextBoundary = timingMap.boundaries[0]!.id;
  const segments = plan.segments.map((segment, index) => {
    const start = resolveBoundary(segment.start_boundary_id), end = resolveBoundary(segment.end_boundary_id);
    if (!start || !end || start.boundary.id !== nextBoundary || end.boundary.visualTimeMs <= start.boundary.visualTimeMs || segment.order !== index)
      throw new Error("storyboard_narration_boundary_invalid");
    if (start.snapped && snaps.length < SNAP_REPORT_LIMIT) snaps.push({ segment: index, requested: segment.start_boundary_id, resolved: start.boundary.id, deltaMs: start.deltaMs });
    if (end.snapped && snaps.length < SNAP_REPORT_LIMIT) snaps.push({ segment: index, requested: segment.end_boundary_id, resolved: end.boundary.id, deltaMs: end.deltaMs });
    const derived = { source_start: start.boundary.sourceOffset, source_end: end.boundary.sourceOffset,
      visual_start_ms: start.boundary.visualTimeMs, visual_end_ms: end.boundary.visualTimeMs,
      start_hint_sec: start.boundary.visualTimeMs / 1000, end_hint_sec: end.boundary.visualTimeMs / 1000,
      script_excerpt: timingMap.sourceText.slice(start.boundary.sourceOffset, end.boundary.sourceOffset) };
    for (const key of Object.keys(derived) as Array<keyof typeof derived>)
      if (segment[key] !== undefined && segment[key] !== derived[key]) throw new Error("storyboard_narration_range_mismatch");
    nextBoundary = end.boundary.id;
    // 持久化合同要求 boundary ID 指向真实边界：吸附后必须存解析结果，不能保留原始无效 ID。
    return { ...segment, start_boundary_id: start.boundary.id, end_boundary_id: end.boundary.id, ...derived };
  });
  if (nextBoundary !== timingMap.boundaries.at(-1)!.id) throw new Error("storyboard_narration_coverage_invalid");
  if (snaps.length) console.warn("[storyboard-boundary-snap]", JSON.stringify(snaps));
  return StoryboardPlanV2.parse({ ...plan, narration_reference: reference,
    estimated_total_duration_sec: timingMap.durationMs / 1000, segments });
}
/** 持久化对象先校验正式完整合同，再逐段复核同一来源边界。 */
export function validateStoryboardTiming(plan: unknown, context: StoryboardTimingContext): StoryboardPlanV2 {
  const parsed = StoryboardPlanV2.parse(plan);
  return projectStoryboardTiming({ ...context, plan: parsed });
}
