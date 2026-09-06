/** 原生口播片段的离线结构适配；不外呼、不推断发声时间、不授予模型资格。 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  mapObservedText,
  type NativeToken,
  type NormalizationObservation,
} from './narration-evidence-inspector.js';

type ErrorCode =
  | 'native_input_invalid'
  | 'native_tokens_missing'
  | 'native_token_invalid'
  | 'native_sentence_index_invalid'
  | 'native_time_invalid'
  | 'native_positive_overlap'
  | 'native_text_mismatch'
  | 'native_text_mapping_invalid'
  | 'native_zero_duration_all_zero'
  | 'native_zero_duration_cross_sentence'
  | 'native_zero_duration_unattachable'
  | 'native_boundaries_invalid'
  | 'native_cli_arguments_invalid';

export interface NativeSpanBoundary {
  boundary_id: string;
  time_ms: number;
  source_offset: number;
  raw_candidate_source_offsets: number[];
  legal_candidate_source_offsets: number[];
  selection_reason: 'edge' | 'maximum_legal_source_offset';
}

export interface NativeSpanMember {
  ordinal: number;
  text: string;
  begin_index: number;
  end_index: number;
  begin_time: number;
  end_time: number;
  provider_sentence_index: number;
  source_start: number;
  source_end: number;
}

export interface NarrationNativeSpan {
  ordinal: number;
  start_ms: number;
  end_ms: number;
  source_start: number;
  source_end: number;
  provider_sentence_index: number;
  provider_index_range: { begin_index: number; end_index: number };
  merge_reason: 'positive_native_token' | 'zero_duration_run_attached_to_previous_shared_end' | 'zero_duration_run_attached_to_next_shared_start' | 'zero_duration_runs_attached_to_both_shared_endpoints';
  raw_summary: { token_count: number; zero_duration_token_count: number; text: string; start_ms: number; end_ms: number; sha256: string };
  members: NativeSpanMember[];
}

interface NativeSpanInput {
  sourceText: string;
  durationMs: number;
  tokens: Array<NativeToken & { providerSentenceIndex?: number }>;
  providerSentenceIndices?: number[];
  observations?: NormalizationObservation[];
}

const integer = (value: unknown): value is number => Number.isSafeInteger(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every((key) => allowed.includes(key));
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
};
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
function fail(code: ErrorCode): never {
  throw new Error(code);
}

function parseInput(value: unknown): NativeSpanInput {
  if (!record(value) || !exactKeys(value, ['sourceText', 'durationMs', 'tokens', 'providerSentenceIndices', 'observations']) ||
      typeof value.sourceText !== 'string' || !value.sourceText.length || !integer(value.durationMs) || value.durationMs <= 0 || !Array.isArray(value.tokens)) {
    fail('native_input_invalid');
  }
  if (!value.tokens.length) fail('native_tokens_missing');
  const tokens = value.tokens.map((candidate) => {
    if (!record(candidate) || !exactKeys(candidate, ['text', 'begin_index', 'end_index', 'begin_time', 'end_time', 'providerSentenceIndex']) ||
        typeof candidate.text !== 'string' || !candidate.text.length ||
        !integer(candidate.begin_index) || !integer(candidate.end_index) || candidate.begin_index < 0 || candidate.end_index <= candidate.begin_index ||
        !integer(candidate.begin_time) || !integer(candidate.end_time)) {
      fail('native_token_invalid');
    }
    if (candidate.providerSentenceIndex !== undefined && (!integer(candidate.providerSentenceIndex) || candidate.providerSentenceIndex < 0)) {
      fail('native_sentence_index_invalid');
    }
    return {
      text: candidate.text,
      begin_index: candidate.begin_index,
      end_index: candidate.end_index,
      begin_time: candidate.begin_time,
      end_time: candidate.end_time,
      ...(candidate.providerSentenceIndex === undefined ? {} : { providerSentenceIndex: candidate.providerSentenceIndex }),
    } as NativeToken & { providerSentenceIndex?: number };
  });
  let providerSentenceIndices: number[] | undefined;
  if (value.providerSentenceIndices !== undefined) {
    if (!Array.isArray(value.providerSentenceIndices) || value.providerSentenceIndices.length !== tokens.length ||
        value.providerSentenceIndices.some((index) => !integer(index) || index < 0)) fail('native_sentence_index_invalid');
    providerSentenceIndices = [...value.providerSentenceIndices] as number[];
  }
  tokens.forEach((token, index) => {
    const explicit = providerSentenceIndices?.[index];
    if (token.providerSentenceIndex === undefined && explicit === undefined) fail('native_sentence_index_invalid');
    if (token.providerSentenceIndex !== undefined && explicit !== undefined && token.providerSentenceIndex !== explicit) fail('native_sentence_index_invalid');
  });
  let observations: NormalizationObservation[] | undefined;
  if (value.observations !== undefined) {
    if (!Array.isArray(value.observations)) fail('native_input_invalid');
    observations = value.observations.map((candidate) => {
      if (!record(candidate) || !exactKeys(candidate, ['start', 'end', 'expected', 'spoken']) || !integer(candidate.start) || !integer(candidate.end) ||
          typeof candidate.expected !== 'string' || typeof candidate.spoken !== 'string') fail('native_input_invalid');
      return { start: candidate.start, end: candidate.end, expected: candidate.expected, spoken: candidate.spoken };
    });
  }
  return { sourceText: value.sourceText, durationMs: value.durationMs, tokens, providerSentenceIndices, observations };
}

function validateTimes(tokens: NativeToken[], durationMs: number) {
  let previousBegin = -1;
  let previousPositiveEnd = -1;
  for (const token of tokens) {
    if (token.begin_time < 0 || token.end_time < token.begin_time || token.end_time > durationMs || token.begin_time < previousBegin) fail('native_time_invalid');
    previousBegin = token.begin_time;
    if (token.end_time > token.begin_time) {
      if (token.begin_time < previousPositiveEnd) fail('native_positive_overlap');
      previousPositiveEnd = token.end_time;
    }
  }
}

const silentGap = (from: number, to: number, silent: Array<{ start: number; end: number }>) => {
  if (from === to) return true;
  if (from > to) return false;
  let cursor = from;
  for (const span of silent) {
    if (span.end <= cursor || span.start > cursor) continue;
    cursor = Math.max(cursor, span.end);
    if (cursor >= to) return true;
  }
  return false;
};

const sourceAdjacent = (left: NativeSpanMember, right: NativeSpanMember, silent: Array<{ start: number; end: number }>) =>
  // mapObservedText 已验证来源顺序；重叠表示共享规范化或 grapheme 来源。
  left.source_end >= right.source_start ||
  silentGap(left.source_end, right.source_start, silent);

function makeSpan(members: NativeSpanMember[], reason: NarrationNativeSpan['merge_reason']): NarrationNativeSpan {
  const sentence = members[0].provider_sentence_index;
  if (members.some((member) => member.provider_sentence_index !== sentence)) fail('native_zero_duration_cross_sentence');
  const start = Math.min(...members.map((member) => member.begin_time));
  const end = Math.max(...members.map((member) => member.end_time));
  return {
    ordinal: -1,
    start_ms: start,
    end_ms: end,
    source_start: Math.min(...members.map((member) => member.source_start)),
    source_end: Math.max(...members.map((member) => member.source_end)),
    provider_sentence_index: sentence,
    provider_index_range: {
      begin_index: Math.min(...members.map((member) => member.begin_index)),
      end_index: Math.max(...members.map((member) => member.end_index)),
    },
    merge_reason: reason,
    raw_summary: {
      token_count: members.length,
      zero_duration_token_count: members.filter((member) => member.begin_time === member.end_time).length,
      text: members.map((member) => member.text).join(''),
      start_ms: start,
      end_ms: end,
      sha256: hash(members.map(({ source_start: _sourceStart, source_end: _sourceEnd, ...raw }) => raw)),
    },
    members: members.map((member) => ({ ...member })),
  };
}

function addCandidate(target: Map<number, Set<number>>, time: number, sourceOffset: number) {
  const offsets = target.get(time) ?? new Set<number>();
  offsets.add(sourceOffset);
  target.set(time, offsets);
}

function buildBoundaries(sourceLength: number, durationMs: number, members: NativeSpanMember[], spans: NarrationNativeSpan[], legalSourceCuts: number[]): NativeSpanBoundary[] {
  const legal = new Set(legalSourceCuts);
  const rawCandidates = new Map<number, Set<number>>();
  const legalCandidates = new Map<number, Set<number>>();
  addCandidate(rawCandidates, 0, 0);
  addCandidate(legalCandidates, 0, 0);
  for (let index = 1; index < members.length; index++) {
    const previous = members[index - 1];
    const next = members[index];
    if (previous.source_end <= next.source_start && legal.has(next.source_start)) addCandidate(rawCandidates, next.begin_time, next.source_start);
  }
  for (let index = 1; index < spans.length; index++) {
    const previous = spans[index - 1];
    const next = spans[index];
    if (previous.source_end > next.source_start || !legal.has(next.source_start)) continue;
    addCandidate(legalCandidates, next.start_ms, next.source_start);
  }
  addCandidate(rawCandidates, durationMs, sourceLength);
  addCandidate(legalCandidates, durationMs, sourceLength);
  const sorted = [...legalCandidates].sort((left, right) => left[0] - right[0]);
  const boundaries: NativeSpanBoundary[] = [];
  for (const [time_ms, offsets] of sorted) {
    const source_offset = Math.max(...offsets);
    const previous = boundaries.at(-1);
    if (time_ms < 0 || time_ms > durationMs || source_offset < 0 || source_offset > sourceLength) fail('native_boundaries_invalid');
    if (!previous || time_ms > previous.time_ms && source_offset > previous.source_offset) boundaries.push({
      boundary_id: `native-boundary:${time_ms}:${source_offset}`,
      time_ms,
      source_offset,
      raw_candidate_source_offsets: [...(rawCandidates.get(time_ms) ?? new Set([source_offset]))].sort((left, right) => left - right),
      legal_candidate_source_offsets: [...offsets].sort((left, right) => left - right),
      selection_reason: time_ms === 0 || time_ms === durationMs ? 'edge' : 'maximum_legal_source_offset',
    });
  }
  if (boundaries.length < 2 || boundaries[0].time_ms !== 0 || boundaries[0].source_offset !== 0 ||
      boundaries.at(-1)?.time_ms !== durationMs || boundaries.at(-1)?.source_offset !== sourceLength) fail('native_boundaries_invalid');
  return boundaries;
}

export function buildNarrationNativeSpans(value: unknown) {
  const input = parseInput(value);
  validateTimes(input.tokens, input.durationMs);
  let mapping: ReturnType<typeof mapObservedText>;
  try { mapping = mapObservedText(input.sourceText, input.tokens, input.observations); }
  catch { fail('native_text_mapping_invalid'); }
  if (mapping.status === 'mismatch') fail('native_text_mismatch');
  const mappedTokens = mapping.tokens as Array<NativeToken & { providerSentenceIndex?: number; source_start: number; source_end: number }>;
  const members: NativeSpanMember[] = mappedTokens.map((token, ordinal) => ({
    ordinal,
    text: token.text,
    begin_index: token.begin_index,
    end_index: token.end_index,
    begin_time: token.begin_time,
    end_time: token.end_time,
    provider_sentence_index: token.providerSentenceIndex ?? input.providerSentenceIndices![ordinal],
    source_start: token.source_start,
    source_end: token.source_end,
  }));
  const positives = members.filter((member) => member.end_time > member.begin_time);
  if (!positives.length) fail('native_zero_duration_all_zero');
  const memberGroups = new Map<number, NativeSpanMember[]>();
  positives.forEach((member) => memberGroups.set(member.ordinal, [member]));
  for (let first = 0; first < members.length;) {
    if (members[first].end_time > members[first].begin_time) { first++; continue; }
    let end = first + 1;
    while (end < members.length && members[end].end_time === members[end].begin_time) end++;
    const run = members.slice(first, end);
    const point = run[0].begin_time;
    const samePoint = run.every((member) => member.begin_time === point);
    const previous = members[first - 1]?.end_time > members[first - 1]?.begin_time ? members[first - 1] : undefined;
    const next = members[end]?.end_time > members[end]?.begin_time ? members[end] : undefined;
    const runContinuous = run.every((member, index) => index === 0 || sourceAdjacent(run[index - 1], member, mapping.silent_source_spans));
    const previousTime = !!previous && samePoint && previous.end_time === point;
    const nextTime = !!next && samePoint && next.begin_time === point;
    const previousSentence = previousTime && run.every((member) => member.provider_sentence_index === previous!.provider_sentence_index);
    const nextSentence = nextTime && run.every((member) => member.provider_sentence_index === next!.provider_sentence_index);
    const previousValid = previousSentence && runContinuous && sourceAdjacent(previous!, run[0], mapping.silent_source_spans);
    const nextValid = nextSentence && runContinuous && sourceAdjacent(run.at(-1)!, next!, mapping.silent_source_spans);
    if (previousValid) memberGroups.set(previous!.ordinal, [...memberGroups.get(previous!.ordinal)!, ...run]);
    else if (nextValid) memberGroups.set(next!.ordinal, [...run, ...memberGroups.get(next!.ordinal)!]);
    else if ((previousTime && !previousSentence) || (nextTime && !nextSentence)) fail('native_zero_duration_cross_sentence');
    else fail('native_zero_duration_unattachable');
    first = end;
  }
  const spans = positives.map((positive) => {
    const group = memberGroups.get(positive.ordinal)!;
    const before = group.some((member) => member.ordinal < positive.ordinal);
    const after = group.some((member) => member.ordinal > positive.ordinal);
    const reason = before && after ? 'zero_duration_runs_attached_to_both_shared_endpoints'
      : before ? 'zero_duration_run_attached_to_next_shared_start'
      : after ? 'zero_duration_run_attached_to_previous_shared_end'
      : 'positive_native_token';
    return makeSpan(group, reason);
  });
  spans.forEach((span, ordinal) => { span.ordinal = ordinal; });
  const boundaries = buildBoundaries(input.sourceText.length, input.durationMs, members, spans, mapping.legal_source_cuts);
  const input_sha256 = hash({
    sourceText: input.sourceText,
    durationMs: input.durationMs,
    tokens: input.tokens.map((token, ordinal) => ({ ...token, providerSentenceIndex: token.providerSentenceIndex ?? input.providerSentenceIndices![ordinal] })),
    observations: input.observations ?? [],
  });
  return {
    schema_version: 'narration-native-spans/v1' as const,
    actual_requests: 0 as const,
    qualification: 'unverified' as const,
    mapping_status: mapping.status,
    duration_ms: input.durationMs,
    source_utf16: input.sourceText.length,
    input_sha256,
    spans,
    boundaries,
  };
}

/** 投影只消费原始验证输入；外部只能选择已生成的边界 ID，不能注入时间或另换正文。 */
export function deriveBoundaryPairs(value: unknown, selectedBoundaryIds?: unknown) {
  const input = parseInput(value);
  const timing = buildNarrationNativeSpans(input);
  let boundaries = timing.boundaries;
  if (selectedBoundaryIds !== undefined) {
    if (!Array.isArray(selectedBoundaryIds) || selectedBoundaryIds.length < 2 || selectedBoundaryIds.some((id) => typeof id !== 'string')) fail('native_boundaries_invalid');
    const indices = new Map(boundaries.map((boundary, index) => [boundary.boundary_id, index]));
    const selected = selectedBoundaryIds.map((id) => indices.get(id));
    if (selected.some((index, i) => index === undefined || i > 0 && index <= selected[i - 1]!) ||
        selected[0] !== 0 || selected.at(-1) !== boundaries.length - 1) fail('native_boundaries_invalid');
    boundaries = selected.map((index) => boundaries[index!]);
  }
  return boundaries.slice(0, -1).map((boundary, boundary_pair_index) => ({
    boundary_pair_index,
    start_boundary_id: boundary.boundary_id,
    end_boundary_id: boundaries[boundary_pair_index + 1].boundary_id,
    start_ms: boundary.time_ms,
    end_ms: boundaries[boundary_pair_index + 1].time_ms,
    source_start: boundary.source_offset,
    source_end: boundaries[boundary_pair_index + 1].source_offset,
    text: input.sourceText.slice(boundary.source_offset, boundaries[boundary_pair_index + 1].source_offset),
  }));
}

export function deriveBoundaryExcerpts(value: unknown, selectedBoundaryIds?: unknown) {
  return deriveBoundaryPairs(value, selectedBoundaryIds).map(({ boundary_pair_index, source_start, source_end, text }) => ({
    boundary_pair_index, source_start, source_end, text,
  }));
}

export function deriveVisualIntervals(value: unknown, selectedBoundaryIds?: unknown) {
  return deriveBoundaryPairs(value, selectedBoundaryIds).map(({ boundary_pair_index, start_ms, end_ms }) => ({
    boundary_pair_index, start_ms, end_ms,
  }));
}

export function runOfflineNativeSpanCli(argv: string[]) {
  if (!argv.length) return { actual_requests: 0 as const, qualification: 'unverified' as const, usage: '--input <既有原生证据 JSON>' };
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1] || argv[1].startsWith('--')) fail('native_cli_arguments_invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(resolve(argv[1]), 'utf8')); }
  catch { fail('native_input_invalid'); }
  return buildNarrationNativeSpans(parsed);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(runOfflineNativeSpanCli(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) {
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'native_input_invalid';
    process.stderr.write(JSON.stringify({ error: message }) + '\n');
    process.exitCode = 1;
  }
}
