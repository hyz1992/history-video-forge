import type {
  AssetPlan,
  TtsChunkRoute,
} from "../../../../shared/src/index.js";

type TtsPlan = AssetPlan["tts_plan"];
type TtsPlanChunk = TtsPlan["chunks"][number];

export const DEFAULT_MAX_CHARS_PER_CHUNK = 180;
export const DEFAULT_TARGET_CHARS_PER_CHUNK = 120;
export const MIN_TTS_CHUNK_DURATION_SEC = 0.5;

export function normalizeTtsPlanForExecution(input: {
  ttsPlan: TtsPlan;
  maxCharsPerChunk?: number;
  targetCharsPerChunk?: number;
  minDurationSec?: number;
}): TtsPlan {
  const maxCharsPerChunk = Math.max(
    1,
    Math.floor(input.maxCharsPerChunk ?? DEFAULT_MAX_CHARS_PER_CHUNK),
  );
  const minDurationSec =
    input.minDurationSec ?? MIN_TTS_CHUNK_DURATION_SEC;

  const normalizedChunks = input.ttsPlan.chunks.flatMap((chunk) =>
    normalizeChunk(chunk, maxCharsPerChunk, minDurationSec),
  );
  const orderedChunks = normalizedChunks.map((chunk, order) => ({
    ...chunk,
    order,
  }));

  return {
    ...input.ttsPlan,
    estimated_total_duration_sec: sumDurations(orderedChunks),
    chunks: orderedChunks,
  };
}

export function normalizeAssetPlanTtsForExecution(input: {
  assetPlan: AssetPlan;
  segmentIds: string[];
  maxCharsPerChunk?: number;
  targetCharsPerChunk?: number;
  minDurationSec?: number;
}): {
  assetPlan: AssetPlan;
  ttsChunkRoutes: TtsChunkRoute[];
} {
  const maxCharsPerChunk = Math.max(
    1,
    Math.floor(input.maxCharsPerChunk ?? DEFAULT_MAX_CHARS_PER_CHUNK),
  );
  const minDurationSec =
    input.minDurationSec ?? MIN_TTS_CHUNK_DURATION_SEC;

  const chunksWithRoutes: Array<{
    chunk: TtsPlanChunk;
    segmentIds: string[];
  }> = [];

  for (let i = 0; i < input.assetPlan.tts_plan.chunks.length; i++) {
    const chunk = input.assetPlan.tts_plan.chunks[i]!;
    const parentSegmentIds =
      i < input.segmentIds.length ? [input.segmentIds[i]!] : [];
    const normalizedChunks = normalizeChunk(
      chunk,
      maxCharsPerChunk,
      minDurationSec,
    );

    for (const normalizedChunk of normalizedChunks) {
      chunksWithRoutes.push({
        chunk: normalizedChunk,
        segmentIds: parentSegmentIds,
      });
    }
  }

  const orderedChunks = chunksWithRoutes.map((item, order) => ({
    ...item.chunk,
    order,
  }));
  const ttsChunkRoutes = orderedChunks.map((chunk, index) => ({
    tts_chunk_id: chunk.chunk_id,
    artifact_id: null,
    segment_ids: chunksWithRoutes[index]!.segmentIds,
    script_excerpt: chunk.script_excerpt,
  }));

  const normalizedTtsPlan: TtsPlan = {
    ...input.assetPlan.tts_plan,
    estimated_total_duration_sec: sumDurations(orderedChunks),
    chunks: orderedChunks,
  };

  return {
    assetPlan: {
      ...input.assetPlan,
      tts_plan: normalizedTtsPlan,
    },
    ttsChunkRoutes,
  };
}

function normalizeChunk(
  chunk: TtsPlanChunk,
  maxCharsPerChunk: number,
  minDurationSec: number,
): TtsPlanChunk[] {
  const pieces = splitChunkText(chunk.script_excerpt, maxCharsPerChunk);

  if (pieces.length <= 1) {
    return [{ ...chunk }];
  }

  const durations = distributeDuration({
    totalDurationSec: chunk.estimated_duration_sec,
    texts: pieces,
    minDurationSec,
  });

  return pieces.map((scriptExcerpt, index) => ({
    ...chunk,
    chunk_id: `${chunk.chunk_id}_part_${index + 1}`,
    order: chunk.order + index,
    script_excerpt: scriptExcerpt,
    estimated_duration_sec: durations[index]!,
  }));
}

function splitChunkText(text: string, maxCharsPerChunk: number): string[] {
  const sentences = splitSentences(text);
  const pieces: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxCharsPerChunk) {
      if (current) {
        pieces.push(current);
        current = "";
      }
      pieces.push(...splitByCharacterWindow(sentence, maxCharsPerChunk));
      continue;
    }

    if (!current) {
      current = sentence;
      continue;
    }

    if (current.length + sentence.length <= maxCharsPerChunk) {
      current += sentence;
    } else {
      pieces.push(current);
      current = sentence;
    }
  }

  if (current) {
    pieces.push(current);
  }

  return pieces.length > 0 ? pieces : [text.trim()].filter(Boolean);
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const parts = trimmed.split(/([。！？!?；;])/u);
  const sentences: string[] = [];

  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const punctuation = parts[i + 1] ?? "";
    const sentence = `${body}${punctuation}`.trim();
    if (sentence) {
      sentences.push(sentence);
    }
  }

  return sentences;
}

function splitByCharacterWindow(
  text: string,
  maxCharsPerChunk: number,
): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += maxCharsPerChunk) {
    const piece = text.slice(i, i + maxCharsPerChunk).trim();
    if (piece) {
      pieces.push(piece);
    }
  }
  return pieces;
}

function distributeDuration(input: {
  totalDurationSec: number;
  texts: string[];
  minDurationSec: number;
}): number[] {
  const { totalDurationSec, texts, minDurationSec } = input;
  const totalTextLength = texts.reduce((sum, text) => sum + text.length, 0);

  if (texts.length === 1 || totalTextLength <= 0) {
    return [totalDurationSec];
  }

  const canApplyMinimum = totalDurationSec >= minDurationSec * texts.length;
  const baseDuration = canApplyMinimum ? minDurationSec : 0;
  const remainingDuration =
    totalDurationSec - baseDuration * texts.length;

  const durations = texts.map(
    (text) =>
      baseDuration + remainingDuration * (text.length / totalTextLength),
  );
  const drift = totalDurationSec - sumNumbers(durations);
  durations[durations.length - 1] =
    durations[durations.length - 1]! + drift;

  return durations;
}

function sumDurations(chunks: TtsPlanChunk[]): number {
  return sumNumbers(chunks.map((chunk) => chunk.estimated_duration_sec));
}

function sumNumbers(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
