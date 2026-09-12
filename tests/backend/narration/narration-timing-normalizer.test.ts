import { describe, expect, it } from 'vitest';
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
