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
 *  |Δ| ≤ 500ms 时修复，等距歧义或超限仍拒绝（不可拆 span 内切点不因此放行）。
 *  边界类失败抛出 StoryboardBoundaryError（携带可反馈给 planner 的结构化违反信息）。 */
const MAX_BOUNDARY_SNAP_MS = 500;
const BOUNDARY_ID_PATTERN = /^boundary:(\d+):(\d+)$/;
const SNAP_REPORT_LIMIT = 8;
interface ResolvedBoundary { boundary: NarrationBoundary; snapped: boolean; deltaMs: number; }
/** 边界合同违反：violations 为中文可读描述，供一次性重生反馈给 planner。 */
export class StoryboardBoundaryError extends Error {
  constructor(readonly violations: string[]) { super("storyboard_narration_boundary_invalid"); this.name = "StoryboardBoundaryError"; }
}
const boundaryFail = (violations: string[]): never => { throw new StoryboardBoundaryError(violations); };

/** 粗切点候选：planner 从全部边界（450-464 个，长 ID 逐字复制实测三连败）缩减为
 *  "句末 或 停顿 ≥400ms"的候选并按时间编号，复制负担降约 6 倍、选择余量约 4-5 倍。
 *  首尾必含（首尾覆盖合同）；粗筛不足 3 个时退回全量（极端短稿保护）。 */
export const COARSE_BOUNDARY_MIN_PAUSE_MS = 400;
export interface StoryboardBoundaryCandidate { id: string; boundary_id: string; visual_time_ms: number; source_offset: number; }
export function buildStoryboardBoundaryCandidates(timingMap: NarrationTimingMapV1): StoryboardBoundaryCandidate[] {
  const boundaries = timingMap.boundaries;
  const sentenceEndIndices = new Set<number>();
  let boundaryCursor = 0;
  // match.index / length 均为 UTF-16 偏移；闭范围内取最右合法点，不拆开附字标点所在 span。
  // schema 已保证 sourceOffset 严格递增，游标只向前，避免每个标点范围重扫全量边界。
  for (const run of timingMap.sourceText.matchAll(/[\p{P}\p{Z}\s]+/gu)) {
    if (!/[。！？；…]/u.test(run[0])) continue;
    const start = run.index, end = start + run[0].length;
    while (boundaryCursor < boundaries.length && boundaries[boundaryCursor]!.sourceOffset < start) boundaryCursor++;
    let rightmost = -1;
    while (boundaryCursor < boundaries.length && boundaries[boundaryCursor]!.sourceOffset <= end) rightmost = boundaryCursor++;
    if (rightmost >= 0) sentenceEndIndices.add(rightmost);
  }
  const tokensById = new Map(timingMap.tokens.map(token => [token.id, token]));
  const selected: number[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i]!;
    if (i === 0 || i === boundaries.length - 1) { selected.push(i); continue; }
    const left = boundary.leftTokenId ? tokensById.get(boundary.leftTokenId) : undefined;
    const right = boundary.rightTokenId ? tokensById.get(boundary.rightTokenId) : undefined;
    const pause = left && right && right.startMs - left.endMs >= COARSE_BOUNDARY_MIN_PAUSE_MS;
    if (sentenceEndIndices.has(i) || pause) selected.push(i);
  }
  const indices = selected.length >= 3 ? selected : boundaries.map((_, i) => i);
  return indices.map((boundaryIndex, n) => {
    const boundary = boundaries[boundaryIndex]!;
    return { id: "C" + (n + 1), boundary_id: boundary.id, visual_time_ms: boundary.visualTimeMs, source_offset: boundary.sourceOffset };
  });
}
const BOUNDARY_LABEL_PATTERN = /^C(\d+)$/;
/** 把 planner 输出中的候选编号（C<n>）确定性还原为真实 boundary ID（纯查表）；
 *  非编号格式（真实 ID/旧格式）与未知编号原样透传（投影拒绝后进入带反馈重生）。 */
