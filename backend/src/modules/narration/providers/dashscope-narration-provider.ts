import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeNarrationTiming, NativeNarrationSentence } from '../narration-timing-normalizer.js';
import { NarrationProviderError, parseNarrationSpeechRequest, type NarrationSpeechClient, type NarrationCallOptions } from './dashscope-speech-ws-client.js';
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
    if (options.signal?.aborted) throw new NarrationProviderError('narration_cancelled');
    const parsed = CaptureMetadata.safeParse(captured);
    if (!parsed.success || !Buffer.isBuffer(captured?.pcm) || !captured.pcm.length || captured.pcm.length % 2 || captured.pcm.length > 64 * 1024 * 1024)
      throw new NarrationProviderError('narration_capture_invalid');
    verifyCaptureEvents(parsed.data, captured.pcm.length);
    const pcm = Buffer.from(captured.pcm), wav = pcmToWav(pcm), sampleCount = pcm.length / 2;
    const durationMs = Math.round(sampleCount * 1000 / 24000);
    const audioHash = createHash('sha256').update(wav).digest('hex');
    const timingMap = normalizeNarrationTiming({ sourceText: input.sourceText, durationMs, audioHash, sentences: parsed.data.sentences });
    return { ...parsed.data, pcm, wav, sampleCount, sampleRate: 24000 as const, channels: 1 as const, bitDepth: 16 as const,
      durationMs, audioHash, timingMap, settings: input.settings };
  }
}
