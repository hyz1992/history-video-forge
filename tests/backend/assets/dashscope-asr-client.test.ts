import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildAsrPayload,
  parseAsrWords,
  DEFAULT_ASR_MODEL,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-asr-client.js";
import type { AsrWord } from "../../../backend/src/modules/assets/asr-caption-aligner.js";

describe("buildAsrPayload", () => {
  it("constructs correct ASR request with enable_words", () => {
    const payload = buildAsrPayload("oss://dashscope/audio.wav");

    expect(payload.model).toBe(DEFAULT_ASR_MODEL);
    expect(payload.input).toEqual({ file_url: "oss://dashscope/audio.wav" });
    expect(payload.parameters).toEqual({ enable_words: true });
  });

  it("uses custom model when provided", () => {
    const payload = buildAsrPayload("oss://dashscope/audio.wav", "custom-asr-model");

    expect(payload.model).toBe("custom-asr-model");
  });
});

describe("parseAsrWords", () => {
  it("extracts words from DashScope ASR transcription JSON", () => {
    const transcription = {
      transcripts: [
        {
          sentences: [
            {
              text: "春眠不觉晓",
              begin_time: 0,
              end_time: 1200,
              words: [
                { text: "春", begin_time: 0, end_time: 300 },
                { text: "眠", begin_time: 300, end_time: 600 },
                { text: "不", begin_time: 600, end_time: 800 },
                { text: "觉", begin_time: 800, end_time: 1000 },
                { text: "晓", begin_time: 1000, end_time: 1200, punctuation: "。" },
              ],
            },
          ],
        },
      ],
    };

    const words = parseAsrWords(transcription);

    expect(words).toHaveLength(5);
    expect(words[0]).toEqual({
      text: "春",
      begin_time_ms: 0,
      end_time_ms: 300,
      punctuation: null,
    });
    expect(words[4]).toEqual({
      text: "晓",
      begin_time_ms: 1000,
      end_time_ms: 1200,
      punctuation: "。",
    });
  });

  it("handles multiple transcripts and sentences", () => {
    const transcription = {
      transcripts: [
        {
          sentences: [
            {
              words: [
                { text: "白", begin_time: 0, end_time: 200 },
                { text: "日", begin_time: 200, end_time: 400 },
              ],
            },
            {
              words: [
                { text: "依", begin_time: 400, end_time: 600, punctuation: "，" },
              ],
            },
          ],
        },
      ],
    };

    const words = parseAsrWords(transcription);

    expect(words).toHaveLength(3);
    expect(words[2]!.punctuation).toBe("，");
  });

  it("returns empty array for empty transcripts", () => {
    expect(parseAsrWords({ transcripts: [] })).toEqual([]);
    expect(parseAsrWords({ transcripts: [{ sentences: [] }] })).toEqual([]);
    expect(parseAsrWords({})).toEqual([]);
  });

  it("handles words without punctuation field", () => {
    const transcription = {
      transcripts: [
        {
          sentences: [
            {
              words: [
                { text: "测", begin_time: 0, end_time: 100 },
              ],
            },
          ],
        },
      ],
    };

    const words = parseAsrWords(transcription);

    expect(words).toHaveLength(1);
    expect(words[0]!.punctuation).toBeNull();
  });
});
