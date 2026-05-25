import {
  splitChineseText,
  type SubtitleCaption,
} from "./assets-subtitle-generator.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AsrWord {
  text: string;
  begin_time_ms: number;
  end_time_ms: number;
  punctuation: string | null;
}

export interface AsrAlignmentInput {
  asrWords: AsrWord[];
  scriptText: string;
  chunkBoundaries: number[];
  segmentIds: string[][];
}

export interface AsrAlignmentResult {
  captions: SubtitleCaption[];
  aligned: boolean;
  alignment_ratio: number;
}

const ALIGNMENT_THRESHOLD = 0.8;

// ─── Chinese character predicate ────────────────────────────────────────────

function isChineseChar(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

function normalizeToChars(text: string): string[] {
  return [...text].filter(isChineseChar);
}

// ─── LCS alignment ──────────────────────────────────────────────────────────

interface LcsMapping {
  refToAsr: Map<number, number>;
  matchCount: number;
}

function computeLcsMapping(refChars: string[], asrChars: string[]): LcsMapping {
  const m = refChars.length;
  const n = asrChars.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (refChars[i - 1] === asrChars[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to build mapping
  const refToAsr = new Map<number, number>();
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (refChars[i - 1] === asrChars[j - 1]) {
      refToAsr.set(i - 1, j - 1);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return { refToAsr, matchCount: dp[m]![n]! };
}

// ─── Timestamp interpolation ────────────────────────────────────────────────

interface CharTimestamp {
  begin_ms: number;
  end_ms: number;
}

function interpolateTimestamps(
  refCharCount: number,
  asrWords: AsrWord[],
  refToAsr: Map<number, number>,
): CharTimestamp[] {
  const asrTimestamps: CharTimestamp[] = asrWords.map((w) => ({
    begin_ms: w.begin_time_ms,
    end_ms: w.end_time_ms,
  }));

  const result: CharTimestamp[] = new Array(refCharCount);

  // Assign matched timestamps
  for (let ri = 0; ri < refCharCount; ri++) {
    const ai = refToAsr.get(ri);
    if (ai !== undefined) {
      result[ri] = asrTimestamps[ai]!;
    }
  }

  // Interpolate unmatched characters from neighbors
  for (let ri = 0; ri < refCharCount; ri++) {
    if (result[ri] !== undefined) continue;

    // Find nearest matched neighbors
    let prevIdx = ri - 1;
    while (prevIdx >= 0 && result[prevIdx] === undefined) prevIdx--;
    let nextIdx = ri + 1;
    while (nextIdx < refCharCount && result[nextIdx] === undefined) nextIdx++;

    const prevTs =
      prevIdx >= 0 ? result[prevIdx] : asrTimestamps[0];
    const nextTs =
      nextIdx < refCharCount
        ? result[nextIdx]
        : asrTimestamps[asrTimestamps.length - 1];

    if (prevTs && nextTs) {
      const span = nextTs.begin_ms - prevTs.end_ms;
      const gap =
        (nextIdx < refCharCount ? nextIdx : refCharCount) -
        (prevIdx >= 0 ? prevIdx : 0) -
        1;
      const step = gap > 0 ? span / (gap + 1) : 0;
      const offset = prevIdx >= 0 ? ri - prevIdx : 0;
      const base = prevTs.end_ms;
      result[ri] = {
        begin_ms: Math.round(base + step * (offset - 1)),
        end_ms: Math.round(base + step * offset),
      };
    } else if (prevTs) {
      result[ri] = { begin_ms: prevTs.end_ms, end_ms: prevTs.end_ms + 100 };
    } else if (nextTs) {
      result[ri] = {
        begin_ms: nextTs.begin_ms - 100,
        end_ms: nextTs.begin_ms,
      };
    } else {
      result[ri] = { begin_ms: 0, end_ms: 100 };
    }
  }

  return result;
}

// ─── Main alignment function ────────────────────────────────────────────────

export function alignCaptionsFromAsr(
  input: AsrAlignmentInput,
): AsrAlignmentResult {
  const { asrWords, scriptText, chunkBoundaries, segmentIds } = input;

  if (asrWords.length === 0) {
    return { captions: [], aligned: false, alignment_ratio: 0 };
  }

  const refChars = normalizeToChars(scriptText);
  const asrChars = asrWords.map((w) => w.text);

  if (refChars.length === 0) {
    return { captions: [], aligned: false, alignment_ratio: 0 };
  }

  // Build original-text-position → refChar-index mapping
  const allChars = [...scriptText];
  const origToRef = new Map<number, number>();
  let refIdx = 0;
  for (let i = 0; i < allChars.length; i++) {
    if (isChineseChar(allChars[i]!)) {
      origToRef.set(i, refIdx);
      refIdx++;
    }
  }

  // Convert chunkBoundaries from original text positions to refChar positions
  const refChunkBoundaries = chunkBoundaries.map((pos) => {
    // Find the refChar index at or after this original position
    for (let i = pos; i < allChars.length; i++) {
      if (origToRef.has(i)) return origToRef.get(i)!;
    }
    return refChars.length;
  });

  const { refToAsr, matchCount } = computeLcsMapping(refChars, asrChars);
  const alignmentRatio = matchCount / refChars.length;

  // For very short texts, a single character mismatch can drop ratio below threshold.
  // Allow up to 2 mismatches regardless of ratio.
  const maxMismatches = 2;
  const mismatches = refChars.length - matchCount;
  const passesThreshold =
    alignmentRatio >= ALIGNMENT_THRESHOLD || mismatches <= maxMismatches;

  if (!passesThreshold) {
    return {
      captions: [],
      aligned: false,
      alignment_ratio: alignmentRatio,
    };
  }

  // Interpolate per-character timestamps
  const charTimestamps = interpolateTimestamps(
    refChars.length,
    asrWords,
    refToAsr,
  );

  // Split original text by punctuation → captions
  const segments = splitChineseText(scriptText);

  // Map each segment to refChar range using origToRef
  const captions: SubtitleCaption[] = [];
  let origCursor = 0;
  let captionIndex = 1;

  for (const seg of segments) {
    if (!seg.trim()) continue;

    // Find where this segment starts in the original text from origCursor
    const segStart = scriptText.indexOf(seg, origCursor);
    if (segStart < 0) continue;

    // Get refChar range for this segment
    let refStart = -1;
    let refEnd = -1;
    for (let i = segStart; i < segStart + seg.length; i++) {
      const ri = origToRef.get(i);
      if (ri !== undefined) {
        if (refStart < 0) refStart = ri;
        refEnd = ri + 1; // exclusive end
      }
    }

    origCursor = segStart + seg.length;

    if (refStart < 0 || refEnd <= refStart || refStart >= charTimestamps.length)
      continue;

    const startMs = charTimestamps[refStart]!.begin_ms;
    const endMs = charTimestamps[refEnd - 1]!.end_ms;

    const segSegmentIds = findSegmentIds(
      refStart,
      refEnd,
      refChars.length,
      refChunkBoundaries,
      segmentIds,
    );

    captions.push({
      index: captionIndex++,
      start_sec: startMs / 1000,
      end_sec: endMs / 1000,
      text: seg,
      segment_ids: segSegmentIds,
    });
  }

  return {
    captions,
    aligned: true,
    alignment_ratio: alignmentRatio,
  };
}

function findSegmentIds(
  refStart: number,
  refEnd: number,
  totalRefChars: number,
  chunkBoundaries: number[],
  segmentIds: string[][],
): string[] {
  if (chunkBoundaries.length === 0 || segmentIds.length === 0) return [];

  // Find which chunk(s) this span falls into
  const ids = new Set<string>();
  for (let ci = 0; ci < chunkBoundaries.length; ci++) {
    const chunkStart = chunkBoundaries[ci]!;
    const chunkEnd =
      ci + 1 < chunkBoundaries.length
        ? chunkBoundaries[ci + 1]!
        : totalRefChars;
    // Overlap check
    if (refStart < chunkEnd && refEnd > chunkStart) {
      for (const id of segmentIds[ci] ?? []) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}
