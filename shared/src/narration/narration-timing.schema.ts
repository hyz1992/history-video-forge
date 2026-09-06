import { z } from "zod";

export const NarrationInteger = z.number().int().safe().nonnegative();
export const NarrationSha256 = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().trim().min(1);

/** 原生 token 包含零时长成员；只有经 sourceSpans 合法归并的整图才能用于下游。 */
export const TimingToken = z.object({
  id, sourceStart: NarrationInteger, sourceEnd: NarrationInteger,
  spokenText: z.string().min(1), startMs: NarrationInteger, endMs: NarrationInteger,
  providerSentenceIndex: NarrationInteger,
  providerIndexRange: z.tuple([NarrationInteger, NarrationInteger]),
}).strict().refine(t => t.sourceEnd > t.sourceStart && t.endMs >= t.startMs &&
  t.providerIndexRange[1] > t.providerIndexRange[0], { message: "narration_token_range_invalid" });
export type TimingToken = z.infer<typeof TimingToken>;

export const NarrationSourceSpan = z.object({
  id, sourceStart: NarrationInteger, sourceEnd: NarrationInteger,
  startMs: NarrationInteger, endMs: NarrationInteger,
  tokenIds: z.array(id).min(1),
  mergeReason: z.enum(["positive_native_token", "shared_source_span", "shared_source_span_with_zero_duration_members",
    "zero_duration_run_attached_to_previous_shared_end", "zero_duration_run_attached_to_next_shared_start",
    "zero_duration_runs_attached_to_both_shared_endpoints"]),
}).strict().refine(s => s.sourceEnd > s.sourceStart && s.endMs > s.startMs,
  { message: "narration_span_range_invalid" });
export type NarrationSourceSpan = z.infer<typeof NarrationSourceSpan>;

export const NarrationBoundary = z.object({
  id, sourceOffset: NarrationInteger, visualTimeMs: NarrationInteger,
  leftTokenId: id.nullable(), rightTokenId: id.nullable(),
  ruleVersion: z.literal("narration-boundaries/v1"),
  rawCandidateSourceOffsets: z.array(NarrationInteger).min(1),
  legalCandidateSourceOffsets: z.array(NarrationInteger).min(1),
  selectionReason: z.enum(["edge", "maximum_legal_source_offset"]),
}).strict();
export type NarrationBoundary = z.infer<typeof NarrationBoundary>;

