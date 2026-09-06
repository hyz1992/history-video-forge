import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MATRIX_FILE = resolve(PROJECT_ROOT, 'harness/samples/narration-timing/audio-review-matrix.json');
const MATRIX_SHA256 = 'da48716ae5ca1919db5e3cb80e54a0cf298c327f5fa7edc1209d76ffb60f410b';
const PROMPT_SHA256 = '32192d6f77dc1760ae846d7acdbe07d1a4cabff35f641203d50072f3e6921370';
const MODEL = 'qwen3-omni-flash-2025-12-01';
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const LIVE_OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'harness/scripts/runtime/output/narration-acoustic-quality-live-20260906');
const MAX_BASE64_BYTES = 10_000_000;

type Reader = (file: string) => Buffer;
type MatrixRow = {
  id: string; candidate_id: string; sample_id: string; duration_ms: number;
  wav_file: string; wav_sha256: string; mp3_file: string; mp3_sha256: string; mp3_bytes: number;
  source_file: string; source_sha256: string; focus: string;
  kind: 'full' | 'clip'; clip_start_ms?: number; clip_end_ms?: number; source_audio_duration_ms?: number;
};
type Matrix = {
  schema_version: string; model: string; region: string; endpoint: string; request_count: number;
  parameters: RequestParameters; pricing: Pricing; budget: Budget; prompt: string; rows: MatrixRow[];
};
type RequestParameters = {
  stream: true; stream_options: { include_usage: true }; modalities: ['text'];
  enable_thinking: false; max_tokens: 1800; temperature: 0;
};
type Pricing = {
  audio_input_cny_per_million: number; text_input_cny_per_million: number;
  text_output_cny_per_million: number; source: string;
};
type Budget = { baseline_cny: number; total_cap_cny: number; task_cap_cny: number; estimate_cny: number };
export type ReviewRow = MatrixRow & {
  wav_file: string; mp3_file: string; source_file: string; source_text: string; input_sha256: string;
  estimated_cost_cny: number;
};
export type ReviewPlan = {
  schema_version: string; matrix_sha256: string; prompt_sha256: string; prompt_file: string; prompt_body: string;
  model: string; region: string; endpoint: string; request_count: number; parameters: RequestParameters;
  pricing: Pricing; budget: Budget; requests: ReviewRow[]; plan_fingerprint: string;
};
export type ReviewUsage = {
  audio_input_tokens: number; text_input_tokens: number; text_output_tokens: number; text_output_fallback: boolean;
};
type Score = number | null;
type Review = {
  audio_processed: true; first_heard: string; last_heard: string; acceptable: boolean | null;
  scores: { naturalness: Score; coherence: Score; pronunciation: Score };
  issues: Array<{ severity: 'major' | 'minor' | 'uncertain'; at_seconds: number | null; heard: string; reason: string }>;
  focused_checks: Array<{ check: string; result: 'clear' | 'problem' | 'uncertain'; heard: string; reason?: string }>;
  limitations: string[];
};
export type CaptureResult = {
  status: 'succeeded' | 'failed'; response_id: string | null; response_model: string | null;
  finish_reason: string | null; usage: ReviewUsage | null; raw_chunks: unknown[]; full_text: string;
  review: Review | null; error?: string;
};

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const defaultReader: Reader = file => readFileSync(file);
function frozenBytes(file: string, expected: string, readFile: Reader) {
  const bytes = readFile(file);
  if (!Buffer.isBuffer(bytes) || hash(bytes) !== expected) throw Error('audio_review_frozen_input_changed');
  return bytes;
}
function exactObject(value: unknown, keys: string[]) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function planFingerprint(plan: Omit<ReviewPlan, 'plan_fingerprint'> | ReviewPlan) {
  return hash(JSON.stringify({
    schema_version: plan.schema_version, matrix_sha256: plan.matrix_sha256, prompt_sha256: plan.prompt_sha256,
    prompt_file: plan.prompt_file, prompt_body: plan.prompt_body,
    model: plan.model, region: plan.region, endpoint: plan.endpoint, request_count: plan.request_count,
    parameters: plan.parameters, pricing: plan.pricing, budget: plan.budget,
    requests: plan.requests.map(row => ({ id: row.id, candidate_id: row.candidate_id, sample_id: row.sample_id,
      duration_ms: row.duration_ms, wav_file: row.wav_file, wav_sha256: row.wav_sha256,
      mp3_file: row.mp3_file, mp3_sha256: row.mp3_sha256, mp3_bytes: row.mp3_bytes,
      source_file: row.source_file, source_sha256: row.source_sha256, source_text: row.source_text,
      focus: row.focus, kind: row.kind, clip_start_ms: row.clip_start_ms, clip_end_ms: row.clip_end_ms,
      source_audio_duration_ms: row.source_audio_duration_ms, input_sha256: row.input_sha256,
      estimated_cost_cny: row.estimated_cost_cny })),
  }));
}

