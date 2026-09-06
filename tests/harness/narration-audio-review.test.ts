import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function api() {
  expect(existsSync('harness/scripts/runtime/narration-audio-review.ts'), '音频评审入口存在').toBe(true);
  return import('../../harness/scripts/runtime/narration-audio-review.js');
}

const temporaryDirectories: string[] = [];
function outputDirectory() {
  const parent = mkdtempSync(join(tmpdir(), 'narration-audio-review-'));
  temporaryDirectories.push(parent);
  return join(parent, 'run');
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw Error('fixture_path_invalid');
    rmSync(directory, { recursive: true });
  }
});

const validReview: any = {
  audio_processed: true,
  first_heard: '开头',
  last_heard: '结尾',
  acceptable: true,
  scores: { naturalness: 4, coherence: 4, pronunciation: 4 },
  issues: [],
  focused_checks: [{ check: '核对项', result: 'clear', heard: '清楚', reason: '未发现问题' }],
  limitations: [],
};
const usage = { audio_input_tokens: 1000, text_input_tokens: 100, text_output_tokens: 200, text_output_fallback: false };
const success = () => ({
  status: 'succeeded' as const,
  response_id: 'response-id', response_model: 'qwen3-omni-flash-2025-12-01', finish_reason: 'stop' as const,
  usage, raw_chunks: [{ id: 'response-id' }], full_text: JSON.stringify(validReview), review: validReview,
});

