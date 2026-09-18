import { describe, expect, it, vi } from 'vitest';
import { NarrationTimingMapV1 } from '../../../shared/src/index.js';
import { normalizeNarrationTiming, type NarrationTimingDiagnostic } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';
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
  it('单个2的口语位值读法两（实测 2万 被读成 两万）可追踪', () => {
    // 2026-09-17 live check t3 实测：供应商把 2万 归一化为 两万（3万 仍读 三万）。
    // 两 候选仅对单字符数字 2 提供；来源恒为该数字范围，token 时间不受影响。
    const events: NarrationTimingDiagnostic[] = [];
    const result = normalizeNarrationTiming(input('甲2万乙', '甲两万乙'), { onDiagnostic: e => events.push(e) });
    expect(result?.spokenText).toBe('甲两万乙');
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(result.tokens[1]).toMatchObject({ spokenText: '两', startMs: 250, endMs: 500 });
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    // 2/二/两 三候选互异，同一位置至多一个匹配，不产生同成本多解
    expect(events.map(e => e.kind)).not.toContain('tie_arbitrated');
    // 既有的二读法不受影响；多位数字不获得两候选（20 仍读 二十，不读 两十；02 前导零同样不获）
    expect(normalizeNarrationTiming(input('甲2万乙', '甲二万乙'))?.spokenText).toBe('甲二万乙');
    expect(normalizeNarrationTiming(input('甲20万乙', '甲二十万乙'))?.spokenText).toBe('甲二十万乙');
    expect(normalizeNarrationTiming(input('甲02乙', '甲零二乙'))?.spokenText).toBe('甲零二乙');
    // 同句多个 2 各自映射（两/二并存）
    const both = normalizeNarrationTiming(input('甲2千2百乙', '甲两千二百乙'));
    expect(both?.tokens.map(t => [t.spokenText, t.sourceStart, t.sourceEnd]))
      .toEqual([['甲', 0, 1], ['两', 1, 2], ['千', 2, 3], ['二', 3, 4], ['百', 4, 5], ['乙', 5, 6]]);
    // 来源数字非 2 时 normalized 的 两 无任何候选可消费，仍 fail-closed
    expect(() => normalizeNarrationTiming(input('甲3万乙', '甲两万乙'))).toThrow('narration_timing_invalid');
  });
  it('多位数字首位2的百/千位口语读两可追踪（实测 2000→两千万、200→两百两）', () => {
    // 2026-09-18 live check t8 实测：2000万 读 两千万、200两 读 两百两；而 20余万 读 二十余万
    //（十位不换）。位值形式首位"二"后跟 百/千/万/亿 时补"两"开头变体；逐位形式与二十不扩展。
    const events: NarrationTimingDiagnostic[] = [];
    const t8 = normalizeNarrationTiming(input('甲2000万乙', '甲两千万乙'), { onDiagnostic: e => events.push(e) });
    expect(t8?.spokenText).toBe('甲两千万乙');
    // 逐字符 word 下，两/千 各成一个 token 且共享整个数字块的来源范围（诚实映射）
    expect(t8.tokens[1]).toMatchObject({ spokenText: '两', sourceStart: 1, sourceEnd: 5 });
    expect(t8.tokens[2]).toMatchObject({ spokenText: '千', sourceStart: 1, sourceEnd: 5 });
    expect(t8.tokens[3]).toMatchObject({ spokenText: '万', sourceStart: 5, sourceEnd: 6 });
    // 变体与既有候选互斥匹配，不产生同成本多解
    expect(events.map(e => e.kind)).not.toContain('tie_arbitrated');
    expect(normalizeNarrationTiming(input('甲200两乙', '甲两百两乙'))?.spokenText).toBe('甲两百两乙');
    // 数字自带万组（区别于单字符 2 的显式候选路径）与万/亿组间形式
    expect(normalizeNarrationTiming(input('甲20000乙', '甲两万乙'))?.spokenText).toBe('甲两万乙');
    expect(normalizeNarrationTiming(input('甲200010000乙', '甲两亿零一万乙'))?.spokenText).toBe('甲两亿零一万乙');
    // 带内零与多位组合同样覆盖；一千不获两变体
    expect(normalizeNarrationTiming(input('甲2026乙', '甲两千零二十六乙'))?.spokenText).toBe('甲两千零二十六乙');
    expect(normalizeNarrationTiming(input('甲2100乙', '甲两千一百乙'))?.spokenText).toBe('甲两千一百乙');
    expect(normalizeNarrationTiming(input('甲1000乙', '甲一千乙'))?.spokenText).toBe('甲一千乙');
    // 既有的二读法与二十（十位不换）不受影响；前导零 run 不获变体
    expect(normalizeNarrationTiming(input('甲2000乙', '甲二千乙'))?.spokenText).toBe('甲二千乙');
    expect(normalizeNarrationTiming(input('甲200万乙', '甲二百万乙'))?.spokenText).toBe('甲二百万乙');
    expect(normalizeNarrationTiming(input('甲20万乙', '甲二十万乙'))?.spokenText).toBe('甲二十万乙');
    expect(normalizeNarrationTiming(input('甲02乙', '甲零二乙'))?.spokenText).toBe('甲零二乙');
    // 逐位形式不获两变体；来源非 2 开头时 两 开头读法仍 fail-closed
    expect(() => normalizeNarrationTiming(input('甲2026乙', '甲两零二六乙'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲1000乙', '甲两千乙'))).toThrow('narration_timing_invalid');
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
  it('重复相同标点折叠为单个时给出确定性映射（不依赖仲裁）', () => {
    // 供应商把重复标点读成单个（……→…、——→—、！！→！）：折叠是原子候选，
    // 整个 run 由单字符代表，映射不由"先被 settle 的路径"决定（2026-09-17 起同成本多解走仲裁而非拒绝）。
    for (const [source, spoken] of [['甲……乙', '甲…乙'], ['甲！！乙', '甲！乙'], ['甲？？乙', '甲？乙'], ['甲。。。乙', '甲。乙']] as const) {
      const result = normalizeNarrationTiming(input(source, spoken));
      expect(result?.spokenText, source).toBe(spoken);
      // 折叠后的 unit 覆盖整个 run（token 区间跨过被折叠的重复标点）
      expect(result.tokens[1]?.sourceStart, source).toBe(1);
      expect(NarrationTimingMapV1.safeParse(result).success, source).toBe(true);
    }
  });
  it('重复空白折叠同样确定性（\\n\\n → \\n）', () => {
    const result = normalizeNarrationTiming(input('甲\n\n乙', '甲\n乙'));
    expect(result?.spokenText).toBe('甲\n乙');
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
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
  it('诊断回调收到跳过与限流事件（供离线落盘复盘）', () => {
    const events: Array<{ kind: string; skipped?: string[]; budget?: number }> = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      normalizeNarrationTiming(input('甲——乙。丙', '甲乙丙'), { onDiagnostic: (e) => events.push(e) });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: 'silent_skip', skipped: ['——', '。'] });
      events.length = 0;
      expect(() => normalizeNarrationTiming(input('甲' + '。'.repeat(300) + '乙', '甲乙'), { onDiagnostic: (e) => events.push(e) })).toThrow();
      expect(events.map(e => e.kind)).toContain('skip_budget');
    } finally { warn.mockRestore(); }
  });
  it('诊断回调抛错不影响对齐结果', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = normalizeNarrationTiming(input('甲。乙', '甲乙'), { onDiagnostic: () => { throw new Error('落盘失败'); } });
      expect(result?.spokenText).toBe('甲乙');
    } finally { warn.mockRestore(); }
  });
  it('CRLF 归一为 LF 也可追踪（相邻折叠形态）', () => {
    const result = normalizeNarrationTiming(input('甲\r\n乙', '甲\n乙'));
    expect(result?.spokenText).toBe('甲\n乙');
    expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [1, 3], [3, 4]]);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it('CRLF 由成本 0 的空候选匹配，不触发静音跳过记账', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = normalizeNarrationTiming(input('甲\r\n乙', '甲乙'));
      expect(result.tokens.map(t => [t.sourceStart, t.sourceEnd])).toEqual([[0, 1], [3, 4]]);
      expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
      expect(warn.mock.calls.filter(c => String(c[0]).includes('narration-silent-skip'))).toHaveLength(0);
    } finally { warn.mockRestore(); }
  });
  it('CRLF run（空行分段）原样返回不再整篇失败', () => {
    // 折叠复合候选曾按 1 grapheme = 1 code unit 取范围：`\r\n` 是长度 2 的单个 grapheme，
    // 按 +1 取会让 token 区间切在 grapheme 内部（[1,2]/[3,4]），被 shared 合同的切点校验拒绝。
    const source = '甲\r\n\r\n乙';
    const result = normalizeNarrationTiming(input(source));
    expect(result?.sourceText).toBe(source);
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    const cuts = new Set<number>([0, source.length]);
    for (const part of new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(source)) cuts.add(part.index);
    for (const token of result.tokens) {
      expect(cuts.has(token.sourceStart)).toBe(true);
      expect(cuts.has(token.sourceEnd)).toBe(true);
    }
  });
  it('静音量超绝对上限时 fail-closed 并输出 skip_budget 诊断', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const source = '甲' + '。'.repeat(300) + '乙';
      expect(() => normalizeNarrationTiming(input(source, '甲乙'))).toThrow('narration_timing_invalid');
      const limit = warn.mock.calls.filter(c => String(c[0]).includes('narration-align-limit'));
      expect(limit).toHaveLength(1);
      expect(JSON.parse(String(limit[0]![1]))).toMatchObject({ kind: 'skip_budget', silentTotal: 300 });
    } finally { warn.mockRestore(); }
  });
  it('病态超长输入不会挂死（有界失败）', () => {
    // 状态/逐层上限为防御性保护：折叠候选消除零进度前沿后，构造上极难触顶；
    // 本用例只断言极端输入下仍是有界失败而非挂死。
    const source = '甲' + '。、'.repeat(4000) + '乙';
    const started = Date.now();
    expect(() => normalizeNarrationTiming(input(source, '甲乙'))).toThrow('narration_timing_invalid');
    expect(Date.now() - started).toBeLessThan(10000);
  });
  it('白名单匹配与静音跳过竞争时取成本 0 的白名单路径', () => {
    // '。' 既可被 match（成本 0）也可被跳过（成本 1）；该输入的最优解唯一，故不走仲裁
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

it('重复换行折叠为单个换行（确定性映射，不再按歧义拒绝）',()=>{
  // 语义演进（2026-09-15 折叠候选）：`\n\n` 是相同静音字符 run，折叠候选给出
  // 确定性 tie-break（整个 run 由单个换行代表），故映射唯一、可接受。
  const result = normalizeNarrationTiming(input('甲\n\n乙','甲\n乙'));
  expect(result?.spokenText).toBe('甲\n乙');
  expect(result.tokens[0]?.sourceStart).toBe(0);
  expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
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

describe('静音受控替换（供应商未知标点改写）', () => {
  it.each([['——', '；'], ['——', '，'], ['——', '！'], ['。', '，'], ['！', '？'], ['，', '、']])(
    '%s 被读成 %s 可追踪且来源指向原标点范围',
    (source, target) => {
      const result = normalizeNarrationTiming(input('甲' + source + '乙', '甲' + target + '乙'));
      expect(result?.spokenText).toBe('甲' + target + '乙');
      expect(result.tokens[1]!.sourceStart).toBe(1);
      expect(result.tokens[1]!.sourceEnd).toBe(1 + source.length);
      expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    },
  );
  it('全角↔半角与其他常见静音目标同样可追踪', () => {
    for (const [source, target] of [['。', '.'], ['——', ','], ['。', '?'], ['，', ';'], ['，', '\u3000'], ['——', '〜'], ['。', '\t']] as const) {
      const result = normalizeNarrationTiming(input('甲' + source + '乙', '甲' + target + '乙'));
      expect(result?.spokenText, source + '->' + target).toBe('甲' + target + '乙');
      expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    }
  });
  it('替换不放宽正文与插入边界', () => {
    expect(() => normalizeNarrationTiming(input('甲乙丙', '甲乙'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲乙', '甲，乙'))).toThrow('narration_timing_invalid');
  });
  it('白名单与折叠仍按成本 0 优先于替换', () => {
    const whitelist = normalizeNarrationTiming(input('甲——乙', '甲—乙'));
    expect(whitelist.tokens[1]!.sourceEnd).toBe(3);
    const dash = normalizeNarrationTiming(input('甲——乙', '甲，乙'));
    expect(dash.tokens[1]!.sourceEnd).toBe(3);
  });
});

describe('同成本多解确定性仲裁', () => {
  it('两个不同标点竞争同一目标时仲裁通过，不再整篇失败', () => {
    const events: NarrationTimingDiagnostic[] = [];
    const result = normalizeNarrationTiming(input('甲。、乙', '甲，乙'), { onDiagnostic: e => events.push(e) });
    // 正文源位置与原生时间不受仲裁影响（多解差异只落在静音区；含标点的粘合 token 见下一条用例）
    expect(result.tokens[0]).toMatchObject({ sourceStart: 0, sourceEnd: 1, startMs: 0, endMs: 250 });
    expect(result.tokens[2]).toMatchObject({ sourceStart: 3, sourceEnd: 4, startMs: 500, endMs: 750 });
    // ，的来源必须是 。 或 、 的整块范围之一，不允许被挪到正文位置
    expect([[1, 2], [2, 3]]).toContainEqual([result.tokens[1]!.sourceStart, result.tokens[1]!.sourceEnd]);
    expect(result.tokens[1]).toMatchObject({ startMs: 250, endMs: 500 });
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    expect(events.map(e => e.kind)).toContain('tie_arbitrated');
  });
  it('仲裁结果确定可重放（同一输入两次运行逐字节一致）', () => {
    expect(JSON.stringify(normalizeNarrationTiming(input('甲。、乙', '甲，乙'))))
      .toBe(JSON.stringify(normalizeNarrationTiming(input('甲。、乙', '甲，乙'))));
  });
  it('无多解时不产出仲裁诊断', () => {
    const events: NarrationTimingDiagnostic[] = [];
    normalizeNarrationTiming(input('甲，乙'), { onDiagnostic: e => events.push(e) });
    expect(events.map(e => e.kind)).not.toContain('tie_arbitrated');
  });
  it('仲裁诊断带完整负载与专用警告前缀', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events: NarrationTimingDiagnostic[] = [];
      normalizeNarrationTiming(input('甲。、乙', '甲，乙'), { onDiagnostic: e => events.push(e) });
      const tie = events.find(e => e.kind === 'tie_arbitrated');
      expect(tie).toMatchObject({ sentenceBase: 0, blocks: 4, ties: 1, cost: 3 });
      expect(tie!.arbitratedAt!.length).toBeGreaterThan(0);
      const logged = warn.mock.calls.filter(c => String(c[0]).includes('narration-tie-arbitrated'));
      expect(logged).toHaveLength(1);
      expect(JSON.parse(String(logged[0]![1]))).toMatchObject({ kind: 'tie_arbitrated' });
    } finally { warn.mockRestore(); }
  });
  it('仲裁不得把正文 unit 挪到别的 block（第 j 个正文字符仍落在第 j 个正文源位置，时间仍取原生端点）', () => {
    // 对抗断言：正文位置与正文 block 逐一对应、且时间逐字对齐原生端点，是"放宽不影响正文映射"的直接守卫。
    // 下标按 UTF-16 code unit 累计（不能用 Array.from 的码点下标，否则非 BMP 字符会算错）。
    for (const [source, spoken] of [['甲。、乙', '甲，乙'], ['甲。、；乙', '甲，乙'], ['甲。、；，乙', '甲，乙']] as const) {
      const result = normalizeNarrationTiming(input(source, spoken));
      const isSilent = (text: string) => /^[\p{P}\p{Z}\s]*$/u.test(text);
      const bodySource: number[][] = [];
      for (let i = 0; i < source.length; i += 1) if (!isSilent(source[i]!)) bodySource.push([i, i + 1]);
      const bodyTokens = result.tokens.filter(t => !isSilent(t.spokenText));
      expect(bodyTokens.map(t => [t.sourceStart, t.sourceEnd]), source).toEqual(bodySource);
      // 时间：第 k 个 normalized 字符的 word 端点为 [k*250, (k+1)*250]（见 input()），与路径无关
      let bodyCursor = 0;
      for (let i = 0; i < spoken.length; i += 1) {
        if (isSilent(spoken[i]!)) continue;
        const token = bodyTokens[bodyCursor++]!;
        expect([token.startMs, token.endMs], `${source} @${i}`).toEqual([i * 250, (i + 1) * 250]);
      }
    }
  });
  it('三个以上标点竞争同一目标时同样仲裁而非失败', () => {
    // 最优成本 4 由三条等成本路径共享（替换 。／替换 、／替换 ；），故必然产出仲裁
    const events: NarrationTimingDiagnostic[] = [];
    const run = () => normalizeNarrationTiming(input('甲。、；乙', '甲，乙'), { onDiagnostic: e => events.push(e) });
    const result = run();
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    expect(events.map(e => e.kind)).toContain('tie_arbitrated');
    // 不断言"哪条兄弟读法胜出"（那是纯重构也会翻的白盒断言），只断言：
    // 标点的来源必须落在参与竞争的静音块之一，且两次运行逐字节一致。
    expect([[1, 2], [2, 3], [3, 4]]).toContainEqual([result.tokens[1]!.sourceStart, result.tokens[1]!.sourceEnd]);
    expect(JSON.stringify(run())).toBe(JSON.stringify(result));
  });
  it('供应商 word 把标点粘在正文上时，仲裁只移动静音归属、不动正文源位置', () => {
    // 真实供应商切分形如 `，乙` 或 `甲，`（一个 word 含标点+正文）：实测已发布 470 字工件的 424 个
    // token 中有 42 个 sourceStart 落在标点上。此类 token 的区间端点会随仲裁在静音区内移动
    //（头部粘合移动起点、尾部粘合移动终点），因此断言写成"静音区包络"：
    // token 区间必须夹在相邻正文字符之间，任何静音 token 不得占用正文字符的源位置。
    const cases: Array<[string, string[], string]> = [
      ['甲。、乙', ['甲', '，', '乙'], '甲，乙'],   // 全静音 token（无粘合）
      ['甲。、乙', ['甲', '，乙'], '甲，乙'],        // 尾部粘合
      ['甲。、乙', ['甲，', '乙'], '甲，乙'],        // 头部粘合（终点可移动）
      ['甲。、；乙', ['甲', '，乙'], '甲，乙'],      // 三标点竞争 + 尾部粘合
      ['甲。乙', ['甲', '，乙'], '甲，乙'],          // 对照：无仲裁（唯一路径）
    ];
    for (const [source, words, spoken] of cases) {
      const value = { sourceText: source, durationMs: words.length * 250, audioHash: hash,
        sentences: [{ providerSentenceIndex: 0, originalText: source, normalizedText: spoken,
          words: words.map((text, i) => ({ text, begin_index: i, end_index: i + 1, begin_time: i * 250, end_time: (i + 1) * 250 })) }] };
      const result = normalizeNarrationTiming(value);
      expect(NarrationTimingMapV1.safeParse(result).success, source).toBe(true);
      const isSilent = (text: string) => /^[\p{P}\p{Z}\s]*$/u.test(text);
      // 正文源位置：逐个非静音字符的码元下标（按 UTF-16 累计，非 BMP 亦正确）
      const bodySource: number[] = [];
      for (let i = 0; i < source.length; i += 1) if (!isSilent(source[i]!)) bodySource.push(i);
      let bodyCursor = 0;
      for (const token of result.tokens) {
        const label = `${source} ${token.spokenText}`;
        const spokenBody = Array.from(token.spokenText).filter(ch => !isSilent(ch)).length;
        if (spokenBody === 0) { // 纯静音 token 只能落在静音区，不得占用任何正文源位置
          expect(bodySource.includes(token.sourceStart), label).toBe(false);
          expect(bodySource.includes(token.sourceEnd - 1), label).toBe(false);
          continue;
        }
        const first = bodySource[bodyCursor]!, last = bodySource[bodyCursor + spokenBody - 1]!;
        const lo = bodyCursor === 0 ? 0 : bodySource[bodyCursor - 1]! + 1;
        const hi = bodyCursor + spokenBody < bodySource.length ? bodySource[bodyCursor + spokenBody]! : source.length;
        // 起点可前移到前导标点，但不得越过本 token 首个正文字符
        expect(token.sourceStart >= lo && token.sourceStart <= first, `${label} start`).toBe(true);
        // 终点可后移到后继标点，但不得越过本 token 末个正文字符
        expect(token.sourceEnd >= last + 1 && token.sourceEnd <= hi, `${label} end`).toBe(true);
        bodyCursor += spokenBody;
      }
      // 全部正文字符都被 token 覆盖，无遗漏
      expect(bodyCursor, source).toBe(bodySource.length);
    }
  });
  it('run 折叠通道的同成本多解同样仲裁（可复现的残余风险守卫）', () => {
    // source 的两段连续句号 run 与 normalized 的单 run 之间存在两条等成本读法：
    // 第 4 个 。 可归给第一段 run 的整块范围 [3,4)，也可归给第二段 run 的复合范围 [5,8)。
    const value = { sourceText: '甲。。。、。。。乙', durationMs: 6 * 250, audioHash: 'a'.repeat(64),
      sentences: [{ providerSentenceIndex: 0, originalText: '甲。。。、。。。乙', normalizedText: '甲。。。。乙',
        words: Array.from('甲。。。。乙').map((text, i) => ({ text, begin_index: i, end_index: i + 1,
          begin_time: i * 250, end_time: (i + 1) * 250 })) }] };
    const events: NarrationTimingDiagnostic[] = [];
    const result = normalizeNarrationTiming(value, { onDiagnostic: e => events.push(e) });
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    expect(events.map(e => e.kind)).toContain('tie_arbitrated');
    // 正文仍留在自身位置，被仲裁的只是静音 run 的归属
    expect(result.tokens[0]).toMatchObject({ sourceStart: 0, sourceEnd: 1 });
    expect(result.tokens.at(-1)).toMatchObject({ sourceStart: 8, sourceEnd: 9 });
    expect(result.tokens[4]!.sourceStart).toBeGreaterThanOrEqual(3);
    expect(result.tokens[4]!.sourceEnd).toBeLessThanOrEqual(8);
  });
});

describe('正文单字等长替换（供应商同音/形近归一化）', () => {
  it('生僻字被归一化为常用字可追踪（实测 怛罗斯→达罗斯）', () => {
    const result = normalizeNarrationTiming(input('在怛罗斯河畔撞上', '在达罗斯河畔撞上'));
    expect(result?.spokenText).toBe('在达罗斯河畔撞上');
    expect(result?.sourceText).toBe('在怛罗斯河畔撞上');
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
    // 来源仍指向原文位置：字幕与切片保持原文写法
    expect(result.tokens[1]!.sourceStart).toBe(1);
  });
  it('多处等长替换与标点混合仍可对齐', () => {
    const result = normalizeNarrationTiming(input('东进——怛罗斯', '东进，达罗斯'));
    expect(result?.spokenText).toBe('东进，达罗斯');
    expect(NarrationTimingMapV1.safeParse(result).success).toBe(true);
  });
  it('正文替换不放宽漏读与新增', () => {
    expect(() => normalizeNarrationTiming(input('甲乙丙', '甲乙'))).toThrow('narration_timing_invalid');
    expect(() => normalizeNarrationTiming(input('甲乙', '甲丙丁'))).toThrow('narration_timing_invalid');
  });
});
