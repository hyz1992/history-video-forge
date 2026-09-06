import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { calculateCost, extractUsage, loadPromptFile, parseReviewJson, parseSseStream, type CaptureResult } from './narration-audio-review.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MATRIX = resolve(ROOT, 'harness/samples/narration-timing/omni35-review-matrix.json');
const MATRIX_SHA = '05f6214f1b00410b4b92b98d9ff4637d3dd88ca541ccc559aa60d708ef994878';
const PROMPT_SHA = '32192d6f77dc1760ae846d7acdbe07d1a4cabff35f641203d50072f3e6921370';
const MODEL = 'qwen3.5-omni-plus-2026-03-15';
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const OUTPUT_ROOT = resolve(ROOT, 'harness/scripts/runtime/output');
const OUTPUT_NAMES = { 'probe-live': 'narration-omni35-probe-live-20260906', 'samples-live': 'narration-omni35-samples-live-20260906' } as const;
export const PROBE_OUTPUT_DIRECTORY = resolve(OUTPUT_ROOT, OUTPUT_NAMES['probe-live']);
export const SAMPLES_OUTPUT_DIRECTORY = resolve(OUTPUT_ROOT, OUTPUT_NAMES['samples-live']);
const MAX_WIRE_BYTES = 5_000_000;
const MAX_BASE64_BYTES = 10_000_000;
type Reader = (file: string) => Buffer;
type Writer = (file: string, data: string, options: { flag: 'wx' }) => void;
type StreamState = 'complete' | 'interrupted' | 'limit_exceeded' | 'not_received';
type Mode = keyof typeof OUTPUT_NAMES;
type Parameters = { stream: true; stream_options: { include_usage: true }; modalities: ['text']; max_tokens: 1200; temperature: 0 };
type Row = { id: string; duration_ms: number; wav_file: string; wav_sha256: string; mp3_file: string;
  mp3_sha256: string; mp3_bytes: number; source_file: string; source_sha256: string; focus: string; kind: 'full' };
type Pricing = { audio_input_cny_per_million: number; text_input_cny_per_million: number; text_output_cny_per_million: number; source: string };
type Matrix = { schema_version: string; baseline_commit: string; model: string; region: string; endpoint: string; request_count: number;
  parameters: Parameters; pricing: Pricing; budget: { baseline_cny: number; total_cap_cny: number; task_cap_cny: number; probe_cap_cny: number };
  prompt: string; rows: Row[] };
export type ReviewRow = Row & { input_sha256: string; audio_input_token_reserve: number; text_input_utf8_bytes: number;
  text_input_token_reserve: number; text_output_token_reserve: number; estimated_cost_cny: number };
export type ReviewPlan = Omit<Matrix, 'rows' | 'prompt'> & { matrix_sha256: string; prompt_sha256: string; prompt_file: string;
  prompt_body: string; requests: ReviewRow[]; plan_fingerprint: string };
export type Capture = CaptureResult & { raw_events: string[]; stream_state: StreamState; qualification: 'unverified' };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Dispatcher = (row: ReviewRow) => Promise<Capture>;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const read: Reader = file => readFileSync(file);
const round = (n: number) => Number(n.toFixed(9));
function fingerprint(plan: Omit<ReviewPlan, 'plan_fingerprint'> | ReviewPlan) {
  const { plan_fingerprint: _ignored, ...rest } = plan as ReviewPlan;
  return hash(JSON.stringify(rest));
}
function frozen(file: string, digest: string, reader: Reader) {
  const bytes = reader(file);
  if (!Buffer.isBuffer(bytes) || hash(bytes) !== digest) throw Error('omni35_frozen_input_changed');
  return bytes;
}
const metadata = (row: Row) => JSON.stringify({ sample_id: row.id, kind: row.kind, focus: row.focus });