const silent = (text: string) => /^[\p{P}\p{Z}\s]*$/u.test(text);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 只核验结构/完整来源与原生端点，不判断叙事质量，不插值生成任何时间。 */
export const NarrationTimingMapV1 = z.object({
  schemaVersion: z.literal("narration_timing_map_v1"),
  sourceText: z.string().min(1).max(20000), spokenText: z.string().min(1),
  textMappingVersion: z.literal("narration-native-spans/v1"),
  audioHash: NarrationSha256, durationMs: NarrationInteger.positive(),
  tokens: z.array(TimingToken).min(1), sourceSpans: z.array(NarrationSourceSpan).min(1),
  boundaries: z.array(NarrationBoundary).min(2),
}).strict().superRefine((m, ctx) => {
  // Zod 的 min 下限失败仍会进入 refinement；交叉校验须先满足非空前提。
  // 这些输入已有字段级问题，直接返回保留原始 ZodError，不解引用缺失成员。
  if (m.tokens.length === 0 || m.sourceSpans.length === 0 || m.boundaries.length < 2 ||
    m.sourceSpans.some(span => span.tokenIds.length === 0)) return;
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const tokens = m.tokens;
  const graphemeCuts = new Set<number>([0, m.sourceText.length]);
  for (const part of new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(m.sourceText)) graphemeCuts.add(part.index);
  const seen = new Set<string>();
  let covered = 0;
  let positiveEnd = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!; const p = tokens[i - 1];
    if (seen.has(t.id) || t.sourceEnd > m.sourceText.length || t.endMs > m.durationMs ||
      !graphemeCuts.has(t.sourceStart) || !graphemeCuts.has(t.sourceEnd) ||
      (p && (t.startMs < p.startMs || t.sourceStart < p.sourceStart ||
        (t.sourceStart < p.sourceEnd && (t.sourceStart !== p.sourceStart || t.sourceEnd !== p.sourceEnd)) ||
        t.sourceEnd < p.sourceEnd || t.providerSentenceIndex < p.providerSentenceIndex ||
        t.providerIndexRange[0] !== p.providerIndexRange[1])) ||
      (t.sourceStart > covered && !silent(m.sourceText.slice(covered, t.sourceStart)))) fail("narration_token_source_invalid");
    if (t.endMs > t.startMs) { if (t.startMs < positiveEnd) fail("narration_positive_overlap"); positiveEnd = t.endMs; }
    covered = Math.max(covered, t.sourceEnd); seen.add(t.id);
  }
  if (!silent(m.sourceText.slice(covered)) || tokens.map(t => t.spokenText).join("") !== m.spokenText) fail("narration_text_coverage_invalid");
  // 与冻结 native-spans/v1 一致：由原始连续零点 run 决定归属，合法前侧优先。
  // 不能依据调用方提交的 sourceSpans 反推优先级，否则相同 raw 会得到不同切点。
  const zeroTargets = new Map<string, string>();
  const sourceAdjacent = (left: TimingToken, right: TimingToken) =>
    left.sourceEnd >= right.sourceStart || silent(m.sourceText.slice(left.sourceEnd, right.sourceStart));
  for (let first = 0; first < tokens.length;) {
    if (tokens[first]!.endMs !== tokens[first]!.startMs) { first++; continue; }
    let end = first + 1;
    while (end < tokens.length && tokens[end]!.endMs === tokens[end]!.startMs) end++;
    const run = tokens.slice(first, end);
    const point = run[0]!.startMs;
    const samePoint = run.every(member => member.startMs === point);
    const previous = tokens[first - 1];
    const next = tokens[end];
    const continuous = run.every((member, i) => i === 0 || sourceAdjacent(run[i - 1]!, member));
    const previousValid = previous && previous.endMs > previous.startMs && previous.endMs === point &&
      samePoint && continuous && run.every(member => member.providerSentenceIndex === previous.providerSentenceIndex) &&
      sourceAdjacent(previous, run[0]!);
    const nextValid = next && next.endMs > next.startMs && next.startMs === point &&
      samePoint && continuous && run.every(member => member.providerSentenceIndex === next.providerSentenceIndex) &&
      sourceAdjacent(run.at(-1)!, next);
    const target = previousValid ? previous : nextValid ? next : undefined;
    if (!target) fail("narration_zero_unattachable");
    else for (const member of run) zeroTargets.set(member.id, target.id);
    first = end;
  }
  const flattened = m.sourceSpans.flatMap(s => s.tokenIds);
  if (!equal(flattened, tokens.map(t => t.id)) || new Set(m.sourceSpans.map(s => s.id)).size !== m.sourceSpans.length) {
    fail("narration_span_members_invalid"); return;
  }
  // 最小不可拆闭包：相同完整 source 范围，以及已冻结的零点 target，都禁止其间切开。
  // 差分表把这些相邻/区间关系线性归并，既不遗漏组合关系，也不允许吞并独立 positive。
  const cutLinks = new Array<number>(tokens.length + 1).fill(0);
  const linkCuts = (firstCut: number, lastCut: number) => {
    cutLinks[firstCut]! += 1;
    cutLinks[lastCut + 1]! -= 1;
  };
  const tokenIndices = new Map(tokens.map((token, index) => [token.id, index]));
  for (let i = 1; i < tokens.length; i++) {
    const previous = tokens[i - 1]!; const next = tokens[i]!;
    if (previous.sourceStart === next.sourceStart && previous.sourceEnd === next.sourceEnd) linkCuts(i, i);
  }
  for (const [memberId, targetId] of zeroTargets) {
    const member = tokenIndices.get(memberId)!; const target = tokenIndices.get(targetId)!;
    linkCuts(Math.min(member, target) + 1, Math.max(member, target));
  }
  const expectedGroups: string[][] = [];
  let activeLinks = 0;
  for (let i = 0; i < tokens.length; i++) {
    activeLinks += cutLinks[i]!;
    if (i === 0 || activeLinks === 0) expectedGroups.push([]);
    expectedGroups.at(-1)!.push(tokens[i]!.id);
  }
  if (!equal(m.sourceSpans.map(span => span.tokenIds), expectedGroups)) {
    fail("narration_span_minimal_closure_invalid"); return;
  }
  let cursor = 0;
  for (const s of m.sourceSpans) {
    const members = tokens.slice(cursor, cursor + s.tokenIds.length); cursor += members.length;
    const positive = members.filter(t => t.endMs > t.startMs);
    if (!positive.length || s.startMs !== Math.min(...members.map(t => t.startMs)) ||
      s.endMs !== Math.max(...members.map(t => t.endMs)) || s.sourceStart !== members[0]!.sourceStart ||
      s.sourceEnd !== members.at(-1)!.sourceEnd) { fail("narration_span_native_endpoints_invalid"); continue; }
    const zero = members.filter(t => t.endMs === t.startMs);
    const memberIds = new Set(s.tokenIds);
    if (zero.some(member => !memberIds.has(zeroTargets.get(member.id) ?? ""))) fail("narration_zero_merge_priority_invalid");
    if (members.some(t => t.providerSentenceIndex !== members[0]!.providerSentenceIndex)) fail("narration_span_cross_sentence");
    if (!zero.length) {
      const shared = members.every(t => t.sourceStart === s.sourceStart && t.sourceEnd === s.sourceEnd);
      if ((members.length === 1 && s.mergeReason !== "positive_native_token") ||
        (members.length > 1 && (!shared || s.mergeReason !== "shared_source_span"))) fail("narration_span_merge_evidence_invalid");
    } else if (positive.length > 1) {
      // 原始 zeroTargets 已逐个验证共享原生端点；零点可位于闭包内部，不必位于总片段首尾。
      if (s.mergeReason !== "shared_source_span_with_zero_duration_members") fail("narration_span_merge_evidence_invalid");
    } else {
      const head = zero.some(t => t.startMs === positive[0]!.startMs);
      const tail = zero.some(t => t.startMs === positive[0]!.endMs);
      const reason = head && tail ? "zero_duration_runs_attached_to_both_shared_endpoints" : head ?
        "zero_duration_run_attached_to_next_shared_start" : "zero_duration_run_attached_to_previous_shared_end";
      if (s.mergeReason !== reason) fail("narration_zero_endpoint_invalid");
    }
  }
  // 所有合法切点必须完整保存；raw 表保留归并掉的内部候选，不创造内部发声时间。
  const raw = new Map<number, Set<number>>(); const legal = new Map<number, Set<number>>();
  const add = (map: Map<number, Set<number>>, time: number, offset: number) => {
    const offsets = map.get(time) ?? new Set<number>(); offsets.add(offset); map.set(time, offsets);
  };
  for (const map of [raw, legal]) { add(map, 0, 0); add(map, m.durationMs, m.sourceText.length); }
  for (let i = 1; i < tokens.length; i++) if (tokens[i - 1]!.sourceEnd <= tokens[i]!.sourceStart) add(raw, tokens[i]!.startMs, tokens[i]!.sourceStart);
  for (let i = 1; i < m.sourceSpans.length; i++) {
    const p = m.sourceSpans[i - 1]!; const n = m.sourceSpans[i]!;
    if (p.endMs > n.startMs || p.sourceEnd > n.sourceStart) fail("narration_span_overlap");
    if (p.sourceEnd <= n.sourceStart) add(legal, n.startMs, n.sourceStart);
  }
  const expected = [...legal].sort((a, b) => a[0] - b[0]);
  if (m.boundaries.length !== expected.length || new Set(m.boundaries.map(b => b.id)).size !== m.boundaries.length) fail("narration_boundaries_incomplete");
  for (let i = 0; i < expected.length; i++) {
    const [time, offsets] = expected[i]!; const b = m.boundaries[i]; if (!b) continue;
    const edge = time === 0 || time === m.durationMs;
    const offset = time === 0 ? 0 : time === m.durationMs ? m.sourceText.length : Math.max(...offsets);
    const right = time === m.durationMs ? undefined : tokens.find(t => t.sourceStart === offset);
    const rightIndex = right ? tokens.indexOf(right) : tokens.length;
    if (b.visualTimeMs !== time || b.sourceOffset !== offset ||
      b.leftTokenId !== (time === 0 ? null : tokens[rightIndex - 1]?.id ?? null) ||
      b.rightTokenId !== (time === 0 ? tokens[0]!.id : right?.id ?? null) ||
      b.selectionReason !== (edge ? "edge" : "maximum_legal_source_offset") ||
      !equal(b.rawCandidateSourceOffsets, [...(raw.get(time) ?? [])].sort((a, b) => a - b)) ||
      !equal(b.legalCandidateSourceOffsets, [...offsets].sort((a, b) => a - b)) ||
      (i > 0 && b.sourceOffset <= m.boundaries[i - 1]!.sourceOffset)) fail("narration_boundary_evidence_invalid");
  }
});
export type NarrationTimingMapV1 = z.infer<typeof NarrationTimingMapV1>;

