import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { QualifiedNarrationSettings } from '../../../../../shared/src/index.js';
import { NativeNarrationSentence } from '../narration-timing-normalizer.js';

export type NarrationRemoteOutcome = 'not_started' | 'unknown' | 'failed' | 'completed';
export interface NarrationUsageReceipt {
  characters: number; kind: 'partial' | 'final'; providerTaskId: string; providerRequestId: string | null;
}
export class NarrationProviderError extends Error {
  constructor(readonly code: string, readonly receipt: NarrationUsageReceipt | null = null, readonly remoteOutcome: NarrationRemoteOutcome = 'unknown') {
    super(code); this.name = 'NarrationProviderError';
    const identity = z.string().min(1).refine(s => s.trim() === s);
    const parsed = z.object({characters:z.number().int().safe().nonnegative(),kind:z.enum(['partial','final']),providerTaskId:identity,providerRequestId:identity.nullable()}).strict().nullable().safeParse(receipt);
    if (!parsed.success) throw new Error('narration_receipt_invalid');
    this.receipt = parsed.data === null ? null : Object.freeze(parsed.data);
  }
}
const reject = (code: string): never => { throw new NarrationProviderError(code, null, 'not_started'); };
const Request = z.object({ sourceText: z.string(), settings: QualifiedNarrationSettings }).strict();
export type NarrationSpeechRequest = z.infer<typeof Request>;
export interface NarrationCallOptions { signal?: AbortSignal; }
export function parseNarrationSpeechRequest(value: unknown): NarrationSpeechRequest {
  const result = Request.safeParse(value);
  if (!result.success) return reject('narration_request_invalid');
  splitNarrationParagraphs(result.data.sourceText);
  return result.data;
}
export function splitNarrationParagraphs(text: string): string[] {
  if (!text.length || !text.trim()) return reject('narration_text_empty');
  if (text.length > 20000) return reject('narration_text_too_long');
  // 单条 continue-task 上限按官方协议为 20000 字符（累计 200000），总长检查已覆盖。
  // 早前"单自然段 ≤534"为资格期实测样本的保守自限，无协议依据，已移除（2026-09-11）。
  const parts = text.match(/[^\n]*\n|[^\n]+$/g)!;
  if (parts.join('') !== text) return reject('narration_text_invalid');
  return parts;
}

/** 单段拆分阈值：非协议边界（官方单条上限 20000），也非质量测定值。
 *  唯一依据：资格期实测通过的最大单段为 534 字；698 字单段实测被供应商
 *  整段合并为一句（时间校验失败）。取 534 是保守落在"有通过证据的区间"内；
 *  更高阈值可在付费实测后上调。 */
