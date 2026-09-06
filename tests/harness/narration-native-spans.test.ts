import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

async function api() {
  expect(existsSync('harness/scripts/runtime/narration-native-spans.ts'), '独立原生片段适配入口必须存在').toBe(true);
  return import('../../harness/scripts/runtime/narration-native-spans.js');
}

const token = (text: string, ordinal: number, start: number, end: number, sentence = 0) => ({
  text,
  begin_index: ordinal,
  end_index: ordinal + 1,
  begin_time: start,
  end_time: end,
  providerSentenceIndex: sentence,
});

const build = (tokens: unknown[], sourceText = (tokens as Array<{ text: string }>).map((row) => row.text).join(''), durationMs = 1000, extra = {}) => ({
  sourceText,
  durationMs,
  tokens,
  ...extra,
});

describe('原生零时长 token 片段适配', () => {
  it('中部零点优先附前一个共享结束点片段，并完整保留 raw 成员', async () => {
    const q = await api();
    const input = build([token('起', 0, 0, 240), token('了', 1, 240, 240), token('风', 2, 240, 500)], '起了风', 500);
    const before = JSON.stringify(input);
    const result = q.buildNarrationNativeSpans(input);

    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]).toMatchObject({
      start_ms: 0,
      end_ms: 240,
      source_start: 0,
      source_end: 2,
      provider_index_range: { begin_index: 0, end_index: 2 },
      merge_reason: 'zero_duration_run_attached_to_previous_shared_end',
      raw_summary: { token_count: 2, zero_duration_token_count: 1, text: '起了', start_ms: 0, end_ms: 240 },
    });
    expect(result.spans[0].members).toEqual([
      { ordinal: 0, text: '起', begin_index: 0, end_index: 1, begin_time: 0, end_time: 240, provider_sentence_index: 0, source_start: 0, source_end: 1 },
      { ordinal: 1, text: '了', begin_index: 1, end_index: 2, begin_time: 240, end_time: 240, provider_sentence_index: 0, source_start: 1, source_end: 2 },
    ]);
    expect(result.boundaries.map(({ time_ms, source_offset }: any) => ({ time_ms, source_offset }))).toEqual([
      { time_ms: 0, source_offset: 0 },
      { time_ms: 240, source_offset: 2 },
      { time_ms: 500, source_offset: 3 },
    ]);
    expect(result.qualification).toBe('unverified');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('首部零点没有前片段时附后一个共享起点片段', async () => {
    const q = await api();
    const result = q.buildNarrationNativeSpans(build([token('开', 0, 0, 0), token('始', 1, 0, 300)], '开始', 300));
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({ start_ms: 0, end_ms: 300, source_start: 0, source_end: 2, merge_reason: 'zero_duration_run_attached_to_next_shared_start' });
  });

  it('末部零点附前一个共享结束点片段', async () => {
    const q = await api();
    const result = q.buildNarrationNativeSpans(build([token('结', 0, 0, 300), token('束', 1, 300, 300)], '结束', 300));
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({ start_ms: 0, end_ms: 300, source_start: 0, source_end: 2, merge_reason: 'zero_duration_run_attached_to_previous_shared_end' });
  });

  it('连续零点作为整体按前片段优先规则处理', async () => {
    const q = await api();
    const result = q.buildNarrationNativeSpans(build([
      token('甲', 0, 0, 200), token('乙', 1, 200, 200), token('丙', 2, 200, 200), token('丁', 3, 200, 500),
    ], '甲乙丙丁', 500));
    expect(result.spans.map((span: any) => span.members.map((member: any) => member.text).join(''))).toEqual(['甲乙丙', '丁']);
    expect(result.spans[0].raw_summary.zero_duration_token_count).toBe(2);
  });

  it('同一正时长词两侧吸收零点时明确记录双侧归并', async () => {
    const q = await api();
    const result = q.buildNarrationNativeSpans(build([
      token('前', 0, 0, 0), token('中', 1, 0, 300), token('后', 2, 300, 300),
    ], '前中后', 300));
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0].merge_reason).toBe('zero_duration_runs_attached_to_both_shared_endpoints');
  });

  it.each([
    ['前后都不共享端点', [token('甲', 0, 0, 100), token('乙', 1, 150, 150), token('丙', 2, 200, 300)], 'native_zero_duration_unattachable'],
    ['跨供应商句', [token('甲', 0, 0, 100, 0), token('乙', 1, 100, 100, 1), token('丙', 2, 100, 300, 2)], 'native_zero_duration_cross_sentence'],
    ['孤立零点', [token('甲', 0, 100, 100)], 'native_zero_duration_all_zero'],
    ['全零序列', [token('甲', 0, 100, 100), token('乙', 1, 100, 100)], 'native_zero_duration_all_zero'],
  ])('拒绝%s', async (_name, tokens, code) => {
    const q = await api();
    expect(() => q.buildNarrationNativeSpans(build(tokens as unknown[], undefined, 400))).toThrow(code);
  });

  it('显式静默字符允许相邻 source 范围跨越，未声明时仍按缺词拒绝', async () => {
    const q = await api();
    const tokens = [token('甲', 0, 0, 100), token('乙', 1, 100, 100), token('丙', 2, 100, 300)];
    const declared = q.buildNarrationNativeSpans(build(tokens, '甲\n乙丙', 300, {
      observations: [{ start: 1, end: 2, expected: '\n', spoken: '' }],
    }));
    expect(declared.spans[0]).toMatchObject({ source_start: 0, source_end: 3 });
    expect(() => q.buildNarrationNativeSpans(build(tokens, '甲\n乙丙', 300))).toThrow('native_text_mismatch');
  });

  it.each([
    ['缺词', build([token('甲', 0, 0, 100)], '甲乙', 100), 'native_text_mismatch'],
    ['非整数时间', build([{ ...token('甲', 0, 0, 100), end_time: 99.5 }], '甲', 100), 'native_token_invalid'],
    ['负时间', build([token('甲', 0, -1, 100)], '甲', 100), 'native_time_invalid'],
    ['倒序时间', build([token('甲', 0, 100, 99)], '甲', 100), 'native_time_invalid'],
    ['越过音频', build([token('甲', 0, 0, 101)], '甲', 100), 'native_time_invalid'],
    ['正时长重叠', build([token('甲', 0, 0, 200), token('乙', 1, 100, 300)], '甲乙', 300), 'native_positive_overlap'],
    ['无效供应商索引', build([{ ...token('甲', 0, 0, 100), begin_index: -1 }], '甲', 100), 'native_token_invalid'],
    ['未知字段', { ...build([token('甲', 0, 0, 100)], '甲', 100), asrTime: 88 }, 'native_input_invalid'],
  ])('JSON 边界拒绝%s', async (_name, input, code) => {
    const q = await api();
    expect(() => q.buildNarrationNativeSpans(input)).toThrow(code);
  });

  it('允许显式句 ID 数组，且拒绝与 token 内句号冲突或长度错误', async () => {
    const q = await api();
    const tokens = [token('甲', 0, 0, 100), token('乙', 1, 100, 200)].map(({ providerSentenceIndex: _, ...row }) => row);
    expect(q.buildNarrationNativeSpans(build(tokens, '甲乙', 200, { providerSentenceIndices: [4, 4] })).spans).toHaveLength(2);
    expect(() => q.buildNarrationNativeSpans(build(tokens, '甲乙', 200, { providerSentenceIndices: [4] }))).toThrow('native_sentence_index_invalid');
    expect(() => q.buildNarrationNativeSpans(build([token('甲', 0, 0, 100, 1)], '甲', 100, { providerSentenceIndices: [2] }))).toThrow('native_sentence_index_invalid');
  });

  it('规范化共享 source span 内不切，组合字符和代理对内部也不切', async () => {
    const q = await api();
    const sourceText = '第12个𠮷é。';
    const spoken = ['第', '十', '二', '个', '𠮷', 'e', '́', '。'];
    const tokens = spoken.map((text, index) => token(text, index, index * 100, (index + 1) * 100));
    const result = q.buildNarrationNativeSpans(build(tokens, sourceText, 800, {
      observations: [{ start: 1, end: 3, expected: '12', spoken: '十二' }],
    }));
    expect(result.boundaries.map((row: any) => row.source_offset)).toEqual([0, 1, 3, 4, 6, 8, 9]);
    expect(result.boundaries.map((row: any) => row.time_ms)).toEqual([0, 100, 300, 400, 500, 700, 800]);
  });

  it('同一时刻候选切点选择最大合法 sourceOffset，且不生成零时长区间', async () => {
    const q = await api();
    const result = q.buildNarrationNativeSpans(build([
      token('甲', 0, 0, 100), token('乙', 1, 100, 100), token('丙', 2, 100, 200),
    ], '甲乙丙', 200));
    expect(result.boundaries.map(({ time_ms, source_offset }: any) => ({ time_ms, source_offset }))).toEqual([
      { time_ms: 0, source_offset: 0 },
      { time_ms: 100, source_offset: 2 },
      { time_ms: 200, source_offset: 3 },
    ]);
  });

  it('18 个正常字 token 不机械合并，第 6 字后 1500ms 仍是合法切点', async () => {
    const q = await api();
    const sourceText = '一二三四五六七八九十甲乙丙丁戊己庚辛';
    const tokens = Array.from(sourceText, (text, index) => token(text, index, index * 250, (index + 1) * 250));
    const result = q.buildNarrationNativeSpans(build(tokens, sourceText, 4500));
    expect(result.spans).toHaveLength(18);
    expect(result.boundaries).toContainEqual(expect.objectContaining({ time_ms: 1500, source_offset: 6 }));
  });

  it('摘录和 visual 时间由相同边界对派生', async () => {
    const q = await api();
    const input = build([token('甲乙', 0, 0, 200), token('丙丁', 1, 200, 500)], '甲乙丙丁', 500);
    const excerpts = q.deriveBoundaryExcerpts(input);
    const visual = q.deriveVisualIntervals(input);
    expect(excerpts).toEqual([
      { boundary_pair_index: 0, source_start: 0, source_end: 2, text: '甲乙' },
      { boundary_pair_index: 1, source_start: 2, source_end: 4, text: '丙丁' },
    ]);
    expect(visual).toEqual([
      { boundary_pair_index: 0, start_ms: 0, end_ms: 200 },
      { boundary_pair_index: 1, start_ms: 200, end_ms: 500 },
    ]);
    expect(excerpts.map((row: any) => row.boundary_pair_index)).toEqual(visual.map((row: any) => row.boundary_pair_index));
  });

  it('输出稳定边界 ID、原始 hash 与同时间候选选择证据，并可一次派生同源片段', async () => {
    const q = await api();
    const input = build([token('甲', 0, 0, 100), token('乙', 1, 100, 100), token('丙', 2, 100, 200)], '甲乙丙', 200);
    const result = q.buildNarrationNativeSpans(input);
    expect(result.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.spans[0].raw_summary.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.boundaries).toEqual([
      { boundary_id: 'native-boundary:0:0', time_ms: 0, source_offset: 0, raw_candidate_source_offsets: [0], legal_candidate_source_offsets: [0], selection_reason: 'edge' },
      { boundary_id: 'native-boundary:100:2', time_ms: 100, source_offset: 2, raw_candidate_source_offsets: [1, 2], legal_candidate_source_offsets: [2], selection_reason: 'maximum_legal_source_offset' },
      { boundary_id: 'native-boundary:200:3', time_ms: 200, source_offset: 3, raw_candidate_source_offsets: [3], legal_candidate_source_offsets: [3], selection_reason: 'edge' },
    ]);
    expect(q.buildNarrationNativeSpans(input).input_sha256).toBe(result.input_sha256);
    expect(q.deriveBoundaryPairs(input)).toEqual([
      { boundary_pair_index: 0, start_boundary_id: 'native-boundary:0:0', end_boundary_id: 'native-boundary:100:2', start_ms: 0, end_ms: 100, source_start: 0, source_end: 2, text: '甲乙' },
      { boundary_pair_index: 1, start_boundary_id: 'native-boundary:100:2', end_boundary_id: 'native-boundary:200:3', start_ms: 100, end_ms: 200, source_start: 2, source_end: 3, text: '丙' },
    ]);
  });


  it.each([
    ['末部规范化共享范围', '第12', ['第十', '二'], false, [{ start: 1, end: 3, expected: '12', spoken: '十二' }]],
    ['首部规范化共享范围', '12个', ['十', '二个'], true, [{ start: 0, end: 2, expected: '12', spoken: '十二' }]],
    ['末部组合字符共享范围', 'Aé', ['Ae', '́'], false, []],
    ['首部组合字符共享范围', 'éB', ['e', '́B'], true, []],
  ])('允许经过映射验证的部分重叠：%s', async (_label, source, spoken, zeroFirst, observations) => {
    const q = await api();
    const texts = spoken as string[];
    const tokens = zeroFirst ? [token(texts[0], 0, 0, 0), token(texts[1], 1, 0, 100)]
      : [token(texts[0], 0, 0, 100), token(texts[1], 1, 100, 100)];
    const input = build(tokens, source as string, 100, { observations });
    const result = q.buildNarrationNativeSpans(input);
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({ source_start: 0, source_end: (source as string).length, start_ms: 0, end_ms: 100 });
    expect(result.spans[0].members.map((x) => x.text)).toEqual(texts);
    expect(q.deriveBoundaryPairs(input)[0].text).toBe(source);
  });

  it('裸边界表与错正文不能绕过同源输入验证', async () => {
    const q = await api();
    const fake = [{ time_ms: 100, source_offset: 0 }, { time_ms: 300, source_offset: 2 }];
    expect(() => q.deriveBoundaryPairs({ sourceText: '甲乙', boundaries: fake })).toThrow('native_input_invalid');
    expect(() => q.deriveVisualIntervals(fake)).toThrow('native_input_invalid');
    const input = build([token('甲', 0, 0, 100), token('乙', 1, 100, 300)], '丙丁', 300);
    expect(() => q.deriveBoundaryPairs(input)).toThrow('native_text_mismatch');
    expect(() => q.deriveBoundaryExcerpts(input)).toThrow('native_text_mismatch');
  });

  it('所选镜头边界必须来自合法表并覆盖完整时间轴', async () => {
    const q = await api();
    const source = '一二三四五六七八九十甲乙丙丁戊己庚辛';
    const input = build(Array.from(source, (text, i) => token(text, i, i * 250, (i + 1) * 250)), source, 4500);
    const ids = ['native-boundary:0:0', 'native-boundary:1500:6', 'native-boundary:4500:18'];
    const pairs = q.deriveBoundaryPairs(input, ids);
    expect(pairs.map((p) => [p.start_ms, p.end_ms, p.text])).toEqual([[0, 1500, source.slice(0, 6)], [1500, 4500, source.slice(6)]]);
    for (const invalid of [ids.slice(1), ids.slice(0, 2), [ids[0], 'native-boundary:1499:6', ids[2]], [ids[0], ids[1], ids[1], ids[2]], [...ids].reverse()]) {
      expect(() => q.deriveBoundaryPairs(input, invalid)).toThrow('native_boundaries_invalid');
    }
    const zero = build([token('起', 0, 0, 200), token('了', 1, 200, 200), token('风', 2, 200, 500)], '起了风', 500);
    expect(() => q.deriveBoundaryPairs(zero, ['native-boundary:0:0', 'native-boundary:200:1', 'native-boundary:500:3'])).toThrow('native_boundaries_invalid');
  });

  it('CLI 无参数保持零网络和未授予资格，未知参数固定拒绝', async () => {
    await api();
    const cli = ['node_modules/tsx/dist/cli.mjs', 'harness/scripts/runtime/narration-native-spans.ts'];
    expect(JSON.parse(execFileSync(process.execPath, cli, { encoding: 'utf8' }))).toMatchObject({ actual_requests: 0, qualification: 'unverified' });
    let stderr = '';
    try { execFileSync(process.execPath, [...cli, '--live'], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (error) { stderr = String((error as any).stderr); }
    expect(JSON.parse(stderr).error).toBe('native_cli_arguments_invalid');
  });
});
