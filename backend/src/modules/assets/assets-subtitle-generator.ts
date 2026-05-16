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

// ─── Caption Estimation ──────────────────────────────────────────────────────

export function estimateCaptionsFromTtsChunks(
  chunks: TtsSubtitleChunk[],
): SubtitleCaption[] {
  let cursor = 0;
  return chunks.map((chunk, index) => {
    const caption: SubtitleCaption = {
      index: index + 1,
      start_sec: cursor,
      end_sec: cursor + chunk.duration_sec,
      text: chunk.script_excerpt,
      segment_ids: chunk.segment_ids,
    };
    cursor = caption.end_sec;
    return caption;
  });
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
  return captions
    .map((c) => {
      const start = formatTimestamp(c.start_sec, ",");
      const end = formatTimestamp(c.end_sec, ",");
      return `${c.index}\n${start} --> ${end}\n${c.text}`;
    })
    .join("\n\n") + "\n";
}

// ─── VTT Builder ─────────────────────────────────────────────────────────────

export function buildVttFromCaptions(captions: SubtitleCaption[]): string {
  const header = "WEBVTT\n\n";
  const body = captions
    .map((c) => {
      const start = formatTimestamp(c.start_sec, ".");
      const end = formatTimestamp(c.end_sec, ".");
      return `${c.index}\n${start} --> ${end}\n${c.text}`;
    })
    .join("\n\n") + "\n";
  return header + body;
}
