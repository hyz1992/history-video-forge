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
/** 与 shared 覆盖校验同源的静音判定：标点/分隔符/空白。供应商吞掉静音是合同允许的
 *  （token 不必覆盖标点），但吞掉正文（汉字/字母/数字）必须失败。 */
const SILENT_PATTERN = /^[\p{P}\p{Z}\s]*$/u;
/** 跳过静音的总量上限（防状态爆炸）。只在"单个 provider 句子含数百个连续静音 block"
 *  的病态输入上才会触顶；触顶 fail-closed 并输出 narration-align-limit 诊断。 */
const MAX_SILENT_SKIP = 256;
/** 逐层状态数上限：与基线（原逐层 DP 的 next.size > 4096）同构，保证 accept 集不比基线窄。
 *  超过即 fail-closed 并输出诊断。 */
const MAX_LAYER_STATES = 4096;
/** 全局状态数硬上限（内存保护）。逐层上限已覆盖正常输入，此项只用于拦病态输入。 */
const MAX_STATES = 2000000;
/** 原样grapheme及冻结的有限变换；每一候选必须与同次 normalized_text 精确相等。
 *  除白名单变换外，允许跳过静音 grapheme 作为未知标点改写的兜底：白名单候选成本 0、
 *  跳过成本 = 被跳过字符数，因此已知变体永远优先，跳过只在无零成本路径时启用。
 *  跳过总量受预算约束（仅防状态爆炸；安全边界由"仅静音"保证）。 */
