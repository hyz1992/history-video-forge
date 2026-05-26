// ─── Types ────────────────────────────────────────────────────────────────────

export interface TtsSubtitleChunk {
  tts_chunk_id: string;
  segment_ids: string[];
  script_excerpt: string;
  duration_sec: number;
}

export interface SubtitleCaption {
  index: number;
  start_sec: number;
  end_sec: number;
  text: string;
  segment_ids: string[];
}

// ─── Chinese Text Splitting ───────────────────────────────────────────────────

const PRIMARY_PUNCTUATION = "。！？；";
const SECONDARY_PUNCTUATION = "，、：";
const MAX_CAPTION_CHARS = 24;

export function splitChineseText(text: string): string[] {
  const segments = splitByPunctuation(text, PRIMARY_PUNCTUATION);
  const result: string[] = [];

  for (const seg of segments) {
    if (!seg.trim()) continue;

    const hasSecondary = [...SECONDARY_PUNCTUATION].some((p) =>
      seg.includes(p),
    );

    if (hasSecondary) {
      // Always attempt secondary split when punctuation exists
      const subSegs = splitByPunctuation(seg, SECONDARY_PUNCTUATION);
      for (const sub of subSegs) {
        if (!sub.trim()) continue;
        pushSegmentOrSplit(sub, result);
      }
    } else {
      pushSegmentOrSplit(seg, result);
    }
  }

  return result;
}

function pushSegmentOrSplit(seg: string, result: string[]): void {
  if (seg.length <= MAX_CAPTION_CHARS) {
    result.push(seg);
  } else {
    const numSplits = Math.ceil(seg.length / MAX_CAPTION_CHARS);
    const splitSize = Math.ceil(seg.length / numSplits);
    for (let i = 0; i < seg.length; i += splitSize) {
      const chunk = seg.substring(i, i + splitSize);
      if (chunk.trim()) result.push(chunk);
    }
  }
}

function splitByPunctuation(text: string, punctuations: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const char of text) {
    current += char;
    if (punctuations.includes(char)) {
      parts.push(current);
      current = "";
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

// ─── Caption Estimation ──────────────────────────────────────────────────────

export function estimateCaptionsFromTtsChunks(
  chunks: TtsSubtitleChunk[],
): SubtitleCaption[] {
  const captions: SubtitleCaption[] = [];
  let cursor = 0;
  let index = 1;

  for (const chunk of chunks) {
    const subTexts = splitChineseText(chunk.script_excerpt);
    if (subTexts.length === 0) continue;

    const totalChars = subTexts.reduce((sum, t) => sum + t.length, 0);
    const chunkEnd = cursor + chunk.duration_sec;

    for (let i = 0; i < subTexts.length; i++) {
      const subText = subTexts[i]!.trim();
      if (!subText) continue;

      const isLast = i === subTexts.length - 1;
      let duration: number;

      if (isLast) {
        // Snap to chunk end for exact continuity
        duration = chunkEnd - cursor;
      } else {
        const charRatio =
          totalChars > 0 ? subText.length / totalChars : 1 / subTexts.length;
        duration = Math.max(0.8, chunk.duration_sec * charRatio);
      }

      const startSec = cursor;
      const endSec = cursor + duration;

      captions.push({
        index: index++,
        start_sec: startSec,
        end_sec: endSec,
        text: subText,
        segment_ids: chunk.segment_ids,
      });

      cursor = endSec;
    }
  }

  return captions;
}

// ─── Caption Gap Closing ─────────────────────────────────────────────────────

const MAX_CAPTION_GAP_SEC = 2;

export function closeCaptionGaps(
  captions: SubtitleCaption[],
  maxGapSec: number = MAX_CAPTION_GAP_SEC,
): SubtitleCaption[] {
  if (captions.length <= 1) return captions;

  const result = captions.map((c) => ({ ...c }));

  for (let i = 0; i < result.length - 1; i++) {
    const currentEnd = result[i]!.end_sec;
    const nextStart = result[i + 1]!.start_sec;
    const gap = nextStart - currentEnd;

    if (gap > 0 && gap <= maxGapSec) {
      result[i]!.end_sec = nextStart;
    }
  }

  return result;
}

// ─── Time Formatting Helpers ─────────────────────────────────────────────────

function formatTimestamp(totalSec: number, msSeparator: "," | "."): string {
  const totalMs = Math.round(totalSec * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const sec = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const min = totalMinutes % 60;
  const hr = Math.floor(totalMinutes / 60);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");

  return `${pad2(hr)}:${pad2(min)}:${pad2(sec)}${msSeparator}${pad3(ms)}`;
}

// ─── SRT Builder ─────────────────────────────────────────────────────────────

export function buildSrtFromCaptions(captions: SubtitleCaption[]): string {
  return (
    captions
      .map((c) => {
        const start = formatTimestamp(c.start_sec, ",");
        const end = formatTimestamp(c.end_sec, ",");
        return `${c.index}\n${start} --> ${end}\n${c.text}`;
      })
      .join("\n\n") + "\n"
  );
}

// ─── VTT Builder ─────────────────────────────────────────────────────────────

export function buildVttFromCaptions(captions: SubtitleCaption[]): string {
  const header = "WEBVTT\n\n";
  const body =
    captions
      .map((c) => {
        const start = formatTimestamp(c.start_sec, ".");
        const end = formatTimestamp(c.end_sec, ".");
        return `${c.index}\n${start} --> ${end}\n${c.text}`;
      })
      .join("\n\n") + "\n";
  return header + body;
}