export function loadPlan(options: { readFile?: Reader } = {}): ReviewPlan {
  const reader = options.readFile ?? read;
  const m = JSON.parse(frozen(MATRIX, MATRIX_SHA, reader).toString('utf8')) as Matrix;
  const promptFile = resolve(ROOT, m.prompt);
  const promptBody = loadPromptFile(promptFile, PROMPT_SHA, reader);
  const requests = m.rows.map(row => {
    const wavFile = resolve(ROOT, row.wav_file), mp3File = resolve(ROOT, row.mp3_file), sourceFile = resolve(ROOT, row.source_file);
    frozen(wavFile, row.wav_sha256, reader); frozen(sourceFile, row.source_sha256, reader);
    const mp3 = frozen(mp3File, row.mp3_sha256, reader);
    if (mp3.length !== row.mp3_bytes || Math.ceil(mp3.length / 3) * 4 >= MAX_BASE64_BYTES) throw Error('omni35_audio_invalid');
    const audioTokens = Math.ceil(row.duration_ms / 1000) * 7;
    const textBytes = Buffer.byteLength(promptBody + metadata(row), 'utf8');
    return { ...row, wav_file: wavFile, mp3_file: mp3File, source_file: sourceFile,
      input_sha256: hash([row.id, row.wav_sha256, row.mp3_sha256, row.source_sha256, row.kind, row.duration_ms, row.focus].join(':')),
      audio_input_token_reserve: audioTokens, text_input_utf8_bytes: textBytes, text_input_token_reserve: textBytes + 1024,
      text_output_token_reserve: 1200,
      estimated_cost_cny: round((audioTokens * 53 + (textBytes + 1024) * 7 + 1200 * 40) / 1_000_000) };
  });
  if (requests[0].estimated_cost_cny > .25 || requests.reduce((s, r) => s + r.estimated_cost_cny, 0) > .65
    || m.budget.baseline_cny + .65 > 5) throw Error('omni35_reserve_exceeds_budget');
  const { rows: _rows, prompt: _prompt, ...base } = m;
  const plan = { ...base, matrix_sha256: MATRIX_SHA, prompt_sha256: PROMPT_SHA, prompt_file: promptFile, prompt_body: promptBody, requests };
  return { ...plan, plan_fingerprint: fingerprint(plan) };
}
function revalidate(plan: ReviewPlan, reader: Reader = read) {
  const fresh = loadPlan({ readFile: reader });
  if (fingerprint(plan) !== plan.plan_fingerprint || plan.plan_fingerprint !== fresh.plan_fingerprint)
    throw Error('omni35_plan_changed');
}
export function parseArgs(args: string[]): 'dry-run' | Mode {
  if (!args.length || JSON.stringify(args) === JSON.stringify(['--dry-run'])) return 'dry-run';
  for (const [mode, count, cap] of [['probe-live', '1', '0.25'], ['samples-live', '3', '0.65']] as const) {
    if (JSON.stringify(args) === JSON.stringify(['--' + mode, '--confirm-live', '--max-requests', count, '--max-cost-cny', cap])) return mode;
  }
  throw Error('omni35_arguments_invalid');
}
export function buildRequestBody(plan: ReviewPlan, row: ReviewRow, mp3: Buffer) {
  if (fingerprint(plan) !== plan.plan_fingerprint || plan.model !== MODEL || plan.endpoint !== ENDPOINT
    || !plan.requests.some(r => JSON.stringify(r) === JSON.stringify(row)) || hash(mp3) !== row.mp3_sha256
    || mp3.length !== row.mp3_bytes || Math.ceil(mp3.length / 3) * 4 >= MAX_BASE64_BYTES) throw Error('omni35_request_invalid');
  return { model: MODEL, ...plan.parameters, messages: [
    { role: 'system', content: plan.prompt_body },
    { role: 'user', content: [
      { type: 'input_audio', input_audio: { data: 'data:;base64,' + mp3.toString('base64'), format: 'mp3' } },
      { type: 'text', text: metadata(row) },
    ] },
  ] };
}

