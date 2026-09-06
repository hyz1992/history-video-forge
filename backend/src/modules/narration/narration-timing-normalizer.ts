import { z } from 'zod';
import { NarrationTimingMapV1, NarrationInteger, NarrationSha256, type TimingToken, type NarrationSourceSpan, type NarrationBoundary } from '../../../../shared/src/index.js';

export const NativeNarrationWord = z.object({ text: z.string().min(1), begin_index: NarrationInteger,
  end_index: NarrationInteger, begin_time: NarrationInteger, end_time: NarrationInteger }).strict();
export const NativeNarrationSentence = z.object({ providerSentenceIndex: NarrationInteger,
  originalText: z.string().min(1).max(20000), normalizedText: z.string().min(1).max(40000),
  words: z.array(NativeNarrationWord).min(1).max(40000) }).strict();
export type NativeNarrationSentence = z.infer<typeof NativeNarrationSentence>;
const Input = z.object({ sourceText: z.string().min(1).max(20000), durationMs: NarrationInteger.positive(),
  audioHash: NarrationSha256, sentences: z.array(NativeNarrationSentence).min(1).max(20000) }).strict();
const fail = (): never => { throw new Error('narration_timing_invalid'); };
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const digits = '零一二三四五六七八九';

/** 有限的整数表示转换，不选择发音、不改供应商正文。位值最多12位，其他整数仅逐位形式。 */
function integerForms(value: string): string[] {
  const forms = [Array.from(value, c => digits[Number(c)]!).join('')];
  if (value.length > 12 || value.length > 1 && value[0] === '0') return forms;
  const small = (v: string): string => {
    let text = '', zero = false;
    for (let i = 0; i < v.length; i++) {
      const n = Number(v[i]);
      if (!n) { if (text) zero = true; continue; }
      if (zero) text += '零';
      text += digits[n]! + ['', '十', '百', '千'][v.length - i - 1]!; zero = false;
    }
    return text;
  };
  const groups: string[] = [];
  for (let end = value.length; end > 0; end -= 4) groups.unshift(value.slice(Math.max(0, end - 4), end));
  let text = '', skipped = false;
  groups.forEach((group, i) => {
    const n = Number(group);
    if (!n) { if (text) skipped = true; return; }
    if (text && (skipped || n < 1000)) text += '零';
    text += small(group) + ['', '万', '亿'][groups.length - i - 1]!; skipped = false;
  });
  text = text || '零';
  if (text.startsWith('一十')) text = text.slice(1);
  return [...new Set([...forms, text])];
}
interface Unit { text: string; sourceStart: number; sourceEnd: number; }
interface Choice { spoken: string; units: Unit[]; }
/** 原样grapheme及冻结的有限变换；每一候选必须与同次 normalized_text 精确相等。 */
function mapSentence(original: string, normalized: string, sourceBase: number): Unit[] {
  const parts = Array.from(segmenter.segment(original));
  const blocks: Choice[][] = [];
  const choice = (spoken: string, start: number, end: number): Choice => ({ spoken,
    units: Array.from(spoken, text => ({ text, sourceStart: sourceBase + start, sourceEnd: sourceBase + end })) });
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (/^[0-9]$/.test(part.segment)) {
      let last = i + 1;
      while (last < parts.length && /^[0-9]$/.test(parts[last]!.segment)) last++;
      const number = parts.slice(i, last).map(p => p.segment).join('');
      const end = part.index + number.length;
      blocks.push([{ spoken: number, units: parts.slice(i, last).flatMap(p => choice(p.segment, p.index, p.index + 1).units) },
        ...integerForms(number).map(text => choice(text, part.index, end))]);
      i = last - 1; continue;
    }
    if (part.segment === '—' && parts[i + 1]?.segment === '—') {
      blocks.push([{ spoken: '——', units: [...choice('—', part.index, part.index + 1).units, ...choice('—', part.index + 1, part.index + 2).units] }, choice('，', part.index, part.index + 2)]); i++; continue;
    }
    const choices = [choice(part.segment, part.index, part.index + part.segment.length)];
    if (part.segment === '\n' || part.segment === '\r\n') choices.push(choice('', part.index, part.index + part.segment.length));
    if (part.segment === '𠮷') choices.push(choice('吉', part.index, part.index + 2));
    blocks.push(choices);
  }
  // 不找子串、不做编辑距离。保留所有精确解析；同位置多个来源解析也算歧义。
  interface Path { offset: number; previous?: Path; units: Unit[]; ambiguous: boolean; }
  let states = new Map<number, Path>([[0, { offset: 0, units: [], ambiguous: false }]]);
  for (const choices of blocks) {
    const next = new Map<number, Path>();
    for (const state of states.values()) for (const candidate of choices) {
      if (!normalized.startsWith(candidate.spoken, state.offset)) continue;
      const offset = state.offset + candidate.spoken.length;
      const existing = next.get(offset);
      if (existing) existing.ambiguous = true;
      else next.set(offset, { offset, previous: state, units: candidate.units, ambiguous: state.ambiguous });
    }
    if (!next.size || next.size > 4096) fail();
    states = next;
  }
  const final = states.get(normalized.length);
  if (!final || final.ambiguous) fail();
  const chunks: Unit[][] = [];
  for (let node: Path | undefined = final; node; node = node.previous) chunks.push(node.units);
  return chunks.reverse().flat();
}

