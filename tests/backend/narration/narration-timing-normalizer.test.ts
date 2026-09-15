import { describe, expect, it, vi } from 'vitest';
import { NarrationTimingMapV1 } from '../../../shared/src/index.js';
import { normalizeNarrationTiming } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';
const hash = 'a'.repeat(64);
function input(sourceText: string, spoken = sourceText, times?: number[][]) {
  const words = Array.from(spoken).map((text, i) => ({ text, begin_index: i, end_index: i + 1,
    begin_time: times?.[i]?.[0] ?? i * 250, end_time: times?.[i]?.[1] ?? (i + 1) * 250 }));
  return { sourceText, durationMs: Math.max(1, ...words.map(w => w.end_time)), audioHash: hash,
    sentences: [{ providerSentenceIndex: 0, originalText: sourceText, normalizedText: spoken, words }] };
}
describe('原生时间归一化', () => {
  it('18个250ms字保留第6字之后1500ms切点及全部内部切点', () => {
    const result = normalizeNarrationTiming(input('甲'.repeat(18)));
    expect(result?.boundaries).toHaveLength(19);
    expect(result.boundaries[6]).toMatchObject({ sourceOffset: 6, visualTimeMs: 1500 });
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it.each([['12', '十二'], ['1024', '一千零二十四'], ['2026', '二零二六'], ['0', '零'], ['10010', '一万零一十'], ['12十二12', '十二十二十二'], ['A、B𠮷——3\n', 'A、B吉，三'], ['公元九六〇年', '公元九六零年']])('有限规范化%s可追踪', (source, spoken) => {
    const result = normalizeNarrationTiming(input(source, spoken));
    expect(result?.sourceText).toBe(source);
    expect(result.spokenText).toBe(spoken);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it('多个数字token共一source且无内部切点', () => {
    const result = normalizeNarrationTiming(input('12', '十二'));
    expect(result?.tokens.map(t => [t.sourceStart,t.sourceEnd])).toEqual([[0,2],[0,2]]);
    expect(result.sourceSpans).toHaveLength(1);
    expect(result.boundaries.map(b => b.visualTimeMs)).toEqual([0,500]);
  });
  it('组合字符和代理对不被边界拆开', () => {
    const result = normalizeNarrationTiming(input('e\u0301😀'));
    expect(result?.tokens.map(t=>[t.sourceStart,t.sourceEnd])).toEqual([[0,2],[0,2],[2,4]]);
    expect(result.boundaries.map(b=>b.sourceOffset)).toEqual([0,2,4]);
  });
  it('重复句按原生序号及逐句原文定位', () => {
    const value = input('甲。甲。');
    value.sentences = [0,1].map(i => ({providerSentenceIndex:i,originalText:'甲。',normalizedText:'甲。',words:value.sentences[0].words.slice(i*2,i*2+2)}));
    expect(normalizeNarrationTiming(value)?.tokens.map(t=>t.sourceStart)).toEqual([0,1,2,3]);
  });
  it('零点共享端点前侧优先且不改变token时间', () => {
    const value=input('甲乙丙','甲乙丙',[[0,250],[250,250],[250,500]]);
    const result=normalizeNarrationTiming(value);
    expect(result?.sourceSpans[0].tokenIds).toEqual(['token:0','token:1']);
    expect(result.tokens[1]).toMatchObject({startMs:250,endMs:250});
    expect(result.boundaries.map(b=>b.sourceOffset)).toEqual([0,2,3]);
  });
  it.each(['乙','', '甲甲'])('未验证正文替换/删除/增加拒绝：%s', spoken => {
    expect(()=>normalizeNarrationTiming(input('甲',spoken))).toThrow('narration_timing_invalid');
  });
  it.each([null,{}, {sourceText:'甲',sentences:[]}, { ...input('甲'), audioHash:'bad' }])('外部畸形输入统一错误', value=>{
    expect(()=>normalizeNarrationTiming(value)).toThrow('narration_timing_invalid');
  });
  it.each([
    (v: ReturnType<typeof input>)=>{v.sentences[0].words[0].begin_index=2;},
    (v: ReturnType<typeof input>)=>{v.sentences[0].words[1].begin_time=1;},
    (v: ReturnType<typeof input>)=>{v.sentences[0].words[0].end_time=9999;},
    (v: ReturnType<typeof input>)=>{v.sentences[0].originalText='错误';},
    (v: ReturnType<typeof input>)=>{v.sentences[0].normalizedText='错误';},
  ])('拒绝索引、时间或来源污染', change=>{
    const value=input('甲乙');change(value);expect(()=>normalizeNarrationTiming(value)).toThrow('narration_timing_invalid');
  });
  it.each([[[[0,0],[0,0]]],[[[0,250],[300,300]]]])('不能归属的零点拒绝', times=>{
    expect(()=>normalizeNarrationTiming(input('甲乙','甲乙',times))).toThrow('narration_timing_invalid');
  });
});

it('原样双破折号保持每个grapheme的独立来源',()=>{
  const result=normalizeNarrationTiming(input('——'));
  expect(result.tokens.map(t=>[t.sourceStart,t.sourceEnd])).toEqual([[0,1],[1,2]]);
});
it('供应商把双破折号读成单破折号也可追踪',()=>{
  // 2026-09-15 实测：三处"——"被供应商归一化为单个"—"，每处 -1 字
  const result=normalizeNarrationTiming(input('甲——乙','甲—乙'));
  expect(result?.spokenText).toBe('甲—乙');
  expect(result.tokens.map(t=>[t.sourceStart,t.sourceEnd])).toEqual([[0,1],[1,3],[3,4]]);
  expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
});

describe('静音容错对齐（供应商吞标点的未知变体无需再补白名单）', () => {
  it('白名单未覆盖的静音改写：句号/顿号/引号被吞仍可追踪', () => {
    // 这些变体不在白名单中，只有"跳过静音 grapheme"能对齐
    const cases: Array<[string, string]> = [['甲乙。丙丁', '甲乙丙丁'], ['甲、乙', '甲乙'], ['甲"乙"丙', '甲乙丙'], ['甲（乙）丙', '甲乙丙']];
    for (const [source, spoken] of cases) {
      const result = normalizeNarrationTiming(input(source, spoken));
      expect(result?.spokenText, source).toBe(spoken);
      expect(result?.sourceText, source).toBe(source);
      expect(NarrationTimingMapV1.safeParse(result).success, source).toBe(true);
      // 被吞标点留下"静音空档"（不被 token 覆盖），由 shared 覆盖检查放行；token 区间仍覆盖到全文末尾
      expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd]).at(-1)![1], source).toBe(source.length);
    }
  });
  it('多处置标点被吞（模拟真实 470 字文案三处 —— 场景）', () => {
    const source = '甲——乙——丙——丁';
    const result = normalizeNarrationTiming(input(source, '甲—乙—丙—丁'));
    expect(result?.spokenText).toBe('甲—乙—丙—丁');
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd]).at(-1)![1]).toBe(source.length);
  });
  it('吞正文汉字必须失败（容错不放宽到内容层）', () => {
    expect(() => normalizeNarrationTiming(input('甲乙丙', '甲乙'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲乙丙', '甲丙'))).toThrow('narration_timing_invalid');
  });
  it('末尾等成本多路径必须拒绝（不得因提前收敛而放行）', () => {
    // 这些输入存在两条同成本最优对齐（静音归前/归后），基线逐层 DP 拒绝，容错实现必须保持
    expect(() => normalizeNarrationTiming(input('甲\n\n', '甲\n'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲乙\n\n', '甲乙\n'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲。。', '甲。'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲……', '甲…'))).toThrow('narration_timing_invalid');
    // 中段同结构（既有对抗用例的对照）
    expect(() => normalizeNarrationTiming(input('甲\n\n乙', '甲\n乙'))).toThrow('narration_timing_invalid');
  });
  it('白名单无法匹配时由跳过兜底（整块 —— 被吞）', () => {
    const result = normalizeNarrationTiming(input('甲——乙', '甲乙'));
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [3, 4]]);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it('诊断payload记录被跳过的静音片段而非正文', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      normalizeNarrationTiming(input('甲——乙。丙', '甲乙丙'));
      const payload = warn.mock.calls.filter(c => String(c[0]).includes('narration-silent-skip'));
      expect(payload).toHaveLength(1);
      // 非对称片段 + 文中顺序（—— 在 。 之前）
      expect(JSON.parse(String(payload[0]![1]))).toMatchObject({ skipped: ['——', '。'] });
    } finally { warn.mockRestore(); }
  });
  it('CRLF 静音跳过按其 code unit 长度记账', () => {
    const result = normalizeNarrationTiming(input('甲\r\n乙', '甲乙'));
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [3, 4]]);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it('静音量超绝对上限时 fail-closed 并输出 skip_budget 诊断', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = '甲' + '。'.repeat(300) + '乙';
      expect(() => normalizeNarrationTiming(input(source, '甲乙'))).toThrow('narration_timing_invalid');
      const limit = warn.mock.calls.filter(c => String(c[0]).includes('narration-align-limit'));
      expect(limit).toHaveLength(1);
      expect(JSON.parse(String(limit[0]![1]))).toMatchObject({ kind: 'skip_budget', budget: 256 });
    } finally { warn.mockRestore(); }
  });
  it('DP 状态超全局上限时 fail-closed 并输出 state_limit 诊断', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 单句 2000 个连续换行：零进度前沿使累计状态越过全局上限（病态输入，方向 fail-closed）
      const source = '\n'.repeat(2000) + '甲';
      expect(() => normalizeNarrationTiming(input(source, source))).toThrow('narration_timing_invalid');
      const limit = warn.mock.calls.filter(c => String(c[0]).includes('narration-align-limit'));
      expect(limit.length).toBeGreaterThanOrEqual(1);
      expect(JSON.parse(String(limit[0]![1]))).toMatchObject({ kind: 'state_limit' });
    } finally { warn.mockRestore(); }
  });
  it('白名单匹配与静音跳过竞争时取成本 0 的白名单路径', () => {
    // '。' 既可被 match（成本 0）也可被跳过（成本 1）；两处都是 match 才唯一最优
    const result = normalizeNarrationTiming(input('甲。\n乙', '甲。乙'));
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [1, 2], [3, 4]]);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it('数字被吞同样失败（长数字读法不在容错范围）', () => {
    expect(() => normalizeNarrationTiming(input('甲123乙', '甲12乙'))).toThrow('narration_timing_invalid');
  });
  it('白名单路径优先于跳过（成本 0 优先，已知变体不受影响）', () => {
    // 〇 有白名单候选（成本 0）；〇 不属静音类，故此处只验证白名单命中与逐字来源
    const result = normalizeNarrationTiming(input('甲〇乙', '甲零乙'));
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });
  it('规模回归：真实量级长文的标点被系统吞掉仍可对齐（性能上限）', () => {
    let source = '';
    while (source.length < 470) source += '甲乙丙丁戊己庚辛壬癸，';
    source = source.slice(0, 470);
    const spoken = source.replace(/，/gu, '');
    const started = Date.now();
    const result = normalizeNarrationTiming(input(source, spoken));
    const elapsed = Date.now() - started;
    expect(result?.sourceText).toBe(source);
    expect(result.spokenText).toBe(spoken);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd]).at(-1)![1]).toBe(source.length);
    expect(elapsed).toBeLessThan(3000);
  });
});

it('多个合法换行解析对应不同source span时拒绝歧义',()=>{
  expect(()=>normalizeNarrationTiming(input('甲\n\n乙','甲\n乙'))).toThrow('narration_timing_invalid');
});
it('跨句零点不能接到前句共享端点',()=>{
  const value=input('甲乙','甲乙',[[0,250],[250,250]]);
  value.sentences=[{...value.sentences[0],originalText:'甲',normalizedText:'甲',words:[value.sentences[0].words[0]]},{providerSentenceIndex:1,originalText:'乙',normalizedText:'乙',words:[value.sentences[0].words[1]]}];
  expect(()=>normalizeNarrationTiming(value)).toThrow('narration_timing_invalid');
});
it('同source的正零正token闭包不抬高零时长',()=>{
  const result=normalizeNarrationTiming(input('102','一百零二',[[0,100],[100,100],[100,200],[200,300]]));
  expect(result.tokens[1]).toMatchObject({startMs:100,endMs:100});
  expect(result.sourceSpans).toHaveLength(1);expect(result.boundaries).toHaveLength(2);
});