export function resolveStoryboardBoundaryLabels(plan: unknown, candidates: StoryboardBoundaryCandidate[]): unknown {
  if (!plan || typeof plan !== "object") return plan;
  const record = plan as Record<string, unknown>;
  if (!Array.isArray(record.segments)) return plan;
  const byLabel = new Map(candidates.map(c => [c.id, c.boundary_id]));
  const segments = record.segments.map((segment) => {
    if (!segment || typeof segment !== "object") return segment;
    const item = segment as Record<string, unknown>;
    const resolve = (value: unknown): unknown => {
      if (typeof value !== "string") return value;
      const match = BOUNDARY_LABEL_PATTERN.exec(value);
      return match ? byLabel.get(value) ?? value : value;
    };
    return { ...item, start_boundary_id: resolve(item.start_boundary_id), end_boundary_id: resolve(item.end_boundary_id) };
  });
  return { ...record, segments };
}
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
    if (!start || !end) return boundaryFail([`第 ${index + 1} 镜的切点不在候选表内且无法唯一就近吸附：start_boundary_id="${segment.start_boundary_id}"、end_boundary_id="${segment.end_boundary_id}"；必须使用候选表中的候选编号`]);
    if (start.boundary.id !== nextBoundary) return boundaryFail([`第 ${index + 1} 镜起始边界 "${start.boundary.id}" 与上一镜结束边界 "${nextBoundary}" 不连续：相邻镜头必须共享同一端点`]);
    if (end.boundary.visualTimeMs <= start.boundary.visualTimeMs) return boundaryFail([`第 ${index + 1} 镜结束时间 ${end.boundary.visualTimeMs}ms 不晚于开始时间 ${start.boundary.visualTimeMs}ms，时间倒流：镜头边界时间必须沿口播时间轴严格递增，禁止交换 start/end`]);
    if (segment.order !== index) return boundaryFail([`第 ${index + 1} 镜的 order=${segment.order} 与其在数组中的位置 ${index} 不符：order 必须从 0 起按时间顺序连续编号`]);
    if (start.snapped && snaps.length < SNAP_REPORT_LIMIT) snaps.push({ segment: index, requested: segment.start_boundary_id, resolved: start.boundary.id, deltaMs: start.deltaMs });
    if (end.snapped && snaps.length < SNAP_REPORT_LIMIT) snaps.push({ segment: index, requested: segment.end_boundary_id, resolved: end.boundary.id, deltaMs: end.deltaMs });
    const derived = { source_start: start.boundary.sourceOffset, source_end: end.boundary.sourceOffset,
      visual_start_ms: start.boundary.visualTimeMs, visual_end_ms: end.boundary.visualTimeMs,
      start_hint_sec: start.boundary.visualTimeMs / 1000, end_hint_sec: end.boundary.visualTimeMs / 1000,
      script_excerpt: timingMap.sourceText.slice(start.boundary.sourceOffset, end.boundary.sourceOffset) };
    for (const key of Object.keys(derived) as Array<keyof typeof derived>)
      if (segment[key] !== undefined && segment[key] !== derived[key]) return boundaryFail([`第 ${index + 1} 镜自带 ${key} 与边界派生值不一致：不要输出 source offsets、visual 毫秒或摘录，这些由所选边界确定性派生`]);
    nextBoundary = end.boundary.id;
    // 持久化合同要求 boundary ID 指向真实边界：吸附后必须存解析结果，不能保留原始无效 ID。
    return { ...segment, start_boundary_id: start.boundary.id, end_boundary_id: end.boundary.id, ...derived };
  });
  if (nextBoundary !== timingMap.boundaries.at(-1)!.id) boundaryFail([`最后一镜结束边界 "${nextBoundary}" 不是全文末尾边界 "${timingMap.boundaries.at(-1)!.id}"：首尾必须使用全文首尾边界`]);
  if (snaps.length) console.warn("[storyboard-boundary-snap]", JSON.stringify(snaps));
  return StoryboardPlanV2.parse({ ...plan, narration_reference: reference,
    estimated_total_duration_sec: timingMap.durationMs / 1000, segments });
}
/** 持久化对象先校验正式完整合同，再逐段复核同一来源边界。 */
export function validateStoryboardTiming(plan: unknown, context: StoryboardTimingContext): StoryboardPlanV2 {
  const parsed = StoryboardPlanV2.parse(plan);
  return projectStoryboardTiming({ ...context, plan: parsed });
}