function makeSpans(tokens: TimingToken[], source: string): NarrationSourceSpan[] {
  const links = new Array<number>(tokens.length + 1).fill(0);
  const link = (a: number, b: number) => { links[Math.min(a, b) + 1]!++; links[Math.max(a, b) + 1]!--; };
  const adjacent = (a: TimingToken, b: TimingToken) => a.sourceEnd >= b.sourceStart || /^[\p{P}\p{Z}\s]*$/u.test(source.slice(a.sourceEnd, b.sourceStart));
  for (let i = 1; i < tokens.length; i++) {
    const p = tokens[i - 1]!, n = tokens[i]!;
    if (p.sourceStart === n.sourceStart && p.sourceEnd === n.sourceEnd) link(i - 1, i);
  }
  for (let first = 0; first < tokens.length;) {
    if (tokens[first]!.endMs > tokens[first]!.startMs) { first++; continue; }
    let end = first + 1;
    while (end < tokens.length && tokens[end]!.startMs === tokens[end]!.endMs) end++;
    const run = tokens.slice(first, end), point = run[0]!.startMs;
    const p = tokens[first - 1], n = tokens[end];
    const continuous = run.every((t, i) => t.startMs === point && (!i || adjacent(run[i - 1]!, t)));
    const valid = (t: TimingToken | undefined) => t && t.endMs > t.startMs && continuous && run.every(w => w.providerSentenceIndex === t.providerSentenceIndex);
    if (valid(p) && p!.endMs === point && adjacent(p!, run[0]!)) link(first - 1, end - 1);
    else if (valid(n) && n!.startMs === point && adjacent(run.at(-1)!, n!)) link(first, end);
    else fail();
    first = end;
  }
  const groups: TimingToken[][] = []; let active = 0;
  tokens.forEach((token, i) => { active += links[i]!; if (!i || !active) groups.push([]); groups.at(-1)!.push(token); });
  return groups.map((group, i) => {
    const positive = group.filter(t => t.endMs > t.startMs), zero = group.filter(t => t.endMs === t.startMs);
    if (!positive.length) fail();
    const head = zero.some(t => t.startMs === positive[0]!.startMs), tail = zero.some(t => t.startMs === positive[0]!.endMs);
    const mergeReason: NarrationSourceSpan['mergeReason'] = !zero.length ? group.length === 1 ? 'positive_native_token' : 'shared_source_span'
      : positive.length > 1 ? 'shared_source_span_with_zero_duration_members'
      : head && tail ? 'zero_duration_runs_attached_to_both_shared_endpoints' : head ? 'zero_duration_run_attached_to_next_shared_start' : 'zero_duration_run_attached_to_previous_shared_end';
    return { id: 'span:' + i, sourceStart: group[0]!.sourceStart, sourceEnd: group.at(-1)!.sourceEnd,
      startMs: Math.min(...group.map(t => t.startMs)), endMs: Math.max(...group.map(t => t.endMs)), tokenIds: group.map(t => t.id), mergeReason };
  });
}
function makeBoundaries(tokens: TimingToken[], spans: NarrationSourceSpan[], length: number, duration: number): NarrationBoundary[] {
  const raw = new Map<number, Set<number>>(), legal = new Map<number, Set<number>>();
  const add = (map: Map<number, Set<number>>, time: number, offset: number) => { const set = map.get(time) ?? new Set<number>(); set.add(offset); map.set(time, set); };
  for (const map of [raw, legal]) { add(map, 0, 0); add(map, duration, length); }
  for (let i = 1; i < tokens.length; i++) if (tokens[i - 1]!.sourceEnd <= tokens[i]!.sourceStart) add(raw, tokens[i]!.startMs, tokens[i]!.sourceStart);
  for (let i = 1; i < spans.length; i++) if (spans[i - 1]!.sourceEnd <= spans[i]!.sourceStart) add(legal, spans[i]!.startMs, spans[i]!.sourceStart);
  return [...legal].sort((a, b) => a[0] - b[0]).map(([time, offsets]) => {
    const edge = time === 0 || time === duration;
    const offset = time === 0 ? 0 : time === duration ? length : Math.max(...offsets);
    const rightIndex = time === duration ? tokens.length : tokens.findIndex(t => t.sourceStart === offset);
    return { id: 'boundary:' + time + ':' + offset, sourceOffset: offset, visualTimeMs: time,
      leftTokenId: time === 0 ? null : tokens[rightIndex - 1]?.id ?? null,
      rightTokenId: time === 0 ? tokens[0]!.id : tokens[rightIndex]?.id ?? null,
      ruleVersion: 'narration-boundaries/v1', rawCandidateSourceOffsets: [...raw.get(time)!].sort((a,b)=>a-b),
      legalCandidateSourceOffsets: [...offsets].sort((a,b)=>a-b), selectionReason: edge ? 'edge' : 'maximum_legal_source_offset' };
  });
}
/** 独立生产适配器：只处理同次供应商来源和原生端点，最终交由shared完整合同复验。 */
export function normalizeNarrationTiming(value: unknown): NarrationTimingMapV1 {
  try {
    const input = Input.parse(value);
    if (input.sentences.map(s => s.originalText).join('') !== input.sourceText) fail();
    const tokens: TimingToken[] = []; let sourceBase = 0;
    input.sentences.forEach((sentence, index) => {
      if (sentence.providerSentenceIndex !== index || sentence.words.map(w => w.text).join('') !== sentence.normalizedText) fail();
      const units = mapSentence(sentence.originalText, sentence.normalizedText, sourceBase); let cursor = 0;
      for (const word of sentence.words) {
        if (word.begin_index !== tokens.length || word.end_index !== word.begin_index + 1) fail();
        const letters = Array.from(word.text), members = units.slice(cursor, cursor + letters.length);
        if (!members.length || members.map(u => u.text).join('') !== word.text) fail();
        tokens.push({ id: 'token:' + tokens.length, sourceStart: members[0]!.sourceStart, sourceEnd: members.at(-1)!.sourceEnd,
          spokenText: word.text, startMs: word.begin_time, endMs: word.end_time, providerSentenceIndex: index,
          providerIndexRange: [word.begin_index, word.end_index] });
        cursor += letters.length;
      }
      if (cursor !== units.length) fail(); sourceBase += sentence.originalText.length;
    });
    const sourceSpans = makeSpans(tokens, input.sourceText);
    return NarrationTimingMapV1.parse({ schemaVersion: 'narration_timing_map_v1', sourceText: input.sourceText,
      spokenText: tokens.map(t => t.spokenText).join(''), textMappingVersion: 'narration-native-spans/v1',
      audioHash: input.audioHash, durationMs: input.durationMs, tokens, sourceSpans,
      boundaries: makeBoundaries(tokens, sourceSpans, input.sourceText.length, input.durationMs) });
  } catch { return fail(); }
}