// 只脱敏凭据和音频编码；语义判断保留给完整回答的独立人工/agent审查。
function redactText(text: string, apiKey = '') {
  let safe = apiKey ? text.split(apiKey).join('[secret-removed]') : text;
  safe = safe.replace(/("(?:api[_-]?key|authorization)"\s*:\s*")[^"]*(")/gi, '$1[secret-removed]$2')
    .replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [secret-removed]')
    .replace(/data:[^\s"']*;base64,[A-Za-z0-9+/=]+/g, '[audio-data-removed]');
  return safe;
}
function failed(error: string): Capture {
  return { status: 'failed', response_id: null, response_model: null, finish_reason: null, usage: null,
    raw_chunks: [], raw_events: [], stream_state: 'not_received', full_text: '', review: null, error, qualification: 'unverified' };
}
export async function captureSse(stream: AsyncIterable<Uint8Array | string>, apiKey = ''): Promise<Capture> {
  const buffers: Buffer[] = [];
  let size = 0;
  let streamState: StreamState = 'complete';
  try {
    for await (const chunk of stream) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      const remaining = MAX_WIRE_BYTES - size;
      buffers.push(bytes.subarray(0, Math.max(0, remaining)));
      size += bytes.length;
      if (size > MAX_WIRE_BYTES) { streamState = 'limit_exceeded'; break; }
    }
  } catch { streamState = 'interrupted'; }
  const wire = redactText(Buffer.concat(buffers).toString('utf8'), apiKey).replace(/\r\n/g, '\n');
  const events = wire.split(/\n\n+/).filter(event => event.trim().length > 0);
  const parsed = await parseSseStream((async function* () { yield wire; if (streamState !== 'complete') throw Error('stream_interrupted'); })());
  const capture: Capture = { ...parsed, raw_events: events, stream_state: streamState, qualification: 'unverified' };
  // 保留异常原始事件；身份和结构拒绝不得抛出并丢弃已收证据。
  if (capture.response_model !== MODEL || capture.raw_chunks.some(c => !validChunk(c, capture.response_id)))
    return { ...capture, status: 'failed', review: null, error: 'response_identity_or_shape_invalid' };
  return capture;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validChunk(value: unknown, id: string | null): boolean {
  if (!isObject(value) || value.id !== id || value.model !== MODEL) return false;
  if (value.choices === undefined) return true;
  return Array.isArray(value.choices) && value.choices.every(choice => isObject(choice)
    && (choice.delta === undefined || isObject(choice.delta) && choice.delta.audio === undefined));
}
type Observation = Omit<NonNullable<CaptureResult['review']>, 'limitations'> & { limitations: string | string[] };
export function decodeObservation(text: string): Observation {
  try { return parseReviewJson(text); } catch { /* 仅兼容解释字段的单个字符串。 */ }
  const trimmed = text.trim();
  const fence = trimmed.match(/^```json\s*\r?\n([\s\S]*?)\r?\n```$/i);
  const json = fence ? fence[1].trim() : trimmed;
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw Error('audio_review_output_invalid'); }
  if (!isObject(value) || typeof value.limitations !== 'string') throw Error('audio_review_output_invalid');
  const limitations = value.limitations;
  const checked = parseReviewJson(JSON.stringify({ ...value, limitations: [limitations] }, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw Error('audio_review_output_invalid');
    return item;
  }));
  return { ...checked, limitations };
}
async function verifiedCapture(capture: Capture, requireReview = true) {
  if (capture.stream_state !== 'complete' || !Array.isArray(capture.raw_events) || capture.raw_events.some(e => typeof e !== 'string')
    || Buffer.byteLength(capture.raw_events.join('\n\n'), 'utf8') > MAX_WIRE_BYTES)
    throw Error('omni35_capture_invalid');
  const replay = await captureSse((async function* () { yield capture.raw_events.join('\n\n') + '\n\n'; })());
  for (const key of ['status', 'response_id', 'response_model', 'finish_reason', 'usage', 'raw_chunks', 'full_text', 'review'] as const) {
    if (JSON.stringify(capture[key]) !== JSON.stringify(replay[key])) throw Error('omni35_capture_invalid');
  }
  const doneEvents = replay.raw_events.filter(e => e.trim() === 'data: [DONE]');
  if (replay.response_model !== MODEL || !replay.response_id
    || replay.finish_reason !== 'stop' || !replay.usage || capture.qualification !== 'unverified'
    || doneEvents.length !== 1 || replay.raw_events.at(-1)?.trim() !== 'data: [DONE]'
    || replay.raw_chunks.some(c => !validChunk(c, replay.response_id))) throw Error('omni35_capture_invalid');
  const final = replay.raw_chunks.at(-1) as { usage?: unknown };
  const usage = extractUsage(final?.usage);
  if (JSON.stringify(usage) !== JSON.stringify(replay.usage)) throw Error('omni35_final_usage_invalid');
  let observation: Observation | null = null;
  if (capture.status === 'succeeded' || capture.error === 'response_incomplete_or_invalid') {
    try { observation = decodeObservation(replay.full_text); } catch { /* 原始失败保留，只记录解释状态。 */ }
  }
  if (requireReview && !observation) throw Error('omni35_observation_invalid');
  return { replay, observation, cost: calculateCost(usage, loadPricing()) };
}
function loadPricing(): Pricing {
  return { audio_input_cny_per_million: 53, text_input_cny_per_million: 7, text_output_cny_per_million: 40,
    source: 'https://help.aliyun.com/zh/model-studio/model-pricing' };
}
export async function dispatchReview(plan: ReviewPlan, row: ReviewRow, apiKey: string,
  fetcher: Fetcher = (url, init) => fetch(url, init)): Promise<Capture> {
  // 校验失败在POST前抛出；没有retry或重定向回退。
  revalidate(plan);
  const body = buildRequestBody(plan, row, frozen(row.mp3_file, row.mp3_sha256, read));
  try {
    const response = await fetcher(ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(240_000),
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.body) return failed('response_body_missing');
    const capture = await captureSse(response.body as unknown as AsyncIterable<Uint8Array>, apiKey);
    return response.ok ? capture : { ...capture, status: 'failed', review: null, error: 'response_http_error' };
  } catch { return failed('request_or_response_failed'); }
}
function save(directory: string, name: string, value: unknown, writer: Writer = writeFileSync) {
  writer(resolve(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
function strictObject(value: unknown, keys: string[]) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
async function loadControl(plan: ReviewPlan, base: string, reader: Reader) {
  const directory = resolve(base, OUTPUT_NAMES['probe-live']);
  const adjudication = JSON.parse(reader(resolve(directory, 'control-adjudication.json')).toString('utf8'));
  if (!strictObject(adjudication, ['schema_version','passed','capture_sha256','plan_fingerprint','response_id','input_sha256','reason','independent_review_ref'])
    || adjudication.schema_version !== 'narration_omni35_control_adjudication_v1' || adjudication.passed !== true
    || typeof adjudication.reason !== 'string' || !adjudication.reason.trim()
    || typeof adjudication.independent_review_ref !== 'string' || !adjudication.independent_review_ref.trim())
    throw Error('omni35_adjudication_invalid');
  const row = plan.requests[0];
  const bytes = reader(resolve(directory, row.id, 'capture.json'));
  const capture = JSON.parse(bytes.toString('utf8')) as Capture;
  const intent = JSON.parse(reader(resolve(directory, row.id, 'dispatch-intent.json')).toString('utf8'));
  if (adjudication.capture_sha256 !== hash(bytes) || adjudication.plan_fingerprint !== plan.plan_fingerprint
    || adjudication.input_sha256 !== row.input_sha256 || adjudication.response_id !== capture.response_id
    || intent.id !== row.id || intent.input_sha256 !== row.input_sha256 || intent.plan_fingerprint !== plan.plan_fingerprint
    || intent.model !== MODEL || intent.endpoint !== ENDPOINT || intent.max_requests !== 1 || intent.max_cost_cny !== .25
    || intent.qualification !== 'unverified' || capture.qualification !== 'unverified')
    throw Error('omni35_control_binding_invalid');
  const { cost, observation } = await verifiedCapture(capture);
  if (observation?.acceptable !== false || !observation.issues.some(issue => issue.severity === 'major'
    && typeof issue.at_seconds === 'number' && Number.isFinite(issue.at_seconds) && issue.at_seconds >= 129 && issue.at_seconds <= 147))
    throw Error('omni35_control_evidence_invalid');
  if (cost > .25) throw Error('omni35_probe_budget_exceeded');
  return { cost, response_id: capture.response_id! };
}

// 注入仅用于本地单元测试。CLI从不接受目录、reader、dispatcher或模型覆盖。
export async function executeReview(plan: ReviewPlan, mode: Mode, dispatcher: Dispatcher,
  options: { outputRoot?: string; readFile?: Reader; writeFile?: Writer } = {}) {
  if (!(mode in OUTPUT_NAMES)) throw Error('omni35_mode_invalid');
  const reader = options.readFile ?? read, base = options.outputRoot ?? OUTPUT_ROOT, writer = options.writeFile ?? writeFileSync;
  revalidate(plan, reader);
  const previous = mode === 'samples-live' ? await loadControl(plan, base, reader) : { cost: 0, response_id: null };
  const rows = mode === 'probe-live' ? plan.requests.slice(0, 1) : plan.requests.slice(1);
  const stageCap = mode === 'probe-live' ? .25 : .65;
  if (previous.cost + rows.reduce((s, row) => s + row.estimated_cost_cny, 0) > stageCap) throw Error('omni35_stage_budget_exceeded');
  const directory = resolve(base, OUTPUT_NAMES[mode]);
  try { mkdirSync(directory); } catch (error: any) {
    if (error?.code === 'EEXIST') throw Error('omni35_output_exists');
    throw error;
  }
  // POST前持久化整组占额；若后续写盘失败，无最终result时此记录仍为费用依据。
  save(directory, 'pending-accounting.json', { status: 'pending_evidence', actual_cost_cny: null,
    accounted_cost_cny: .65, total_accounted_cost_cny: round(plan.budget.baseline_cny + .65),
    max_requests: rows.length, previous_requests: mode === 'samples-live' ? 1 : 0,
    previous_cost_cny: previous.cost, plan_fingerprint: plan.plan_fingerprint, qualification: 'unverified' }, writer);
  const calls: Array<Record<string, unknown>> = [];
  const identities = new Set(previous.response_id ? [previous.response_id] : []);
  let knownCost = previous.cost, stoppedReason: string | null = null, unknown = false;
  for (const row of rows) {
    try { revalidate(plan, reader); } catch { stoppedReason = 'frozen_input_changed_before_dispatch'; break; }
    if (knownCost + row.estimated_cost_cny > stageCap || plan.budget.baseline_cny + knownCost + row.estimated_cost_cny > 5) {
      stoppedReason = 'cost_limit_before_dispatch'; break;
    }
    const rowDirectory = resolve(directory, row.id); mkdirSync(rowDirectory);
    save(rowDirectory, 'dispatch-intent.json', { id: row.id, model: MODEL, endpoint: ENDPOINT, plan_fingerprint: plan.plan_fingerprint,
      input_sha256: row.input_sha256, wav_sha256: row.wav_sha256, mp3_sha256: row.mp3_sha256, source_sha256: row.source_sha256,
      kind: row.kind, max_requests: rows.length, max_cost_cny: stageCap, baseline_cny: plan.budget.baseline_cny,
      previous_requests: mode === 'samples-live' ? 1 : 0, previous_cost_cny: previous.cost,
      reserved_cost_cny: row.estimated_cost_cny, qualification: 'unverified' }, writer);
    let capture: Capture;
    try { capture = await dispatcher(row); } catch { capture = failed('dispatcher_failed'); }
    save(rowDirectory, 'capture.json', capture, writer);
    writer(resolve(rowDirectory, 'full-text.txt'), capture.full_text, { flag: 'wx' });
    let cost: number | null = null, observation: Observation | null = null;
    try {
      const checked = await verifiedCapture(capture, false);
      if (identities.has(checked.replay.response_id!)) throw Error('response_identity_reused');
      identities.add(checked.replay.response_id!); cost = checked.cost; observation = checked.observation;
    } catch { /* 无法核实的计费占用整组预留，并停止。 */ }
    calls.push({ id: row.id, status: capture.status, response_id: capture.response_id, response_model: capture.response_model,
      finish_reason: capture.finish_reason, usage: capture.usage, usage_cost_cny: cost, observation_status: observation ? 'valid' : 'invalid', qualification: 'unverified' });
    if (cost === null) { unknown = true; stoppedReason = 'response_unverified_or_failed'; break; }
    knownCost = round(knownCost + cost);
    if (knownCost > stageCap || plan.budget.baseline_cny + knownCost > 5) { stoppedReason = 'cost_limit'; break; }
    if (!observation) { stoppedReason = 'response_failed_with_verified_usage'; break; }
  }
  const accounted = unknown ? .65 : knownCost;
  const result = { actual_requests: calls.length, previous_requests: mode === 'samples-live' ? 1 : 0,
    total_requests: calls.length + (mode === 'samples-live' ? 1 : 0), previous_cost_cny: previous.cost,
    actual_cost_cny: unknown ? null : knownCost, accounted_cost_cny: accounted,
    total_accounted_cost_cny: round(plan.budget.baseline_cny + accounted), calls, stopped_reason: stoppedReason,
    plan_fingerprint: plan.plan_fingerprint, qualification: 'unverified',
    cost_basis: 'provider_final_usage_times_frozen_rates_not_invoice' };
  save(directory, 'result.json', result, writer);
  return result;
}
function publicPlan(plan: ReviewPlan) {
  const { prompt_body: _body, ...safe } = plan;
  return safe;
}
async function main() {
  const mode = parseArgs(process.argv.slice(2)), plan = loadPlan();
  if (mode === 'dry-run') return { actual_requests: 0, qualification: 'unverified', plan: publicPlan(plan) };
  const key = process.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!key) throw Error('omni35_key_missing');
  return executeReview(plan, mode, row => dispatchReview(plan, row, key));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(() => { process.stderr.write('omni35_command_failed\n'); process.exitCode = 1; });
}
