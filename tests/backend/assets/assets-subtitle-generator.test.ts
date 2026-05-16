import { describe, expect, it } from "vitest";

import {
  buildSrtFromCaptions,
  buildVttFromCaptions,
  estimateCaptionsFromTtsChunks,
} from "../../../backend/src/modules/assets/assets-subtitle-generator.js";

describe("assets subtitle generator", () => {
  it("estimates captions from TTS chunks and renders SRT/VTT", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt: "第一句旁白。",
        duration_sec: 2,
      },
      {
        tts_chunk_id: "tts_002",
        segment_ids: ["sb_002"],
        script_excerpt: "第二句旁白。",
        duration_sec: 3,
      },
    ]);

    expect(captions).toEqual([
      {
        index: 1,
        start_sec: 0,
        end_sec: 2,
        text: "第一句旁白。",
        segment_ids: ["sb_001"],
      },
      {
        index: 2,
        start_sec: 2,
        end_sec: 5,
        text: "第二句旁白。",
        segment_ids: ["sb_002"],
      },
    ]);

    expect(buildSrtFromCaptions(captions)).toContain(
      "00:00:00,000 --> 00:00:02,000",
    );
    expect(buildSrtFromCaptions(captions)).toContain(
      "00:00:02,000 --> 00:00:05,000",
    );
    expect(buildVttFromCaptions(captions)).toContain("WEBVTT");
    expect(buildVttFromCaptions(captions)).toContain(
      "00:00:02.000 --> 00:00:05.000",
    );
    expect(buildSrtFromCaptions([
      {
        index: 1,
        start_sec: 1.25,
        end_sec: 2.75,
        text: "小数秒字幕",
        segment_ids: ["sb_001"],
      },
    ])).toContain("00:00:01,250 --> 00:00:02,750");
  });
});