function mapSentence(original: string, normalized: string, sourceBase: number): Unit[] {
  const parts = Array.from(segmenter.segment(original));
  const blocks: Choice[][] = [];
  /** 每 block 覆盖的原文范围（code unit，相对本句）与静音属性、长度：跳过成本与诊断都依赖它。 */
  const blockMeta: Array<{ silent: boolean; length: number; start: number; end: number }> = [];
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
      blockMeta.push({ silent: false, length: number.length, start: part.index, end });
      i = last - 1; continue;
    }
    if (part.segment === '—' && parts[i + 1]?.segment === '—') {
      // 供应商对"——"的归一化不稳定：资格期样本读成"，"，2026-09-15 实测读成单个"—"（三处各 -1 字）。
      // 保留全部已观测候选；归一化文本固定，同位置不同候选不会互相歧义。
      blocks.push([{ spoken: '——', units: [...choice('—', part.index, part.index + 1).units, ...choice('—', part.index + 1, part.index + 2).units] }, choice('，', part.index, part.index + 2), choice('—', part.index, part.index + 2)]);
      blockMeta.push({ silent: true, length: 2, start: part.index, end: part.index + 2 });
      i++; continue;
    }
    const choices = [choice(part.segment, part.index, part.index + part.segment.length)];
    if (part.segment === '\n' || part.segment === '\r\n') choices.push(choice('', part.index, part.index + part.segment.length));
    if (part.segment === '𠮷') choices.push(choice('吉', part.index, part.index + 2));
    if (part.segment === '〇') choices.push(choice('零', part.index, part.index + 1));
    blocks.push(choices);
    blockMeta.push({ silent: SILENT_PATTERN.test(part.segment), length: part.segment.length, start: part.index, end: part.index + part.segment.length });
  }
  // 不找子串、不做编辑距离。保留所有精确解析；同位置多个来源解析也算歧义。
  // 成本分层 Dijkstra：match 成本 0（白名单候选优先），跳过静音成本 = 该 block 字符数。
  // 成本上界天然 = 静音字符总数（只有静音可被跳过）；仅在极端标点密度下再夹一个绝对上限防状态爆炸。
  interface Path { blockIndex: number; offset: number; cost: number; previous?: Path; units: Unit[]; ambiguous: boolean; skipped?: string; }
  const silentTotal = blockMeta.reduce((sum, meta) => sum + (meta.silent ? meta.length : 0), 0);
  const budget = Math.min(silentTotal, MAX_SILENT_SKIP);
  const key = (blockIndex: number, offset: number) => blockIndex + ':' + offset;
  const settled = new Map<string, Path>();
  /** 按 blockIndex 统计每层 settle 状态数（逐层保护，与基线同构）。 */
  const layerStates = new Map<number, number>();
  const buckets: Path[][] = Array.from({ length: budget + 1 }, () => []);
  buckets[0]!.push({ blockIndex: 0, offset: 0, cost: 0, units: [], ambiguous: false });
  // 必须排空全部成本 ≤ 最优成本的节点后才判定：目标态 settle 后仍可能被同成本路径重复到达，
  // 提前 return 会漏掉该标记（基线逐层 DP 无此窗口）。
  const final = ((): Path | undefined => {
    let best: Path | undefined;
    for (let cost = 0; cost <= budget; cost += 1) {
      if (best && cost > best.cost) break;
      const bucket = buckets[cost]!;
      for (let head = 0; head < bucket.length; head += 1) {
        const node = bucket[head]!;
        const nodeKey = key(node.blockIndex, node.offset);
        const seen = settled.get(nodeKey);
        if (seen) { if (seen.cost === node.cost) seen.ambiguous = true; continue; }
        settled.set(nodeKey, node);
        const layerCount = (layerStates.get(node.blockIndex) ?? 0) + 1;
        layerStates.set(node.blockIndex, layerCount);
        if (layerCount > MAX_LAYER_STATES) { console.warn("[narration-align-limit]", JSON.stringify({ kind: "layer_limit", layer: node.blockIndex, count: layerCount, blocks: blocks.length })); fail(); }
        if (settled.size > MAX_STATES) { console.warn("[narration-align-limit]", JSON.stringify({ kind: "state_limit", states: settled.size, blocks: blocks.length })); fail(); }
        if (node.blockIndex === blocks.length) {
          if (node.offset === normalized.length && !best) best = node;
          continue;
        }
        const meta = blockMeta[node.blockIndex]!;
        const push = (next: Path, nextKey: string) => {
          const existing = settled.get(nextKey);
          // 已在 settled 的同成本副本必须当场标记歧义，不能因去重丢弃（否则同样漏检）。
          if (existing) { if (existing.cost === next.cost) existing.ambiguous = true; return; }
          buckets[next.cost]!.push(next);
        };
        for (const candidate of blocks[node.blockIndex]!) {
          if (!normalized.startsWith(candidate.spoken, node.offset)) continue;
          push({ blockIndex: node.blockIndex + 1, offset: node.offset + candidate.spoken.length,
            cost: node.cost, previous: node, units: candidate.units, ambiguous: node.ambiguous },
            key(node.blockIndex + 1, node.offset + candidate.spoken.length));
        }
        if (meta.silent && node.cost + meta.length <= budget) {
          push({ blockIndex: node.blockIndex + 1, offset: node.offset,
            cost: node.cost + meta.length, previous: node, units: [], ambiguous: node.ambiguous,
            skipped: original.slice(meta.start, meta.end) },
            key(node.blockIndex + 1, node.offset));
        }
      }
    }
    return best;
  })();
  if (!final) fail();
  const chunks: Unit[][] = [];
  const skipped: string[] = [];
  for (let node: Path | undefined = final; node; node = node.previous) {
    // 任一祖先有多条最优路径即歧义（与原实现同语义；回溯覆盖祖先的迟到标记）。
    if (node.ambiguous) fail();
    if (node.skipped !== undefined) skipped.push(node.skipped);
    chunks.push(node.units);
  }
  // 有限诊断：记录被跳过的静音片段（按文中顺序），用于观察供应商改写行为。
  if (skipped.length) console.warn("[narration-silent-skip]", JSON.stringify({ sentenceBase: sourceBase, skipped: skipped.reverse().slice(0, 8) }));
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
