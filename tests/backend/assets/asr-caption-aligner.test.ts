import { describe, expect, it } from "vitest";

import { alignCaptionsFromAsr, type AsrWord } from "../../../backend/src/modules/assets/asr-caption-aligner.js";
import type { SubtitleCaption } from "../../../backend/src/modules/assets/assets-subtitle-generator.js";

function makeAsrWord(
  text: string,
  beginMs: number,
  endMs: number,
  punctuation: string | null = null,
): AsrWord {
  return { text, begin_time_ms: beginMs, end_time_ms: endMs, punctuation };
}

describe("alignCaptionsFromAsr", () => {
  it("maps exact-match ASR words to captions split by punctuation", () => {
    const asrWords: AsrWord[] = [
      makeAsrWord("春", 0, 200),
      makeAsrWord("眠", 200, 400),
      makeAsrWord("不", 400, 600),
      makeAsrWord("觉", 600, 800),
      makeAsrWord("晓", 800, 1000, "，"),
      makeAsrWord("处", 1000, 1200),
      makeAsrWord("处", 1200, 1400),
      makeAsrWord("闻", 1400, 1600),
      makeAsrWord("啼", 1600, 1800),
      makeAsrWord("鸟", 1800, 2000, "。"),
    ];

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: "春眠不觉晓，处处闻啼鸟。",
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(true);
    expect(result.alignment_ratio).toBe(1);

    // splitChineseText splits at "，" and "。" → 2 captions
    const captions = result.captions;
    expect(captions).toHaveLength(2);
    expect(captions[0]).toMatchObject({
      text: "春眠不觉晓，",
      start_sec: 0,
      end_sec: 1,
      segment_ids: ["sb_001"],
    });
    expect(captions[1]).toMatchObject({
      text: "处处闻啼鸟。",
      start_sec: 1,
      end_sec: 2,
      segment_ids: ["sb_001"],
    });
  });

  it("handles homophone substitution via LCS alignment", () => {
    // ASR misrecognizes 琴 as 秦
    const asrWords: AsrWord[] = [
      makeAsrWord("抚", 0, 300),
      makeAsrWord("秦", 300, 600), // should be 琴
      makeAsrWord("一", 600, 800),
      makeAsrWord("曲", 800, 1000, "。"),
    ];

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: "抚琴一曲。",
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(true);
    expect(result.captions).toHaveLength(1);
    // Text should come from original script, timestamps from ASR
    expect(result.captions[0]!.text).toBe("抚琴一曲。");
    expect(result.captions[0]!.start_sec).toBe(0);
    expect(result.captions[0]!.end_sec).toBe(1);
  });

  it("interpolates timestamps for missing ASR characters", () => {
    // ASR drops character "不"
    const asrWords: AsrWord[] = [
      makeAsrWord("春", 0, 200),
      makeAsrWord("眠", 200, 400),
      // "不" missing
      makeAsrWord("觉", 400, 600),
      makeAsrWord("晓", 600, 800, "。"),
    ];

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: "春眠不觉晓。",
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(true);
    expect(result.captions).toHaveLength(1);
    expect(result.captions[0]!.text).toBe("春眠不觉晓。");
    expect(result.captions[0]!.start_sec).toBe(0);
    expect(result.captions[0]!.end_sec).toBeCloseTo(0.8, 1);
  });

  it("splits multi-sentence text into separate captions", () => {
    const asrWords: AsrWord[] = [
      makeAsrWord("白", 0, 200),
      makeAsrWord("日", 200, 400),
      makeAsrWord("依", 400, 600),
      makeAsrWord("山", 600, 800),
      makeAsrWord("尽", 800, 1000, "，"),
      makeAsrWord("黄", 1000, 1200),
      makeAsrWord("河", 1200, 1400),
      makeAsrWord("入", 1400, 1600),
      makeAsrWord("海", 1600, 1800),
      makeAsrWord("流", 1800, 2000, "。"),
    ];

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: "白日依山尽，黄河入海流。",
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(true);
    expect(result.captions).toHaveLength(2);
    // Captions should be contiguous, no overlap/gap
    expect(result.captions[0]!.end_sec).toBeCloseTo(
      result.captions[1]!.start_sec,
      2,
    );
  });

  it("returns aligned=false when match ratio is below threshold", () => {
    // Only 1 out of 5 characters match
    const asrWords: AsrWord[] = [
      makeAsrWord("甲", 0, 200),
      makeAsrWord("乙", 200, 400),
      makeAsrWord("丙", 400, 600),
      makeAsrWord("丁", 600, 800),
      makeAsrWord("戊", 800, 1000, "。"),
    ];

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: "春眠不觉晓。",
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(false);
    expect(result.alignment_ratio).toBeLessThan(0.8);
  });

  it("returns aligned=false for empty ASR result", () => {
    const result = alignCaptionsFromAsr({
      asrWords: [],
      scriptText: "春眠不觉晓。",
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(false);
    expect(result.captions).toEqual([]);
  });

  it("assigns correct segment_ids for multi-chunk input", () => {
    const asrWords: AsrWord[] = [
      makeAsrWord("段", 0, 200),
      makeAsrWord("落", 200, 400),
      makeAsrWord("一", 400, 600, "。"),
      makeAsrWord("段", 600, 800),
      makeAsrWord("落", 800, 1000),
      makeAsrWord("二", 1000, 1200, "。"),
    ];

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: "段落一。段落二。",
      chunkBoundaries: [0, 4], // chunk 1: 段落一。 (4 chars), chunk 2 starts at index 4
      segmentIds: [["sb_001"], ["sb_002"]],
    });

    expect(result.aligned).toBe(true);
    expect(result.captions).toHaveLength(2);
    expect(result.captions[0]!.segment_ids).toEqual(["sb_001"]);
    expect(result.captions[1]!.segment_ids).toEqual(["sb_002"]);
  });

  it("handles long text exceeding MAX_CAPTION_CHARS by splitting", () => {
    // 30 characters with no punctuation → should be split into segments ≤ 24 chars
    const longText = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十";
    const asrWords: AsrWord[] = longText.split("").map((char, i) =>
      makeAsrWord(char, i * 100, (i + 1) * 100),
    );

    const result = alignCaptionsFromAsr({
      asrWords,
      scriptText: longText,
      chunkBoundaries: [0],
      segmentIds: [["sb_001"]],
    });

    expect(result.aligned).toBe(true);
    // splitChineseText splits at 24 chars → 30 chars = [24, 6]
    expect(result.captions).toHaveLength(2);
    expect(result.captions[0]!.text.length).toBeLessThanOrEqual(24);
    // All captions combined should cover the full duration
    const totalText = result.captions.map((c) => c.text).join("");
    expect(totalText).toBe(longText);
  });
});