describe('独立口播音频机器评审', () => {
  it('冻结四项纯声音质量计划及费用参数，缺省和显式dry-run都不授权请求', async () => {
    const q = await api();
    const plan = q.loadPlan();
    expect(plan.model).toBe('qwen3-omni-flash-2025-12-01');
    expect(plan.endpoint).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(plan.schema_version).toBe('narration_audio_review_matrix_v3');
    expect(plan.requests.map((row: any) => row.id)).toEqual(['sample-g', 'sample-h', 'sample-i', 'sample-j']);
    expect(plan.requests.every((row: any) => row.kind === 'full')).toBe(true);
    expect(plan.requests.every((row: any) => row.mp3_bytes < 7_500_000 && row.input_sha256.length === 64)).toBe(true);
    expect(plan.parameters).toEqual({ stream: true, stream_options: { include_usage: true }, modalities: ['text'], enable_thinking: false, max_tokens: 1800, temperature: 0 });
    expect(plan.budget).toEqual({ baseline_cny: 2.8147632, total_cap_cny: 5, task_cap_cny: .45, estimate_cny: .2977824 });
    expect(q.LIVE_OUTPUT_DIRECTORY).toMatch(/narration-acoustic-quality-live-20260906$/);
    expect(q.parseArgs([])).toBe('dry-run');
    expect(q.parseArgs(['--dry-run'])).toBe('dry-run');
  });

  it.each([
    ['--live'], ['--confirm-live'], ['--live', '--confirm-live'],
    ['--live', '--confirm-live', '--max-requests', '4', '--max-cost-cny', '0.50'],
    ['--blind-audio-only', '--live', '--confirm-live', '--max-requests', '6', '--max-cost-cny', '0.50'],
    ['--acoustic-quality-only', '--live', '--confirm-live', '--max-requests', '4'],
    ['--acoustic-quality-only', '--live', '--confirm-live', '--max-requests', '6', '--max-cost-cny', '0.45'],
    ['--acoustic-quality-only', '--live', '--confirm-live', '--max-requests', '4', '--max-cost-cny', '.45'],
    ['--acoustic-quality-only', '--live', '--confirm-live', '--max-requests', '4', '--max-cost-cny', '0.45', '--live'],
    ['--dry-run', '--live'], ['--model', 'other'], ['--output-dir', 'other'], ['--unknown'],
  ])('拒绝旧入口及不精确、未知或重复的入口参数 %j', async (...args) => {
    const q = await api();
    expect(() => q.parseArgs(args)).toThrow('audio_review_arguments_invalid');
  });

  it('仅精确纯声音四次live入口授权执行', async () => {
    const q = await api();
    expect(q.parseArgs(['--acoustic-quality-only', '--live', '--confirm-live', '--max-requests', '4', '--max-cost-cny', '0.45'])).toBe('live');
  });

  it('CLI缺省与显式dry-run均为零请求，残缺live入口无付费旁路', async () => {
    await api();
    const command = ['node_modules/tsx/dist/cli.mjs', 'harness/scripts/runtime/narration-audio-review.ts'];
    const options = { cwd: resolve('.'), encoding: 'utf8' as const, env: { ...process.env, ALIYUN_DASHSCOPE_API_KEY: 'unused-test-key' } };
    expect(JSON.parse(execFileSync(process.execPath, command, options)).actual_requests).toBe(0);
    expect(JSON.parse(execFileSync(process.execPath, [...command, '--dry-run'], options)).actual_requests).toBe(0);
    expect(() => execFileSync(process.execPath, [...command, '--live'], { ...options, stdio: 'pipe' })).toThrow();
  });

  it('dry-run不创建新目录也不触碰真实v1/v2输出目录', async () => {
    const q = await api();
    const oldDirectories = [
      resolve('harness/scripts/runtime/output/narration-audio-review-live-20260906'),
      resolve('harness/scripts/runtime/output/narration-audio-review-blind-live-20260906'),
    ];
    expect(oldDirectories.every(existsSync)).toBe(true);
    const before = oldDirectories.map(directory => statSync(directory).mtimeMs);
    const newDirectory = q.LIVE_OUTPUT_DIRECTORY;
    const newExistedBefore = existsSync(newDirectory);
    q.parseArgs([]); q.loadPlan();
    expect(oldDirectories.map(directory => statSync(directory).mtimeMs)).toEqual(before);
    expect(existsSync(newDirectory)).toBe(newExistedBefore);
  });

  it('读取范围由冻结manifest控制，任一输入摘要变化都在派发前失败', async () => {
    const q = await api();
    const original = readFileSync;
    const reader = (file: string) => {
      const bytes = original(file);
      return String(file).endsWith('.mp3') ? Buffer.concat([bytes, Buffer.from('changed')]) : bytes;
    };
    expect(() => q.loadPlan({ readFile: reader })).toThrow('audio_review_frozen_input_changed');
  });

  it('四项严格串行且各派发一次，结束仍不颁发资格', async () => {
    const q = await api();
    const active: string[] = [];
    const order: string[] = [];
    const dispatcher = vi.fn(async (row: any) => {
      expect(active).toHaveLength(0);
      active.push(row.id); order.push('start:' + row.id);
      await Promise.resolve();
      active.pop(); order.push('end:' + row.id);
      return success();
    });
    const result = await q.executeReview(q.loadPlan(), outputDirectory(), dispatcher);
    expect(dispatcher).toHaveBeenCalledTimes(4);
    expect(order).toEqual(['sample-g', 'sample-h', 'sample-i', 'sample-j'].flatMap(id => ['start:' + id, 'end:' + id]));
    expect(result).toMatchObject({ actual_requests: 4, qualification: 'unverified', stopped_reason: null });
    expect(result.calls).toHaveLength(4);
  });

  it('计划指纹覆盖冻结prompt正文，篡改后在任何派发和建目录前拒绝', async () => {
    const q = await api(); const plan = q.loadPlan(); const directory = outputDirectory();
    plan.prompt_body += '\n额外指令';
    const dispatcher = vi.fn(async () => success());
    await expect(q.executeReview(plan, directory, dispatcher)).rejects.toThrow('audio_review_plan_changed');
    expect(dispatcher).not.toHaveBeenCalled(); expect(existsSync(directory)).toBe(false);
  });

  it('计划指纹覆盖固定full种类，篡改后零派发', async () => {
    const q = await api(); const plan = q.loadPlan(); const directory = outputDirectory();
    plan.requests[3].kind = 'clip' as any;
    const dispatcher = vi.fn(async () => success());
    await expect(q.executeReview(plan, directory, dispatcher)).rejects.toThrow('audio_review_plan_changed');
    expect(dispatcher).not.toHaveBeenCalled(); expect(existsSync(directory)).toBe(false);
  });

  it('异常或未知费用立即停止，未知项占满本任务余额并保留派发留痕', async () => {
    const q = await api();
    const directory = outputDirectory();
    const dispatcher = vi.fn(async () => ({ ...success(), status: 'failed' as const, usage: null, review: null, error: 'response_incomplete' }));
    const result = await q.executeReview(q.loadPlan(), directory, dispatcher);
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ actual_requests: 1, actual_cost_cny: null, accounted_cost_cny: .45, stopped_reason: 'audio_review_unverified_or_failed' });
    expect(existsSync(join(directory, 'sample-g', 'dispatch-intent.json'))).toBe(true);
    expect(existsSync(join(directory, 'sample-h'))).toBe(false);
  });

  it('每次POST前用该行估算复核剩余预算，余额不足时不派发下一项', async () => {
    const q = await api(); let count = 0;
    const dispatcher = vi.fn(async () => {
      count++;
      return { ...success(), usage: { audio_input_tokens: 28_000, text_input_tokens: 0, text_output_tokens: 0, text_output_fallback: false } };
    });
    const result = await q.executeReview(q.loadPlan(), outputDirectory(), dispatcher);
    expect(count).toBe(1); expect(result.actual_requests).toBe(1);
    expect(result.stopped_reason).toBe('cost_limit_before_dispatch');
    expect(result.actual_cost_cny).toBe(.4424);
  });

  it('已有目标目录在任何派发前拒绝', async () => {
    const q = await api();
    const directory = outputDirectory(); mkdirSync(directory);
    const dispatcher = vi.fn(async () => success());
    await expect(q.executeReview(q.loadPlan(), directory, dispatcher)).rejects.toThrow('audio_review_output_exists');
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('请求只含匿名样例、kind和通用focus，目标正文与答案锚点绝不外发', async () => {
    const q = await api();
    const plan = q.loadPlan();
    for (const row of plan.requests) {
      const body: any = q.buildRequestBody(plan, row, readFileSync(row.mp3_file));
      expect(body.model).toBe(plan.model);
      expect(body).toMatchObject({ stream: true, modalities: ['text'], enable_thinking: false, max_tokens: 1800, temperature: 0 });
      const supplied = JSON.parse(body.messages[1].content[1].text);
      expect(supplied).toEqual({ sample_id: row.id, kind: row.kind, focus: row.focus });
      const promptText = body.messages[0].content + body.messages[1].content[1].text;
      expect(promptText).not.toContain(row.source_text);
      expect(promptText).not.toContain(row.candidate_id);
      expect(promptText).not.toContain(plan.model);
      expect(promptText).not.toMatch(/local_acoustic_negative_control|sample-j-full|中段循环故障|故障副本|吕布|貂蝉|134000|142000|287000|295000|ASR|先前结论/);
    }
  });

  it('四项均为full，故障副本标签和音频差异只留在本地计划', async () => {
    const q = await api(); const plan = q.loadPlan();
    const original = plan.requests.find((row: any) => row.id === 'sample-i')!;
    const negative = plan.requests.find((row: any) => row.id === 'sample-j')!;
    expect(plan.requests.every((row: any) => row.kind === 'full')).toBe(true);
    expect(plan.requests.every((row: any) => !('clip_start_ms' in row) && !('clip_end_ms' in row))).toBe(true);
    expect(negative.candidate_id).toBe('local_acoustic_negative_control');
    expect(negative.duration_ms).toBe(original.duration_ms);
    expect(negative.wav_sha256).not.toBe(original.wav_sha256);
    expect(negative.mp3_sha256).not.toBe(original.mp3_sha256);
    const body = q.buildRequestBody(plan, negative, readFileSync(negative.mp3_file));
    const outbound = JSON.stringify(body.messages);
    expect(outbound).not.toContain(negative.candidate_id);
    expect(outbound).not.toContain('sample-j-full');
    expect(outbound).not.toContain(negative.source_text);
  });

  it('跨网络分块解析SSE，要求DONE、stop及明确的audio/text usage', async () => {
    const q = await api();
    const answer = JSON.stringify(validReview);
    const wire = [
      `data: ${JSON.stringify({ id: 'rid', model: q.loadPlan().model, choices: [{ delta: { content: answer.slice(0, 20) }, finish_reason: null }], usage: null })}\n\n`,
      `data: ${JSON.stringify({ id: 'rid', model: q.loadPlan().model, choices: [{ delta: { content: answer.slice(20) }, finish_reason: 'stop' }], usage: { prompt_tokens_details: { audio_tokens: 1000, text_tokens: 100 }, completion_tokens_details: { text_tokens: 200 }, completion_tokens: 200 } })}\n\ndata: [DONE]\n\n`,
    ].join('');
    const pieces = [wire.slice(0, 17), wire.slice(17, 91), wire.slice(91, 173), wire.slice(173)];
    const parsed = await q.parseSseStream((async function* () { for (const piece of pieces) yield Buffer.from(piece); })());
    expect(parsed).toMatchObject({ status: 'succeeded', response_id: 'rid', finish_reason: 'stop', usage, review: validReview });
    expect(parsed.full_text).toBe(answer);
  });

  it.each(['missing-done', 'missing-usage', 'length'])('SSE不完整或被截断时结果不可用：%s', async mode => {
    const q = await api();
    const payload: any = { id: 'rid', model: 'qwen3-omni-flash-2025-12-01', choices: [{ delta: { content: JSON.stringify(validReview) }, finish_reason: mode === 'length' ? 'length' : 'stop' }] };
    if (mode !== 'missing-usage') payload.usage = { prompt_tokens_details: { audio_tokens: 1, text_tokens: 2 }, completion_tokens: 3 };
    const wire = `data: ${JSON.stringify(payload)}\n\n${mode === 'missing-done' ? '' : 'data: [DONE]\n\n'}`;
    const parsed = await q.parseSseStream((async function* () { yield wire; })());
    expect(parsed.status).toBe('failed');
    expect(parsed.review).toBeNull();
    expect(parsed.full_text).toContain('audio_processed');
    expect(parsed.response_id).toBe('rid'); expect(parsed.response_model).toBe('qwen3-omni-flash-2025-12-01');
    expect(parsed.finish_reason).toBe(mode === 'length' ? 'length' : 'stop');
    expect(parsed.usage === null).toBe(mode === 'missing-usage');
    expect(wire.includes('[DONE]')).toBe(mode !== 'missing-done');
  });

  it('SSE缺响应身份时不能标记完整成功', async () => {
    const q = await api();
    const payload = { model: q.loadPlan().model, choices: [{ delta: { content: JSON.stringify(validReview) }, finish_reason: 'stop' }],
      usage: { prompt_tokens_details: { audio_tokens: 1, text_tokens: 2 }, completion_tokens: 3 } };
    const parsed = await q.parseSseStream((async function* () { yield `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`; })());
    expect(parsed).toMatchObject({ status: 'failed', response_id: null, review: null });
  });

  it('流读取中断时保留已收到的脱敏chunk和完整回答片段', async () => {
    const q = await api(); const model = q.loadPlan().model;
    const chunk = `data: ${JSON.stringify({ id: 'partial-id', model, choices: [{ delta: { content: '{\"audio_processed\":true' }, finish_reason: null }] })}\n\n`;
    const stream = (async function* () { yield chunk; throw Error('socket-private-detail'); })();
    const parsed = await q.parseSseStream(stream);
    expect(parsed).toMatchObject({ status: 'failed', response_id: 'partial-id', full_text: '{"audio_processed":true', review: null });
    expect(parsed.raw_chunks).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain('socket-private-detail');
  });

  it.each(['identity-conflict', 'data-after-done'])('SSE身份冲突或DONE后继续输出时失败：%s', async mode => {
    const q = await api(); const model = q.loadPlan().model; const answer = JSON.stringify(validReview);
    const first = { id: 'rid-1', model, choices: [{ delta: { content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens_details: { audio_tokens: 1, text_tokens: 2 }, completion_tokens: 3 } };
    const second = mode === 'identity-conflict' ? { id: 'rid-2', model, choices: [] } : { id: 'rid-1', model, choices: [] };
    const wire = mode === 'identity-conflict'
      ? `data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(second)}\n\ndata: [DONE]\n\n`
      : `data: ${JSON.stringify(first)}\n\ndata: [DONE]\n\ndata: ${JSON.stringify(second)}\n\n`;
    const parsed = await q.parseSseStream((async function* () { yield wire; })());
    expect(parsed.status).toBe('failed'); expect(parsed.review).toBeNull();
  });

  it('价格核算只接受完整非负用量，并明确completion_tokens回退', async () => {
    const q = await api(); const pricing = q.loadPlan().pricing;
    expect(q.calculateCost(usage, pricing)).toBeCloseTo(.01852, 8);
    expect(() => q.calculateCost({ ...usage, audio_input_tokens: -1 }, pricing)).toThrow('audio_review_usage_invalid');
    expect(() => q.calculateCost({ ...usage, text_input_tokens: NaN }, pricing)).toThrow('audio_review_usage_invalid');
    const fallback = q.extractUsage({ prompt_tokens_details: { audio_tokens: 3, text_tokens: 4 }, completion_tokens: 5 });
    expect(fallback).toEqual({ audio_input_tokens: 3, text_input_tokens: 4, text_output_tokens: 5, text_output_fallback: true });
    expect(() => q.extractUsage({ prompt_tokens_details: { audio_tokens: 0, text_tokens: 4 }, completion_tokens: 5 })).toThrow('audio_review_usage_invalid');
    expect(() => q.extractUsage({ prompt_tokens: 99, prompt_tokens_details: { audio_tokens: 3, text_tokens: 4 }, completion_tokens: 5 })).toThrow('audio_review_usage_invalid');
    expect(() => q.extractUsage({ prompt_tokens_details: { audio_tokens: 3, text_tokens: 4 }, completion_tokens: 6, completion_tokens_details: { text_tokens: 5 } })).toThrow('audio_review_usage_invalid');
  });

  it('1至5的有限小数评分符合冻结prompt字段约束', async () => {
    const q = await api();
    expect(q.parseReviewJson(JSON.stringify({ ...validReview, scores: { ...validReview.scores, naturalness: 4.5 } })).scores.naturalness).toBe(4.5);
    expect(q.parseReviewJson(JSON.stringify({ ...validReview, first_heard: '', last_heard: '' }))).toMatchObject({ first_heard: '', last_heard: '' });
  });

  it.each([
    ['not json', '非JSON'],
    [JSON.stringify({ ...validReview, audio_processed: false }), '未读取音频'],
    [JSON.stringify({ ...validReview, acceptable: 'yes' }), '字段类型错误'],
    [JSON.stringify({ ...validReview, scores: { ...validReview.scores, naturalness: 6 } }), '评分越界'],
    [JSON.stringify({ ...validReview, issues: [{ severity: 'bad', at_seconds: null, heard: '', reason: '' }] }), '问题枚举错误'],
  ])('结构输出拒绝不可用结果：%s', async (text) => {
    const q = await api(); expect(() => q.parseReviewJson(text)).toThrow('audio_review_output_invalid');
  });

  it('只允许剥离唯一JSON markdown fence', async () => {
    const q = await api();
    expect(q.parseReviewJson('```json\n' + JSON.stringify(validReview) + '\n```')).toEqual(validReview);
    expect(() => q.parseReviewJson('说明\n```json\n' + JSON.stringify(validReview) + '\n```')).toThrow('audio_review_output_invalid');
  });

  it('正式捕获固定HTTPS端点、无重试并留存脱敏响应，不归档请求秘密或音频', async () => {
    const q = await api(); const plan = q.loadPlan(); const row = plan.requests[0];
    const answer = JSON.stringify(validReview);
    const wire = `data: ${JSON.stringify({ id: 'rid', model: plan.model, choices: [{ delta: { content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens_details: { audio_tokens: 10, text_tokens: 20 }, completion_tokens_details: { text_tokens: 30 } } })}\n\ndata: [DONE]\n\n`;
    const fetcher = vi.fn(async (url: any, init: any) => {
      expect(url).toBe(plan.endpoint); expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-key');
      const request = JSON.parse(init.body); expect(request.messages[1].content[0].input_audio.data).toMatch(/^data:;base64,/);
      return new Response(wire, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await q.dispatchReview(plan, row, 'private-key', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(result.status).toBe('succeeded');
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(JSON.stringify(result)).not.toContain(Buffer.from(readFileSync(row.mp3_file)).toString('base64').slice(0, 100));
  });

  it('非2xx普通JSON错误也保留脱敏原始响应', async () => {
    const q = await api(); const plan = q.loadPlan();
    const result = await q.dispatchReview(plan, plan.requests[0], 'private-key', async () =>
      new Response(JSON.stringify({ request_id: 'error-request', code: 'InvalidParameter', api_key: 'echoed-secret' }), { status: 400 }));
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result.raw_chunks)).toContain('InvalidParameter');
    expect(JSON.stringify(result.raw_chunks)).toContain('error-request');
    expect(JSON.stringify(result.raw_chunks)).not.toContain('echoed-secret');
  });
  it('真实返回仅缺focused_checks.reason时保留原始观察，不补写说明', async () => {
    const q = await api();
    const check = { check: '语流', result: 'clear', heard: '连续' };
    expect(q.parseReviewJson(JSON.stringify({ ...validReview, focused_checks: [check] })).focused_checks[0]).toEqual(check);
    expect(() => q.parseReviewJson(JSON.stringify({ ...validReview, focused_checks: [{ ...check, reason: null }] }))).toThrow('audio_review_output_invalid');
    expect(() => q.parseReviewJson(JSON.stringify({ ...validReview, focused_checks: [{ check: '语流', result: 'clear' }] }))).toThrow('audio_review_output_invalid');
  });

  it('明确续采入口只允许剩余两次，初始四次入口与续采入口不混用', async () => {
    const q = await api();
    expect(q.parseArgs(['--continue-acoustic-quality', '--live', '--confirm-live', '--max-requests', '2', '--max-cost-cny', '0.45'])).toBe('continue-live');
    expect(() => q.parseArgs(['--continue-acoustic-quality', '--live', '--confirm-live', '--max-requests', '4', '--max-cost-cny', '0.45'])).toThrow();
  });

  it('已发成功和格式失败前缀都占请求数，核销后只派发I/J且不覆盖旧结果', async () => {
    const q = await api(); const plan = q.loadPlan(); const directory = outputDirectory();
    const previous = q.loadAcousticResumePrefix(plan);
    expect(previous.calls.map((x: any) => x.id)).toEqual(['sample-g', 'sample-h']);
    expect(previous.known_cost_cny).toBe(.0377401);
    expect(previous.calls[1].original_status).toBe('failed');
    const received: string[] = [];
    const dispatcher = vi.fn(async (row: any) => { received.push(row.id); return success(); });
    const result = await q.executeReview(plan, directory, dispatcher, { continueAcoustic: true });
    expect(received).toEqual(['sample-i', 'sample-j']);
    expect(result).toMatchObject({ previous_requests: 2, actual_requests: 2, total_requests: 4, previous_cost_cny: .0377401, actual_cost_cny: .0747801, qualification: 'unverified' });
    expect(q.loadAcousticResumePrefix(plan)).toEqual(previous);
    await expect(q.executeReview(plan, directory, dispatcher, { continueAcoustic: true })).rejects.toThrow('audio_review_output_exists');
    expect(dispatcher).toHaveBeenCalledTimes(2);
  });

  it('续采前缀摘要改变则零派发零目录；续采自身失败仍不重发前缀或后一项', async () => {
    const q = await api(); const plan = q.loadPlan(); const directory = outputDirectory();
    const dispatcher = vi.fn(async () => success());
    await expect(q.executeReview(plan, directory, dispatcher, { continueAcoustic: true, prefixReader: (file: string) => Buffer.concat([readFileSync(file), Buffer.from('changed')]) })).rejects.toThrow('audio_review_frozen_input_changed');
    expect(dispatcher).not.toHaveBeenCalled(); expect(existsSync(directory)).toBe(false);
    const fail = vi.fn(async () => ({ ...success(), status: 'failed' as const, usage: null, review: null }));
    const result = await q.executeReview(plan, outputDirectory(), fail, { continueAcoustic: true });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ previous_requests: 2, actual_requests: 1, total_requests: 3, actual_cost_cny: null, accounted_cost_cny: .45, qualification: 'unverified' });
  });

});
