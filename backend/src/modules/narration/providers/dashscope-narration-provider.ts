import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { normalizeNarrationTiming, NativeNarrationSentence } from '../narration-timing-normalizer.js';
import { NarrationProviderError, parseNarrationSpeechRequest, type NarrationSpeechClient, type NarrationCallOptions, type NarrationUsageReceipt, type NarrationRemoteOutcome } from './dashscope-speech-ws-client.js';
const CaptureMetadata = z.object({
  providerTaskId: z.string().min(1).refine(s => s.trim() === s),
  providerRequestId: z.string().min(1).refine(s => s.trim() === s).nullable(),
  usageCharacters: z.number().int().safe().nonnegative().nullable(),
  sentences: z.array(NativeNarrationSentence).min(1),
  rawEvents: z.array(z.union([
    z.object({ kind: z.literal('json'), elapsedMs: z.number().int().safe().nonnegative(), data: z.unknown() }).strict(),
    z.object({ kind: z.literal('audio'), elapsedMs: z.number().int().safe().nonnegative(),
      byteOffset: z.number().int().safe().nonnegative(), byteLength: z.number().int().safe().positive() }).strict(),
  ])).min(1),
});
/** 回执与本地产物验证分开；只接受同task的安全累计值和明确结束事件。 */
function captureRemoteOutcome(capture: unknown): NarrationRemoteOutcome {
  const c = capture as {providerTaskId?: string;rawEvents?: Array<{kind?: string;data?: {header?: {task_id?: string;event?: string}}}>};
  if (!c || !Array.isArray(c.rawEvents) || !c.providerTaskId) return 'unknown';
  let started = false, finished = false;
  for (const e of c.rawEvents) {
    if (finished) return 'unknown';
    if (e?.kind !== 'json') continue;
    if (e.data?.header?.task_id !== c.providerTaskId) return 'unknown';
    if (e.data.header.event === 'task-started') started = true;
    if (e.data.header.event === 'task-finished') finished = started;
  }
  return finished ? 'completed' : 'unknown';
}
function captureReceipt(capture: unknown): NarrationUsageReceipt | null {
  const parsed = z.object({ providerTaskId: z.string().trim().min(1), providerRequestId: z.string().trim().min(1).nullable(), usageCharacters: z.number().int().safe().nonnegative().nullable(), rawEvents: z.array(z.unknown()) }).safeParse(capture);
  if (!parsed.success || parsed.data.usageCharacters === null) return null;
  const c = parsed.data;
  let finished = false;
  for (const raw of c.rawEvents) {
    const e = raw as { kind?: string; data?: {header?: {task_id?: string;event?: string}} };
    if (e?.kind !== 'json') continue;
    if (e.data?.header?.task_id !== c.providerTaskId) return null;
    if (e.data.header.event === 'task-finished') finished = true;
  }
  return { characters: c.usageCharacters!, kind: finished ? 'final' : 'partial', providerTaskId: c.providerTaskId, providerRequestId: c.providerRequestId };
}
function verifyCaptureEvents(capture: z.infer<typeof CaptureMetadata>, pcmLength: number): void {
  const invalid = (): never => { throw new NarrationProviderError('narration_capture_invalid'); };
  let bytes = 0, started = false, finished = false, nextSentence = 0, openSentence: number | null = null, elapsed = -1;
  for (const event of capture.rawEvents) {
    if (finished || event.elapsedMs < elapsed) invalid(); elapsed = event.elapsedMs;
    if (event.kind === 'audio') {
      if (!started || event.byteOffset !== bytes || bytes + event.byteLength > pcmLength) invalid();
      bytes += event.byteLength; continue;
    }
    const data = event.data as { header?: { event?: string; task_id?: string }; payload?: { output?: {type?: string;sentence?: {index?: number;words?: unknown};original_text?: unknown;normalized_text?: unknown} } } | null;
    if (data?.header?.task_id !== capture.providerTaskId) invalid();
    const type = data?.header?.event, output = data?.payload?.output;
    if (type === 'task-started') { if (started) invalid(); started = true; }
    else if (type === 'result-generated') {
      if (!started) invalid();
      if (output?.type === 'sentence-begin') { if (openSentence !== null || output.sentence?.index !== nextSentence) invalid(); openSentence = nextSentence; }
      else if (output?.type === 'sentence-end') {
        if (openSentence === null || output.sentence?.index !== openSentence) invalid();
        const sentence = capture.sentences[nextSentence];
        const words = NativeNarrationSentence.shape.words.safeParse(output.sentence?.words);
        if (!sentence || sentence.providerSentenceIndex !== nextSentence || output.original_text !== sentence.originalText || output.normalized_text !== sentence.normalizedText || !words.success || JSON.stringify(words.data) !== JSON.stringify(sentence.words)) invalid();
        nextSentence++; openSentence = null;
      } else if (output?.type !== 'sentence-synthesis' || output.sentence?.index !== openSentence) invalid();
    } else if (type === 'task-finished') {
      if (!started || openSentence !== null || nextSentence !== capture.sentences.length || bytes !== pcmLength) invalid(); finished = true;
    } else invalid();
  }
  if (!finished) invalid();
}
function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
/** 独立bundle构建，无run/DB/API副作用。资格仅PlainText/neutral，不加载未验证的Instruct模板。 */
export class DashScopeNarrationProvider {
  constructor(private readonly options: { client: NarrationSpeechClient }) {}
  async generate(value: unknown, options: NarrationCallOptions = {}) {
    const input = parseNarrationSpeechRequest(value);
    if (options.signal?.aborted) throw new NarrationProviderError('narration_cancelled');
    let captured;
    try { captured = await this.options.client.synthesize(structuredClone(input), options); }
    catch (error) {
      if (error instanceof NarrationProviderError) throw error;
      throw new NarrationProviderError('narration_provider_failed');
    }
    const receipt = captureReceipt(captured), remoteOutcome = captureRemoteOutcome(captured);
    let localErrorCode = 'narration_capture_invalid';
    try {
    if (options.signal?.aborted) throw new NarrationProviderError('narration_cancelled');
    const parsed = CaptureMetadata.safeParse(captured);
    if (!parsed.success || !Buffer.isBuffer(captured?.pcm) || !captured.pcm.length || captured.pcm.length % 2 || captured.pcm.length > 64 * 1024 * 1024)
      throw new NarrationProviderError('narration_capture_invalid');
    verifyCaptureEvents(parsed.data, captured.pcm.length);
    const pcm = Buffer.from(captured.pcm), wav = pcmToWav(pcm), sampleCount = pcm.length / 2;
    const durationMs = Math.round(sampleCount * 1000 / 24000);
    const audioHash = createHash('sha256').update(wav).digest('hex');
    localErrorCode = 'narration_timing_invalid';
    const timingMap = normalizeNarrationTiming({ sourceText: input.sourceText, durationMs, audioHash, sentences: parsed.data.sentences });
    return { ...parsed.data, pcm, wav, sampleCount, sampleRate: 24000 as const, channels: 1 as const, bitDepth: 16 as const,
      durationMs, audioHash, timingMap, settings: input.settings };
    } catch (error) {
      // 有限脱敏诊断：原生时间校验失败时输出拼接差异摘要（不打印正文全文），
      // 用于定位长段/特殊文本的供应商句子切分与合同的偏差。
      if (localErrorCode === 'narration_timing_invalid') {
        try {
          const sentences = (captured as { sentences?: Array<{ originalText?: string; normalizedText?: string; words?: unknown[] }> })?.sentences ?? [];
          const joined = sentences.map((x) => x.originalText ?? "").join("");
          let firstDiff = -1;
          for (let i = 0; i < Math.max(joined.length, input.sourceText.length); i += 1) {
            if (joined[i] !== input.sourceText[i]) { firstDiff = i; break; }
          }
          const summary = {
            sourceLen: input.sourceText.length,
            sentenceCount: sentences.length,
            joinedLen: joined.length,
            firstDiff,
            around: firstDiff >= 0 ? {
              src: input.sourceText.slice(Math.max(0, firstDiff - 12), firstDiff + 12),
              joined: joined.slice(Math.max(0, firstDiff - 12), firstDiff + 12),
            } : null,
            sentenceLens: sentences.map((x) => x.originalText?.length ?? 0),
            wordCount: sentences.reduce((n, x) => n + (x.words?.length ?? 0), 0),
            zeroDurationWords: sentences.reduce((n, x) => n + ((x.words ?? []) as Array<{ begin_time?: number; end_time?: number }>).filter((w) => (w.begin_time ?? 0) === (w.end_time ?? 0)).length, 0),
            maxSentWords: sentences.reduce((n, x) => Math.max(n, x.words?.length ?? 0), 0),
            normLenDiff: sentences.map((x) => (x.normalizedText?.length ?? 0) - (x.originalText?.length ?? 0)),
          };
          console.warn("[narration-timing-diagnosis]", JSON.stringify(summary));
          // 诊断落盘：dev 启动脚本的日志不落 storage/backend-dev.log，写独立诊断文件供离线排查。
          try {
            appendFileSync(resolve(process.cwd(), "storage", "narration-timing-diagnosis.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...summary }) + "\n");
          } catch { /* 落盘失败不影响主流程 */ }
        } catch { /* 诊断失败不影响主流程 */ }
      }
      throw new NarrationProviderError(error instanceof NarrationProviderError ? error.code : localErrorCode, receipt, remoteOutcome);
    }
  }
}