export const NarrationSubtitleCue = z.object({
  id, text: z.string().min(1), sourceStart: NarrationInteger, sourceEnd: NarrationInteger,
  speechStartMs: NarrationInteger, speechEndMs: NarrationInteger,
  displayStartMs: NarrationInteger, displayEndMs: NarrationInteger,
}).strict().refine(c => c.sourceEnd > c.sourceStart && c.speechEndMs > c.speechStartMs &&
  c.displayEndMs > c.displayStartMs && c.displayStartMs <= c.speechStartMs && c.displayEndMs >= c.speechEndMs,
  { message: "narration_subtitle_cue_invalid" });
export type NarrationSubtitleCue = z.infer<typeof NarrationSubtitleCue>;

export const NarrationSubtitleTimelineV1 = z.object({
  schemaVersion: z.literal("narration_subtitle_timeline_v1"), audioHash: NarrationSha256,
  timingHash: NarrationSha256, durationMs: NarrationInteger.positive(),
  cues: z.array(NarrationSubtitleCue).min(1),
}).strict().superRefine((timeline, ctx) => {
  const ids = new Set<string>();
  for (let i = 0; i < timeline.cues.length; i++) {
    const cue = timeline.cues[i]!; const previous = timeline.cues[i - 1];
    if (ids.has(cue.id) || cue.displayEndMs > timeline.durationMs ||
      (previous && (cue.sourceStart < previous.sourceEnd || cue.displayStartMs < previous.displayEndMs ||
        cue.speechStartMs < previous.speechEndMs))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "narration_subtitle_timeline_invalid" });
    ids.add(cue.id);
  }
});
export type NarrationSubtitleTimelineV1 = z.infer<typeof NarrationSubtitleTimelineV1>;
