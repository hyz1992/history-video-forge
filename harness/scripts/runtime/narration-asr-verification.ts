/** 任务0：两份既有录音的独立ASR核验；不接业务字幕，不授予模型资格。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { transcribeAudioFile, parseAsrWords } from '../../../backend/src/modules/assets/providers/dashscope/dashscope-asr-client.js';
import { loadReviewCases } from './narration-boundary-review.js';
import frozen from '../../samples/narration-timing/boundary-review-evidence.json';

const local = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const round = (n: number) => Number(n.toFixed(8));
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const save = (dir: string, name: string, data: unknown) => writeFileSync(resolve(dir, name), JSON.stringify(data, null, 2) + '\n');
export function asrPlan() {
  return {
    model: 'qwen3-asr-flash-filetrans', region: 'cn-beijing', price_cny_per_second: .00022,
    estimated_cost_cny: .130812, reserve_cost_cny: .1309, max_cost_cny: .2,
    prior_cost_cny: 2.33198, total_limit_cny: 5,
    requests: frozen.cases.map((c, i) => ({ id: c.identity.candidate_id,
      audio_file: local('./output/' + c.wav.path), wav_sha256: c.wav.sha256,
      duration_seconds: i === 0 ? 244.9 : 349.7 })),
  };
}
type Plan = ReturnType<typeof asrPlan>;
type Row = Plan['requests'][number];
interface Result {
  status: 'succeeded' | 'failed' | 'unknown'; seconds: number | null; submit_attempts: number;
  task_id?: string; word_count?: number; error?: string;
}
export function parseAsrArgs(args: string[]) {
  if (!args.length || args.join(' ') === '--dry-run') return 'dry-run';
  if (args.join(' ') === '--live --confirm-live') return 'live';
  if (args.join(' ') === '--analyze') return 'analyze';
  throw Error('asr_arguments_invalid');
}
export async function executeAsr(plan: Plan, dir: string, transport: (row: Row, dir: string) => Promise<Result>) {
  if (JSON.stringify(plan) !== JSON.stringify(asrPlan())) throw Error('asr_plan_changed');
  mkdirSync(dir); // 已派发、失败和并发运行均不得覆盖；恢复只能查询已有任务。
  save(dir, 'plan.json', plan);
  const calls: Array<{ id: string; result: Result; accounted_cost_cny: number }> = [];
  let known = 0, accounted = 0, unknown = false, stopped_reason: string | null = null;
  const report = () => ({ qualification: 'unverified', calls, actual_cost_cny: unknown ? null : known,
    accounted_cost_cny: accounted, total_usage_cost_cny: unknown ? null : round(plan.prior_cost_cny + known), stopped_reason });
  for (const row of plan.requests) {
    const reserve = Math.ceil(row.duration_seconds) * plan.price_cny_per_second;
    if (accounted + reserve > plan.max_cost_cny || plan.prior_cost_cny + accounted + reserve > plan.total_limit_cny) {
      stopped_reason = 'cost_limit'; break;
    }
    save(dir, row.id + '-dispatch-intent.json', { row, submitted: 'unknown_until_receipt' });
    let result: Result;
    try { result = await transport(row, resolve(dir, row.id)); }
    catch { result = { status: 'unknown', seconds: null, submit_attempts: 1, error: 'transport_unverified' }; }
    const validUsage = typeof result.seconds === 'number' && Number.isFinite(result.seconds) && result.seconds > 0;
    const cost = validUsage ? round(result.seconds! * plan.price_cny_per_second) : round(plan.max_cost_cny - accounted);
    if (validUsage) known = round(known + cost); else unknown = true;
    accounted = round(accounted + cost);
    calls.push({ id: row.id, result, accounted_cost_cny: cost });
    if (!validUsage || result.status !== 'succeeded') stopped_reason = 'asr_unverified_or_failed';
    if (accounted > plan.max_cost_cny) stopped_reason = 'cost_limit';
    save(dir, 'report.json', report());
    if (stopped_reason) break;
  }
  save(dir, 'report.json', report());
  return report();
}

// 原始识别文字与时间保留；临时签名、上传地址和服务错误详情不落盘。
function redact(value: any): any {
  if (typeof value === 'string') return value.replace(/(?:https?:\/\/|oss:\/\/)[^\s"<>]+/g, '[temporary_url_redacted]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/^(authorization|policy|signature|oss_access_key_id|message|error_message)$/i.test(k))
    .map(([k, v]) => [k, redact(v)]));
  return value;
}
let captureActive = false;
/** 只在串行的独立CLI进程临时截取现成客户端fetch；finally恢复，业务代码不改。 */
export async function captureAsr(row: Row, dir: string, apiKey: string, fetcher = globalThis.fetch,
  invoke = () => transcribeAudioFile({ apiKey, audioFilePath: row.audio_file, model: asrPlan().model })) : Promise<Result> {
  if (captureActive) throw Error('asr_capture_already_active');
  mkdirSync(dir);
  captureActive = true;
  const original = globalThis.fetch;
  let task_id: string | undefined, seconds: number | null = null, submits = 0, transcriptSaved = false;
  const finish = (result: Result) => {
    save(dir, 'result.json', { ...result, id: row.id, wav_sha256: row.wav_sha256,
      transcription_sha256: transcriptSaved ? hash(readFileSync(resolve(dir, 'transcription.json'))) : null });
    return result;
  };
  try {
    globalThis.fetch = async (input, init = {}) => {
      if (input instanceof Request) throw Error('asr_request_object_not_supported');
      const url = new URL(String(input));
      const api = url.hostname === 'dashscope.aliyuncs.com';
      const oss = url.hostname.endsWith('.oss-cn-beijing.aliyuncs.com');
      if (!oss && !api || url.username || url.password || url.hash || url.port && url.port !== '443') throw Error('asr_origin_invalid');
      if (oss && url.protocol === 'http:') url.protocol = 'https:';
      if (url.protocol !== 'https:') throw Error('asr_origin_invalid');
      const method = init.method ?? 'GET';
      const policy = api && url.pathname === '/api/v1/uploads' && method === 'GET'
        && url.search === '?action=getPolicy&model=' + asrPlan().model;
      const submit = api && url.pathname === '/api/v1/services/audio/asr/transcription' && method === 'POST' && !url.search;
      const poll = api && !!task_id && url.pathname === '/api/v1/tasks/' + task_id && method === 'GET' && !url.search;
      if (api && !policy && !submit && !poll || oss && !['POST', 'GET'].includes(method)) throw Error('asr_endpoint_invalid');
      const headers = new Headers(init.headers);
      if (api) headers.set('Authorization', 'Bearer ' + apiKey); else headers.delete('Authorization');
      if (submit) {
        const payload = JSON.parse(String(init.body));
        if (submits || payload.model !== asrPlan().model || typeof payload.input?.file_url !== 'string' || !payload.input.file_url.startsWith('oss://')) throw Error('asr_submission_invalid');
        // 构造精确请求，不转发上下文、答案提示或任意客户端额外字段。
        init = { ...init, body: JSON.stringify({ model: asrPlan().model, input: { file_url: payload.input.file_url }, parameters: { enable_words: true, enable_itn: false } }) };
        submits++;
        save(dir, 'submission-intent.json', { id: row.id, wav_sha256: row.wav_sha256, model: asrPlan().model, submit_attempts: submits });
      }
      const response = await fetcher(url.href, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (submit || poll || oss && method === 'GET') {
        const data = await response.clone().json();
        if (submit) {
          const id = data.output?.task_id;
          if (typeof id === 'string' && /^[a-zA-Z0-9-]+$/.test(id)) task_id = id;
          save(dir, 'submission.json', redact(data));
        } else if (poll) {
          if (data.output?.task_id !== task_id) throw Error('asr_task_identity_invalid');
          if (typeof data.usage?.seconds === 'number') seconds = data.usage.seconds;
          save(dir, 'poll-latest.json', redact(data));
        } else {
          save(dir, 'transcription.json', redact(data));
          transcriptSaved = true;
        }
      }
      return response;
    };
    const words = await invoke();
    if (!transcriptSaved || !words.length || !task_id || words.some(w => typeof w.text !== 'string'
      || !Number.isFinite(w.begin_time_ms) || !Number.isFinite(w.end_time_ms)
      || w.begin_time_ms < 0 || w.end_time_ms < w.begin_time_ms || w.end_time_ms > row.duration_seconds * 1000 + 1000)) throw Error('asr_words_invalid');
    save(dir, 'words.json', words);
    return finish({ status: 'succeeded', seconds, task_id, submit_attempts: submits, word_count: words.length });
  } catch {
    return finish({ status: 'failed', seconds, task_id, submit_attempts: submits, error: 'asr_capture_failed' });
  } finally { globalThis.fetch = original; captureActive = false; }
}

type Word = { text: string; begin_time: number; end_time: number };
type AsrWord = { text: string; begin_time_ms: number; end_time_ms: number };
/** 失败/未完成/错配回执不得重新变为正式比较；原始转写保留用于排查。 */
export function loadAsrReference(row: Row, dir: string) {
  try {
    const receipt = JSON.parse(readFileSync(resolve(dir, 'result.json'), 'utf8'));
    const poll = JSON.parse(readFileSync(resolve(dir, 'poll-latest.json'), 'utf8'));
    const submission = JSON.parse(readFileSync(resolve(dir, 'submission.json'), 'utf8'));
    const bytes = readFileSync(resolve(dir, 'transcription.json'));
    if (receipt.status !== 'succeeded' || receipt.id !== row.id || receipt.wav_sha256 !== row.wav_sha256
      || !receipt.task_id || receipt.task_id !== poll.output?.task_id || receipt.task_id !== submission.output?.task_id
      || poll.output?.task_status !== 'SUCCEEDED' || receipt.transcription_sha256 !== hash(bytes)) throw Error();
    const words = parseAsrWords(JSON.parse(bytes.toString('utf8')));
    if (!words.length || words.length !== receipt.word_count || words.some(w => typeof w.text !== 'string'
      || !Number.isFinite(w.begin_time_ms) || !Number.isFinite(w.end_time_ms) || w.begin_time_ms < 0
      || w.end_time_ms < w.begin_time_ms || w.end_time_ms > row.duration_seconds * 1000 + 1000)) throw Error();
    return words;
  } catch { throw Error('asr_reference_invalid'); }
}
function timingIssues(words: Word[]) {
  let highWater = 0;
  return words.flatMap((w, i) => {
    const valid = Number.isFinite(w.begin_time) && Number.isFinite(w.end_time) && w.begin_time >= 0 && w.end_time > w.begin_time;
    const issues = [...(!valid ? ['token_duration_invalid:' + i] : []),
      ...(w.begin_time < highWater ? ['token_overlap:' + i] : [])];
    // 坏词/倒序词不得让后续词绕过此前已观察到的时间范围。
    if (valid) highWater = Math.max(highWater, w.end_time);
    return issues;
  });
}
const normalize = (s: string) => s.replace(/[\p{P}\p{Z}\s]/gu, '');
/** 纯文字编辑距离，不解释同音/数字含义，也不据此颁发语义质量结论。 */
function align(a: string, b: string) {
  const width = b.length + 1, dp = new Uint32Array((a.length + 1) * width);
  for (let i = 0; i <= a.length; i++) dp[i * width] = i;
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i * width + j] = Math.min(
    dp[(i - 1) * width + j] + 1, dp[i * width + j - 1] + 1,
    dp[(i - 1) * width + j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const matches = new Map<number, number>();
  const differences: Array<{ source_offset: number; recognized_offset: number; source: string; recognized: string }> = [];
  let i = a.length, j = b.length, deletions = 0, insertions = 0, substitutions = 0;
  while (i || j) {
    if (i && j && a[i - 1] === b[j - 1] && dp[i * width + j] === dp[(i - 1) * width + j - 1]) { matches.set(--i, --j); }
    else if (i && j && dp[i * width + j] === dp[(i - 1) * width + j - 1] + 1) {
      differences.push({ source_offset: --i, recognized_offset: --j, source: a[i], recognized: b[j] }); substitutions++;
    } else if (i && dp[i * width + j] === dp[(i - 1) * width + j] + 1) {
      differences.push({ source_offset: --i, recognized_offset: j, source: a[i], recognized: '' }); deletions++;
    } else { differences.push({ source_offset: i, recognized_offset: --j, source: '', recognized: b[j] }); insertions++; }
  }
  return { matches, edit_distance: dp.at(-1)!, deletions, insertions, substitutions, differences: differences.reverse() };
}
export function compareRecognition(source: string, native: Word[], asr: AsrWord[]) {
  const sourceText = normalize(source), nativeText = normalize(native.map(w => w.text).join(''));
  const asrText = normalize(asr.map(w => w.text).join(''));
  const { matches: _sourceMatches, ...source_asr } = align(sourceText, asrText);
  const alignment = align(nativeText, asrText);
  const native_timing_issues = timingIssues(native);
  const asr_timing_issues = timingIssues(asr.map(w => ({ text: w.text, begin_time: w.begin_time_ms, end_time: w.end_time_ms })));
  const invalidNative = new Set(native_timing_issues.map(s => Number(s.split(':')[1])));
  const invalidAsr = new Set(asr_timing_issues.map(s => Number(s.split(':')[1])));
  const starts = (words: Array<{text: string}>) => { let offset = 0; return words.map((w, ordinal) => {
    const text = normalize(w.text), r = { ordinal, offset, text }; offset += text.length; return r;
  }).filter(w => w.text.length); };
  const aStarts = new Map(starts(asr).map(w => [w.offset, w]));
  const points: Array<{native_ordinal: number; asr_ordinal: number; native_ms: number; asr_ms: number; difference_ms: number}> = [];
  for (const n of starts(native)) {
    const matched = alignment.matches.get(n.offset), a = matched === undefined ? undefined : aStarts.get(matched);
    if (!a || invalidNative.has(n.ordinal) || invalidAsr.has(a.ordinal)) continue;
    // 相同起点及邻域连续同文才比较；不把多字词内部假造为新时间点。
    const from = Math.max(0, n.offset - 4), to = Math.min(nativeText.length, n.offset + Math.max(n.text.length, 4));
    if (Array.from({length: to - from}, (_, k) => from + k).some(k => alignment.matches.get(k) !== matched! + k - n.offset)) continue;
    const native_ms = native[n.ordinal].begin_time, asr_ms = asr[a.ordinal].begin_time_ms;
    points.push({ native_ordinal: n.ordinal, asr_ordinal: a.ordinal, native_ms, asr_ms, difference_ms: Math.abs(native_ms - asr_ms) });
  }
  const errors = points.map(p => p.difference_ms).sort((a, b) => a - b);
  return { qualification: 'unverified', reference_kind: 'independent_asr_not_acoustic_ground_truth',
    normalization: 'remove_punctuation_whitespace_only_UTF16_offsets', source_asr,
    source_normalized_length: sourceText.length, native_normalized_length: nativeText.length, asr_normalized_length: asrText.length,
    native_timing_issues, asr_timing_issues,
    boundary_comparison: { scope: 'exact_local_text_word_onsets_only_no_interpolation', native_word_count: native.length,
      comparable_count: points.length, p95_difference_ms: errors.length ? errors[Math.ceil(errors.length * .95) - 1] : null,
      max_difference_ms: errors.at(-1) ?? null, points } };
}
const output = local('./output/narration-asr-live-20260906');
export function analyzeSaved() {
  loadReviewCases();
  const source = readFileSync(local('./output/' + frozen.source.path), 'utf8');
  const results = frozen.cases.map(c => {
    const raw = JSON.parse(readFileSync(local('./output/' + c.events.path), 'utf8'));
    const native = raw.events.flatMap((e: any) => e.data?.payload?.output?.type === 'sentence-end' ? e.data.payload.output.sentence.words : []);
    const row = asrPlan().requests.find(r => r.id === c.identity.candidate_id)!;
    return { id: c.identity.candidate_id, ...compareRecognition(source, native, loadAsrReference(row, resolve(output, row.id))) };
  });
  save(output, 'comparison.json', { actual_requests: 0, results });
  return { actual_requests: 0, results };
}
async function main() {
  const mode = parseAsrArgs(process.argv.slice(2));
  if (mode === 'dry-run') return { actual_requests: 0, qualification: 'unverified', plan: asrPlan() };
  if (mode === 'analyze') return analyzeSaved();
  const cases = loadReviewCases(); // 全部10份原件摘要及协议证据在联网前验证。
  const plan = asrPlan();
  if (cases.some((c, i) => c.wav_sha256 !== plan.requests[i].wav_sha256 || c.duration_ms !== plan.requests[i].duration_seconds * 1000)) throw Error('asr_evidence_changed');
  const key = process.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!key) throw Error('asr_key_missing');
  return executeAsr(plan, output, (row, dir) => captureAsr(row, dir, key));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(() => { process.stderr.write('asr_command_failed\n'); process.exitCode = 1; });
}