const SAFE_INPUT_CHUNK_LENGTH = 534;
const SENTENCE_END_PATTERN = /[。！？；…]/u;
const TRAILING_QUOTE_PATTERN = /[”』）」"'）]/u;

export function splitNarrationInputs(text: string): string[] {
  const paragraphs = splitNarrationParagraphs(text);
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= SAFE_INPUT_CHUNK_LENGTH) {
      chunks.push(paragraph);
      continue;
    }
    let rest = paragraph;
    while (rest.length > SAFE_INPUT_CHUNK_LENGTH) {
      const window = rest.slice(0, SAFE_INPUT_CHUNK_LENGTH);
      let cut = -1;
      for (let i = window.length - 1; i >= Math.floor(SAFE_INPUT_CHUNK_LENGTH / 2); i -= 1) {
        if (SENTENCE_END_PATTERN.test(window[i]!)) { cut = i + 1; break; }
      }
      if (cut === -1) cut = SAFE_INPUT_CHUNK_LENGTH;
      // 句末标点后的闭合引号/括号一并归入当前块，避免下块以引号开头
      while (cut < rest.length && TRAILING_QUOTE_PATTERN.test(rest[cut]!)) cut += 1;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}
export interface SpeechSocket {
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(text: string): unknown;
  close(): unknown;
  terminate(): unknown;
}
export interface SpeechSocketOptions { headers: { Authorization: string }; followRedirects: false; handshakeTimeout: number; maxPayload: number; }
export type SpeechSocketFactory = (url: string, options: SpeechSocketOptions) => SpeechSocket;
export type NarrationRawEvent = { kind: 'json'; elapsedMs: number; data: unknown } |
  { kind: 'audio'; elapsedMs: number; byteOffset: number; byteLength: number };
export interface NarrationSpeechCapture {
  pcm: Buffer; sentences: NativeNarrationSentence[]; rawEvents: NarrationRawEvent[];
  providerTaskId: string; providerRequestId: string | null; usageCharacters: number | null;
}
export interface NarrationSpeechClient { synthesize(input: unknown, options?: NarrationCallOptions): Promise<NarrationSpeechCapture>; }
interface ClientOptions { apiKey: string; socketFactory?: SpeechSocketFactory; taskIdFactory?: () => string; timeoutMs?: number; }
const defaultSocketFactory: SpeechSocketFactory = (url, options) => {
  const WebSocket = createRequire(import.meta.url)('ws') as new (url: string, options: SpeechSocketOptions) => SpeechSocket;
  return new WebSocket(url, options);
};
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** 仅已资格化的共用WS事件/累计token序号/累计毫秒/PCM布局；不替换旧HTTP路径。 */
export class DashScopeSpeechWsClient implements NarrationSpeechClient {
  constructor(private readonly options: ClientOptions) {}
  async synthesize(value: unknown, options: NarrationCallOptions = {}): Promise<NarrationSpeechCapture> {
    const input = parseNarrationSpeechRequest(value), parts = splitNarrationInputs(input.sourceText);
    if (options.signal?.aborted) return reject('narration_cancelled');
    if (typeof this.options.apiKey !== 'string' || !this.options.apiKey.trim()) return reject('narration_credentials_missing');
    const timeoutMs = this.options.timeoutMs ?? 180000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) return reject('narration_request_invalid');
    let socket: SpeechSocket, taskId: string;
    try {
      taskId = (this.options.taskIdFactory ?? randomUUID)();
      if (typeof taskId !== 'string' || !taskId.trim() || taskId.trim() !== taskId) return reject('narration_request_invalid');
      socket = (this.options.socketFactory ?? defaultSocketFactory)('wss://dashscope.aliyuncs.com/api-ws/v1/inference', {
        headers: { Authorization: 'Bearer ' + this.options.apiKey }, followRedirects: false, handshakeTimeout: 15000, maxPayload: 1024 * 1024,
      });
    } catch { return reject('narration_socket_connect_failed'); }
    return new Promise((resolve, rejectPromise) => {
      const start = Date.now(), buffers: Buffer[] = [], rawEvents: NarrationRawEvent[] = [], sentences: NativeNarrationSentence[] = [];
      let bytes = 0, opened = false, started = false, finishSent = false, settled = false;
      let openSentence: number | null = null, beginOriginal: string | undefined, beginNormalized: string | undefined;
      let receiptFinal = false, remoteOutcome: NarrationRemoteOutcome = 'unknown';
      let requestId: string | null = null, maxUsage: number | null = null, lastSentenceUsage: number | null = null;
      const cleanup = (success: boolean) => {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
        try { if (success) socket.close(); else socket.terminate(); } catch { /* 终态已封闭，不传播socket实现细节。 */ }
      };
      const failure = (code: string) => {
        if (settled) return;
        let error: Error;
        try { error = new NarrationProviderError(code, maxUsage === null ? null : { characters: maxUsage, kind: receiptFinal ? 'final' : 'partial', providerTaskId: taskId, providerRequestId: requestId }, remoteOutcome); }
        catch { error = new NarrationProviderError('narration_protocol_invalid'); }
        settled = true;
        try { cleanup(false); } finally { rejectPromise(error); }
      };
      const abort = () => failure('narration_cancelled');
      const timer = setTimeout(() => failure('narration_timeout'), timeoutMs);
      const send = (action: string, payload: object) => {
        if (settled) return;
        socket.send(JSON.stringify({ header: { action, task_id: taskId, streaming: 'duplex' }, payload }));
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      socket.on('open', () => {
        if (settled) return;
        if (opened) { failure('narration_protocol_invalid'); return; }
        opened = true;
        const s = input.settings;
        try { send('run-task', { task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: s.model,
          parameters: { voice: s.voice, text_type: s.textType, format: s.format, sample_rate: s.sampleRate,
            rate: s.rate, pitch: s.pitch, volume: s.volume, word_timestamp_enabled: s.wordTimestampEnabled,
            enable_ssml: s.enableSsml, seed: s.seed }, input: {} }); }
        catch { failure('narration_socket_send_failed'); }
      });
      socket.on('message', (data: unknown, isBinary: boolean) => {
        if (settled) return;
        try {
          if (rawEvents.length >= 100000) return failure('narration_capture_limit');
          if (isBinary) {
            if (!started || !Buffer.isBuffer(data) || !data.length || bytes + data.length > 64 * 1024 * 1024) return failure('narration_audio_invalid');
            rawEvents.push({ kind: 'audio', elapsedMs: Date.now() - start, byteOffset: bytes, byteLength: data.length });
            buffers.push(Buffer.from(data)); bytes += data.length; return;
          }
          if (!Buffer.isBuffer(data) && typeof data !== 'string') return failure('narration_protocol_invalid');
          if (data.length > 1024 * 1024) return failure('narration_capture_limit');
          const event: unknown = JSON.parse(data.toString());
          if (!record(event) || !record(event.header) || event.header.task_id !== taskId || typeof event.header.event !== 'string') return failure('narration_protocol_invalid');
          rawEvents.push({ kind: 'json', elapsedMs: Date.now() - start, data: event });
          const id = event.header.attributes?.request_uuid;
          if (id !== undefined) {
            if (typeof id !== 'string' || !id.trim() || id.trim() !== id || requestId !== null && requestId !== id) return failure('narration_protocol_invalid');
            requestId = id;
          }
          const usage = event.payload?.usage?.characters;
          if (usage !== undefined) {
            if (!Number.isSafeInteger(usage) || usage < 0) return failure('narration_usage_invalid');
            maxUsage = Math.max(maxUsage ?? 0, usage);
          }
          switch (event.header.event) {
            case 'task-started':
              if (!opened || started) return failure('narration_protocol_invalid');
              started = true;
              for (const part of parts) send('continue-task', { input: { text: part } });
              finishSent = true; send('finish-task', { input: {} }); return;
            case 'result-generated': {
              if (!started || !finishSent) return failure('narration_protocol_invalid');
              const output = event.payload?.output, sentence = output?.sentence;
              if (!record(output) || !record(sentence) || !Number.isSafeInteger(sentence.index)) return failure('narration_protocol_invalid');
              if (output.type === 'sentence-begin') {
                if (openSentence !== null || sentence.index !== sentences.length) return failure('narration_protocol_invalid');
                openSentence = sentence.index; beginOriginal = output.original_text; beginNormalized = output.normalized_text;
              } else if (output.type === 'sentence-end') {
                if (openSentence === null || sentence.index !== openSentence || sentence.index !== sentences.length) return failure('narration_protocol_invalid');
                if (beginOriginal !== undefined && beginOriginal !== output.original_text || beginNormalized !== undefined && beginNormalized !== output.normalized_text) return failure('narration_protocol_invalid');
                const parsed = NativeNarrationSentence.safeParse({ providerSentenceIndex: sentence.index,
                  originalText: output.original_text, normalizedText: output.normalized_text, words: sentence.words });
                if (!parsed.success) return failure('narration_timing_invalid');
                sentences.push(parsed.data); openSentence = null; lastSentenceUsage = usage ?? null;
              } else if (output.type !== 'sentence-synthesis' || openSentence !== sentence.index) return failure('narration_protocol_invalid');
              return;
            }
            case 'task-finished': {
              if (started && finishSent) remoteOutcome = 'completed';
              receiptFinal = started && finishSent && (usage !== undefined || lastSentenceUsage === maxUsage);
              if (!started || !finishSent || openSentence !== null || !sentences.length || !bytes || bytes % 2) return failure('narration_incomplete_capture');
              if (sentences.map(s => s.originalText).join('') !== input.sourceText || sentences.some(s => s.words.map(w => w.text).join('') !== s.normalizedText)) return failure('narration_timing_invalid');
              if (usage === undefined && maxUsage !== null && lastSentenceUsage !== maxUsage) return failure('narration_usage_invalid');
              settled = true; cleanup(true);
              resolve({ pcm: Buffer.concat(buffers), sentences, rawEvents, providerTaskId: taskId, providerRequestId: requestId, usageCharacters: maxUsage }); return;
            }
            case 'task-failed': remoteOutcome = 'failed'; return failure('narration_task_failed');
            default: return failure('narration_protocol_invalid');
          }
        } catch { failure('narration_protocol_invalid'); }
      });
      socket.on('error', () => failure('narration_socket_error'));
      socket.on('close', () => failure('narration_socket_closed'));
    });
  }
}