export function loadPromptFile(file: string, expectedSha256: string, readFile: Reader = defaultReader) {
  const text = frozenBytes(file, expectedSha256, readFile).toString('utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  if (!match || !/^language:\s*zh-CN\s*$/m.test(match[1])) throw Error('audio_review_prompt_invalid');
  return match[2].trim();
}

export function loadPlan(dependencies: { readFile?: Reader } = {}): ReviewPlan {
  const readFile = dependencies.readFile ?? defaultReader;
  const matrix = JSON.parse(frozenBytes(MATRIX_FILE, MATRIX_SHA256, readFile).toString('utf8')) as Matrix;
  if (matrix.schema_version !== 'narration_audio_review_matrix_v3' || matrix.model !== MODEL
    || matrix.endpoint !== ENDPOINT || matrix.region !== 'cn-beijing' || matrix.request_count !== 4
    || matrix.rows.length !== 4 || matrix.prompt !== 'prompts/asset/narration-audio-review.prompt.md'
    || JSON.stringify(matrix.parameters) !== JSON.stringify({ stream: true, stream_options: { include_usage: true }, modalities: ['text'], enable_thinking: false, max_tokens: 1800, temperature: 0 })
    || JSON.stringify(matrix.budget) !== JSON.stringify({ baseline_cny: 2.8147632, total_cap_cny: 5, task_cap_cny: .45, estimate_cny: .2977824 })
    || matrix.rows.map(row => row.id).join(',') !== 'sample-g,sample-h,sample-i,sample-j'
    || matrix.rows.some(row => row.kind !== 'full' || row.clip_start_ms !== undefined
      || row.clip_end_ms !== undefined || row.source_audio_duration_ms !== undefined)) {
    throw Error('audio_review_matrix_invalid');
  }
  const promptFile = resolve(PROJECT_ROOT, matrix.prompt);
  const promptBody = loadPromptFile(promptFile, PROMPT_SHA256, readFile);
  const totalDurationMs = matrix.rows.reduce((sum, row) => sum + row.duration_ms, 0);
  const requests = matrix.rows.map(row => {
    const wavFile = resolve(PROJECT_ROOT, row.wav_file);
    const mp3File = resolve(PROJECT_ROOT, row.mp3_file);
    const sourceFile = resolve(PROJECT_ROOT, row.source_file);
    frozenBytes(wavFile, row.wav_sha256, readFile);
    const mp3 = frozenBytes(mp3File, row.mp3_sha256, readFile);
    const source = frozenBytes(sourceFile, row.source_sha256, readFile);
    const base64Bytes = Math.ceil(mp3.length / 3) * 4;
    if (mp3.length !== row.mp3_bytes || base64Bytes >= MAX_BASE64_BYTES) throw Error('audio_review_mp3_invalid');
    return { ...row, wav_file: wavFile, mp3_file: mp3File, source_file: sourceFile,
      source_text: source.toString('utf8'),
      input_sha256: hash(`${row.wav_sha256}:${row.mp3_sha256}:${row.source_sha256}:${row.kind}:${row.clip_start_ms ?? ''}:${row.clip_end_ms ?? ''}:${row.source_audio_duration_ms ?? ''}`),
      estimated_cost_cny: Number(Math.max(matrix.budget.estimate_cny / matrix.request_count,
        matrix.budget.estimate_cny * row.duration_ms / totalDurationMs).toFixed(9)) };
  });
  const base = { schema_version: matrix.schema_version, matrix_sha256: MATRIX_SHA256, prompt_sha256: PROMPT_SHA256,
    prompt_file: promptFile, prompt_body: promptBody, model: matrix.model, region: matrix.region,
    endpoint: matrix.endpoint, request_count: matrix.request_count, parameters: matrix.parameters,
    pricing: matrix.pricing, budget: matrix.budget, requests };
  return { ...base, plan_fingerprint: planFingerprint(base) };
}

export function parseArgs(args: string[]): 'dry-run' | 'live' | 'continue-live' {
  if (args.length === 0 || args.length === 1 && args[0] === '--dry-run') return 'dry-run';
  const live = ['--acoustic-quality-only', '--live', '--confirm-live', '--max-requests', '4', '--max-cost-cny', '0.45'];
  if (args.length === live.length && args.every((arg, index) => arg === live[index])) return 'live';
  const continuation = ['--continue-acoustic-quality', '--live', '--confirm-live', '--max-requests', '2', '--max-cost-cny', '0.45'];
  if (args.length === continuation.length && args.every((arg, index) => arg === continuation[index])) return 'continue-live';
  throw Error('audio_review_arguments_invalid');
}

export function buildRequestBody(plan: ReviewPlan, row: ReviewRow, mp3: Buffer) {
  if (plan.model !== MODEL || plan.endpoint !== ENDPOINT || hash(mp3) !== row.mp3_sha256
    || Math.ceil(mp3.length / 3) * 4 >= MAX_BASE64_BYTES) throw Error('audio_review_request_input_invalid');
  return {
    model: MODEL, ...plan.parameters,
    messages: [
      { role: 'system', content: plan.prompt_body },
      { role: 'user', content: [
        { type: 'input_audio', input_audio: { data: `data:;base64,${mp3.toString('base64')}`, format: 'mp3' } },
        { type: 'text', text: JSON.stringify({ sample_id: row.id, kind: row.kind, focus: row.focus }) },
      ] },
    ],
  };
}

export function extractUsage(value: unknown): ReviewUsage {
  const usage = value as Record<string, any> | null;
  const prompt = usage?.prompt_tokens_details;
  const completion = usage?.completion_tokens_details;
  const audio = prompt?.audio_tokens;
  const textIn = prompt?.text_tokens;
  const detailed = completion?.text_tokens;
  const fallback = detailed === undefined ? usage?.completion_tokens : detailed;
  if (!finiteNonnegative(audio) || audio === 0 || !finiteNonnegative(textIn) || !finiteNonnegative(fallback)
    || !Number.isSafeInteger(audio) || !Number.isSafeInteger(textIn) || !Number.isSafeInteger(fallback)) {
    throw Error('audio_review_usage_invalid');
  }
  const promptTotal = usage?.prompt_tokens;
  const completionTotal = usage?.completion_tokens;
  const total = usage?.total_tokens;
  if (promptTotal !== undefined && (!Number.isSafeInteger(promptTotal) || promptTotal !== audio + textIn)
    || detailed !== undefined && completionTotal !== undefined && completionTotal !== detailed
    || total !== undefined && (!Number.isSafeInteger(total) || total !== audio + textIn + fallback))
    throw Error('audio_review_usage_invalid');
  return { audio_input_tokens: audio, text_input_tokens: textIn, text_output_tokens: fallback,
    text_output_fallback: detailed === undefined };
}

export function calculateCost(usage: ReviewUsage, pricing: Pricing) {
  const values = [usage.audio_input_tokens, usage.text_input_tokens, usage.text_output_tokens,
    pricing.audio_input_cny_per_million, pricing.text_input_cny_per_million, pricing.text_output_cny_per_million];
  if (usage.audio_input_tokens === 0 || values.some(value => !finiteNonnegative(value))) throw Error('audio_review_usage_invalid');
  return Number(((usage.audio_input_tokens * pricing.audio_input_cny_per_million
    + usage.text_input_tokens * pricing.text_input_cny_per_million
    + usage.text_output_tokens * pricing.text_output_cny_per_million) / 1_000_000).toFixed(9));
}

function validScore(value: unknown): value is Score {
  return value === null || typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5;
}
export function parseReviewJson(text: string): Review {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```json\s*\r?\n([\s\S]*?)\r?\n```$/i);
  const json = fence ? fence[1].trim() : trimmed;
  let value: any;
  try { value = JSON.parse(json); } catch { throw Error('audio_review_output_invalid'); }
  const valid = exactObject(value, ['audio_processed', 'first_heard', 'last_heard', 'acceptable', 'scores', 'issues', 'focused_checks', 'limitations'])
    && value.audio_processed === true && typeof value.first_heard === 'string' && typeof value.last_heard === 'string'
    && (typeof value.acceptable === 'boolean' || value.acceptable === null)
    && exactObject(value.scores, ['naturalness', 'coherence', 'pronunciation'])
    && validScore(value.scores.naturalness) && validScore(value.scores.coherence) && validScore(value.scores.pronunciation)
    && Array.isArray(value.issues) && value.issues.every((issue: any) => exactObject(issue, ['severity', 'at_seconds', 'heard', 'reason'])
      && ['major', 'minor', 'uncertain'].includes(issue.severity)
      && (issue.at_seconds === null || finiteNonnegative(issue.at_seconds))
      && typeof issue.heard === 'string' && typeof issue.reason === 'string')
    && Array.isArray(value.focused_checks) && value.focused_checks.every((check: any) => (exactObject(check, ['check', 'result', 'heard', 'reason']) || exactObject(check, ['check', 'result', 'heard']))
      && typeof check.check === 'string' && ['clear', 'problem', 'uncertain'].includes(check.result)
      && typeof check.heard === 'string' && (check.reason === undefined || typeof check.reason === 'string'))
    && Array.isArray(value.limitations) && value.limitations.every((item: unknown) => typeof item === 'string');
  if (!valid) throw Error('audio_review_output_invalid');
  return value;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:.*;base64,/s.test(value)) return '[audio-data-removed]';
    if (/^Bearer\s+/i.test(value)) return '[authorization-removed]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, /^(authorization|api[_-]?key)$/i.test(key) ? '[secret-removed]' : redact(item)]));
  return value;
}
function redactRaw(value: string): unknown {
  try { return redact(JSON.parse(value)); }
  catch {
    return value.replace(/("(?:api[_-]?key|authorization)"\s*:\s*")[^"]*(")/gi, '$1[secret-removed]$2')
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [authorization-removed]')
      .replace(/data:[^\s"']*;base64,[A-Za-z0-9+/=]+/g, '[audio-data-removed]');
  }
}

export async function parseSseStream(stream: AsyncIterable<Uint8Array | string>): Promise<CaptureResult> {
  const decoder = new TextDecoder();
  let wire = '';
  let streamFailure = false;
  try {
    for await (const chunk of stream) {
      wire += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      if (wire.length > 5_000_000) { streamFailure = true; break; }
    }
  } catch { streamFailure = true; }
  wire += decoder.decode();
  const events = wire.replace(/\r\n/g, '\n').split(/\n\n+/);
  const rawChunks: unknown[] = [];
  let done = false, responseId: string | null = null, responseModel: string | null = null;
  let finishReason: string | null = null, usage: ReviewUsage | null = null, fullText = '', outputAudio = false;
  let parseFailure = streamFailure;
  for (const event of events) {
    const lines = event.split('\n').filter(line => line.startsWith('data:'));
    if (!lines.length) continue;
    const data = lines.map(line => line.slice(5).trimStart()).join('\n').trim();
    if (data === '[DONE]') { if (done) parseFailure = true; done = true; continue; }
    if (done) parseFailure = true;
    try {
      const chunk = JSON.parse(data);
      rawChunks.push(redact(chunk));
      if (typeof chunk.id === 'string') {
        if (responseId !== null && responseId !== chunk.id) parseFailure = true;
        responseId = chunk.id;
      }
      if (typeof chunk.model === 'string') {
        if (responseModel !== null && responseModel !== chunk.model) parseFailure = true;
        responseModel = chunk.model;
      }
      for (const choice of Array.isArray(chunk.choices) ? chunk.choices : []) {
        if (typeof choice?.delta?.content === 'string') fullText += choice.delta.content;
        if (choice?.delta?.audio !== undefined) outputAudio = true;
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      }
      if (chunk.usage !== undefined && chunk.usage !== null) usage = extractUsage(chunk.usage);
    } catch {
      rawChunks.push({ unparsed: redactRaw(data) });
      parseFailure = true;
    }
  }
  if (wire.trim() && rawChunks.length === 0) rawChunks.push({ unparsed: redactRaw(wire) });
  let review: Review | null = null;
  try { review = parseReviewJson(fullText); } catch { /* 完整回答仍保留供离线分析。 */ }
  const complete = !parseFailure && done && finishReason === 'stop' && usage !== null && review !== null && !outputAudio
    && responseId !== null && responseModel !== null;
  return { status: complete ? 'succeeded' : 'failed', response_id: responseId, response_model: responseModel,
    finish_reason: finishReason, usage, raw_chunks: rawChunks, full_text: fullText,
    review: complete ? review : null, ...(complete ? {} : { error: 'response_incomplete_or_invalid' }) };
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
export async function dispatchReview(plan: ReviewPlan, row: ReviewRow, apiKey: string,
  fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<CaptureResult> {
  try {
    frozenBytes(MATRIX_FILE, MATRIX_SHA256, defaultReader);
    const prompt = frozenBytes(plan.prompt_file, plan.prompt_sha256, defaultReader);
    const source = frozenBytes(row.source_file, row.source_sha256, defaultReader);
    frozenBytes(row.wav_file, row.wav_sha256, defaultReader);
    const mp3 = frozenBytes(row.mp3_file, row.mp3_sha256, defaultReader);
    if (loadPromptFile(plan.prompt_file, plan.prompt_sha256) !== plan.prompt_body
      || source.toString('utf8') !== row.source_text || hash(prompt) !== plan.prompt_sha256)
      throw Error('audio_review_frozen_input_changed');
    const response = await fetcher(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(240_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequestBody(plan, row, mp3)),
    });
    if (!response.body) return { status: 'failed', response_id: null, response_model: null, finish_reason: null,
      usage: null, raw_chunks: [], full_text: '', review: null, error: 'response_body_missing' };
    const parsed = await parseSseStream(response.body as unknown as AsyncIterable<Uint8Array>);
    if (!response.ok || parsed.response_model !== MODEL) return { ...parsed, status: 'failed', review: null,
      error: response.ok ? 'response_model_invalid' : 'response_http_error' };
    return parsed;
  } catch {
    return { status: 'failed', response_id: null, response_model: null, finish_reason: null,
      usage: null, raw_chunks: [], full_text: '', review: null, error: 'request_or_response_failed' };
  }
}

function saveJson(directory: string, name: string, value: unknown) {
  writeFileSync(resolve(directory, name), JSON.stringify(redact(value), null, 2) + '\n');
}

export const CONTINUED_OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'harness/scripts/runtime/output/narration-acoustic-quality-live-20260906-continued');
const ACOUSTIC_PREFIX_HASHES = {
  'result.json': '34fa52d2471cb4cac02df48cb65d157c113181252e6ea73edfa3ce0f2acee03b',
  'sample-g/capture.json': '48fa59874ab056fc4629716d202d7d31c0cd9b9ce687bafd5b5c13f2d722018b',
  'sample-g/dispatch-intent.json': 'c6b2637ed7aeb4d19da6099232e2331b44003a21e6db10f5f6a273e926617b3b',
  'sample-h/capture.json': 'f28a969c2bf17ef08b1ce23a4fd22c6f245d92777a72592d2182940febcaa01e',
  'sample-h/dispatch-intent.json': '27c25528cc5367dd79aa4757af97553e95942ab56b28e76bf72ddb604b7aa5de',
} as const;

// 仅核销这次已经派发的固定两项；原始失败状态和文件不改写，也不据此授予资格。
export function loadAcousticResumePrefix(plan: ReviewPlan, readFile: Reader = defaultReader) {
  const archived = Object.fromEntries(Object.entries(ACOUSTIC_PREFIX_HASHES).map(([file, digest]) =>
    [file, JSON.parse(frozenBytes(resolve(LIVE_OUTPUT_DIRECTORY, file), digest, readFile).toString('utf8'))]));
  const result = archived['result.json'];
  if (result.actual_requests !== 2 || result.stopped_reason !== 'audio_review_unverified_or_failed')
    throw Error('audio_review_prefix_invalid');
  const calls = plan.requests.slice(0, 2).map(row => {
    const intent = archived[row.id + '/dispatch-intent.json'];
    const capture = archived[row.id + '/capture.json'] as CaptureResult;
    if (!intent || !capture || intent.input_sha256 !== row.input_sha256 || intent.id !== row.id
      || intent.model !== plan.model || intent.endpoint !== plan.endpoint || !capture.response_id
      || capture.response_model !== plan.model || capture.finish_reason !== 'stop' || !capture.usage)
      throw Error('audio_review_prefix_invalid');
    const chunks = capture.raw_chunks as Array<Record<string, any>>;
    if (chunks.some(chunk => chunk.id !== capture.response_id || chunk.model !== plan.model))
      throw Error('audio_review_prefix_invalid');
    const reportedUsage = extractUsage(chunks.at(-1)?.usage);
    if (JSON.stringify(reportedUsage) !== JSON.stringify(capture.usage)) throw Error('audio_review_prefix_invalid');
    const reconstructed = chunks.flatMap(chunk => chunk.choices ?? [])
      .map(choice => typeof choice.delta?.content === 'string' ? choice.delta.content : '').join('');
    if (reconstructed !== capture.full_text) throw Error('audio_review_prefix_invalid');
    parseReviewJson(capture.full_text);
    return { id: row.id, original_status: capture.status, response_id: capture.response_id,
      input_sha256: row.input_sha256, usage_cost_cny: calculateCost(reportedUsage, plan.pricing),
      cost_basis: 'provider_final_usage_times_frozen_rates_not_invoice', qualification: 'unverified' };
  });
  if (new Set(calls.map(call => call.response_id)).size !== 2) throw Error('audio_review_prefix_invalid');
  return { calls, known_cost_cny: Number(calls.reduce((sum, call) => sum + call.usage_cost_cny, 0).toFixed(9)) };
}

type Dispatcher = (row: ReviewRow) => Promise<CaptureResult>;
export async function executeReview(plan: ReviewPlan, outputDirectory: string, dispatcher: Dispatcher,
  options: { continueAcoustic?: boolean; prefixReader?: Reader } = {}) {
  const fresh = loadPlan();
  if (planFingerprint(plan) !== plan.plan_fingerprint || plan.plan_fingerprint !== fresh.plan_fingerprint)
    throw Error('audio_review_plan_changed');
  const previous = options.continueAcoustic ? loadAcousticResumePrefix(plan, options.prefixReader) : { calls: [], known_cost_cny: 0 };
  try { mkdirSync(outputDirectory); } catch (error: any) {
    if (error?.code === 'EEXIST') throw Error('audio_review_output_exists');
    throw error;
  }
  const calls: Array<Record<string, unknown>> = [];
  let knownCost = previous.known_cost_cny;
  let actualRequests = 0;
  let stoppedReason: string | null = null;
  for (const row of plan.requests.slice(previous.calls.length)) {
    if (knownCost + row.estimated_cost_cny > plan.budget.task_cap_cny
      || plan.budget.baseline_cny + knownCost + row.estimated_cost_cny > plan.budget.total_cap_cny) {
      stoppedReason = 'cost_limit_before_dispatch';
      break;
    }
    const rowDirectory = resolve(outputDirectory, row.id);
    mkdirSync(rowDirectory);
    saveJson(rowDirectory, 'dispatch-intent.json', { id: row.id, model: plan.model, endpoint: plan.endpoint,
      input_sha256: row.input_sha256, wav_sha256: row.wav_sha256, mp3_sha256: row.mp3_sha256,
      source_sha256: row.source_sha256, kind: row.kind, clip_start_ms: row.clip_start_ms,
      clip_end_ms: row.clip_end_ms, source_audio_duration_ms: row.source_audio_duration_ms,
      max_requests: plan.request_count - previous.calls.length, max_cost_cny: plan.budget.task_cap_cny,
      previous_requests: previous.calls.length, previous_cost_cny: previous.known_cost_cny,
      baseline_cny: plan.budget.baseline_cny, qualification: 'unverified' });
    actualRequests++;
    let capture: CaptureResult;
    try { capture = await dispatcher(row); }
    catch { capture = { status: 'failed', response_id: null, response_model: null, finish_reason: null,
      usage: null, raw_chunks: [], full_text: '', review: null, error: 'dispatcher_failed' }; }
    saveJson(rowDirectory, 'capture.json', capture);
    let cost: number | null = null;
    if (capture.status === 'succeeded' && capture.usage && capture.review && capture.response_id
      && capture.response_model === plan.model && capture.finish_reason === 'stop') {
      try { cost = calculateCost(capture.usage, plan.pricing); } catch { cost = null; }
    }
    const call = { id: row.id, status: capture.status, response_id: capture.response_id,
      response_model: capture.response_model, finish_reason: capture.finish_reason, usage: capture.usage,
      usage_cost_cny: cost, usage_cost_basis: 'usage_times_frozen_matrix_rates_not_invoice', qualification: 'unverified' };
    calls.push(call);
    if (cost === null) { stoppedReason = 'audio_review_unverified_or_failed'; break; }
    knownCost = Number((knownCost + cost).toFixed(9));
    if (knownCost > plan.budget.task_cap_cny
      || plan.budget.baseline_cny + knownCost > plan.budget.total_cap_cny) { stoppedReason = 'cost_limit'; break; }
  }
  const unknown = stoppedReason === 'audio_review_unverified_or_failed';
  const result = { actual_requests: actualRequests, previous_requests: previous.calls.length,
    total_requests: previous.calls.length + actualRequests, previous_cost_cny: previous.known_cost_cny,
    previous_calls: previous.calls, qualification: 'unverified', calls, stopped_reason: stoppedReason,
    cost_basis: 'usage_times_frozen_matrix_rates_not_invoice',
    actual_cost_cny: unknown ? null : knownCost,
    accounted_cost_cny: unknown ? plan.budget.task_cap_cny : knownCost,
    total_accounted_cost_cny: Number((plan.budget.baseline_cny + (unknown ? plan.budget.task_cap_cny : knownCost)).toFixed(9)) };
  saveJson(outputDirectory, 'result.json', result);
  return result;
}

function publicPlan(plan: ReviewPlan) {
  return { schema_version: plan.schema_version, model: plan.model, endpoint: plan.endpoint,
    request_count: plan.request_count, parameters: plan.parameters, pricing: plan.pricing, budget: plan.budget,
    matrix_sha256: plan.matrix_sha256, prompt_sha256: plan.prompt_sha256,
    requests: plan.requests.map(row => ({ id: row.id, input_sha256: row.input_sha256,
      wav_sha256: row.wav_sha256, mp3_sha256: row.mp3_sha256, mp3_bytes: row.mp3_bytes,
      source_sha256: row.source_sha256, kind: row.kind, clip_start_ms: row.clip_start_ms,
      clip_end_ms: row.clip_end_ms, source_audio_duration_ms: row.source_audio_duration_ms,
      estimated_cost_cny: row.estimated_cost_cny })) };
}
async function main() {
  const mode = parseArgs(process.argv.slice(2));
  const plan = loadPlan();
  if (mode === 'dry-run') return { actual_requests: 0, qualification: 'unverified', plan: publicPlan(plan) };
  const apiKey = process.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!apiKey) throw Error('audio_review_key_missing');
  return executeReview(plan, mode === 'continue-live' ? CONTINUED_OUTPUT_DIRECTORY : LIVE_OUTPUT_DIRECTORY,
    row => dispatchReview(plan, row, apiKey), { continueAcoustic: mode === 'continue-live' });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(() => { process.stderr.write('audio_review_command_failed\n'); process.exitCode = 1; });
}
