import { describe, expect, it } from "vitest";

import {
  buildSrtFromCaptions,
  buildVttFromCaptions,
  closeCaptionGaps,
  estimateCaptionsFromTtsChunks,
} from "../../../backend/src/modules/assets/assets-subtitle-generator.js";

describe("assets subtitle generator", () => {
  it("短 chunk 不变，仍生成单条 caption", () => {
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

    expect(captions).toHaveLength(2);
    expect(captions[0]).toMatchObject({
      index: 1,
      start_sec: 0,
      end_sec: 2,
      text: "第一句旁白。",
      segment_ids: ["sb_001"],
    });
    expect(captions[1]).toMatchObject({
      index: 2,
      start_sec: 2,
      end_sec: 5,
      text: "第二句旁白。",
      segment_ids: ["sb_002"],
    });
  });

  it("长 chunk 按中文标点拆分为多条 caption", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt:
          "公元前531年，楚王听说晏子要来，想当众羞辱他。楚王知道晏子身材矮小，特意在城门旁边开了个小洞，让晏子从狗门进入。",
        duration_sec: 12,
      },
    ]);

    // 应拆分为多条 caption（至少 3 条）
    expect(captions.length).toBeGreaterThanOrEqual(3);
    // 每条 caption 文本不超过 24 个中文字符（留少许余量给标点）
    for (const c of captions) {
      expect(c.text.length).toBeLessThanOrEqual(30);
    }
    // 首条从 0 开始
    expect(captions[0]!.start_sec).toBe(0);
    // 末条结束时间等于总时长
    const last = captions[captions.length - 1]!;
    expect(last.end_sec).toBeCloseTo(12, 1);
    // 时间连续无间隙
    for (let i = 1; i < captions.length; i++) {
      expect(captions[i]!.start_sec).toBeCloseTo(captions[i - 1]!.end_sec, 2);
    }
  });

  it("caption 数明显大于 TTS chunk 数", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt:
          "晏子站在狗门前说，出使狗国的人才从狗门进。我现在出使的是楚国，不该走这个门。迎宾官员只好打开正门请晏子入城。",
        duration_sec: 10,
      },
    ]);

    // 1 个 3 句话的 chunk 应生成多条 caption
    expect(captions.length).toBeGreaterThanOrEqual(3);
  });

  it("多个长 chunk 混合，caption 时间线连续且 index 正确递增", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt: "楚王连压三次。晏子一次没退。",
        duration_sec: 5,
      },
      {
        tts_chunk_id: "tts_002",
        segment_ids: ["sb_002"],
        script_excerpt: "从羞辱身形，升级到羞辱齐国，再升级到羞辱齐人风气。",
        duration_sec: 6,
      },
    ]);

    expect(captions.length).toBeGreaterThanOrEqual(4);
    // 时间连续
    for (let i = 1; i < captions.length; i++) {
      expect(captions[i]!.start_sec).toBeCloseTo(captions[i - 1]!.end_sec, 2);
    }
    // index 正确递增
    for (let i = 0; i < captions.length; i++) {
      expect(captions[i]!.index).toBe(i + 1);
    }
    // 总时长 = chunk 时长之和
    const last = captions[captions.length - 1]!;
    expect(last.end_sec).toBeCloseTo(11, 1);
  });

  it("SRT/VTT 输出格式正确且 index 匹配", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt: "第一句。第二句。第三句。",
        duration_sec: 6,
      },
    ]);

    expect(captions.length).toBeGreaterThanOrEqual(3);

    const srt = buildSrtFromCaptions(captions);
    const vtt = buildVttFromCaptions(captions);

    // SRT: index 从 1 开始
    expect(srt).toContain("1\n");
    expect(srt).toContain("2\n");
    expect(srt).toContain("3\n");
    expect(srt).toContain(" --> ");

    // VTT
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain(" --> ");

    // 每条 caption 文本在 SRT 中
    for (const c of captions) {
      expect(srt).toContain(c.text);
    }
  });

  it("保留标点符号在 caption 文本中", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt: "楚王问：齐国没有人了吗？晏子答：齐国派人出使，各有规矩。",
        duration_sec: 8,
      },
    ]);

    // 至少应按 ？和 。拆出 3 条
    expect(captions.length).toBeGreaterThanOrEqual(3);

    // 标点应保留
    const allText = captions.map((c) => c.text).join("");
    expect(allText).toContain("？");
    expect(allText).toContain("。");
    expect(allText).toContain("：");
  });

  it("无标点长文本按长度拆分", () => {
    const captions = estimateCaptionsFromTtsChunks([
      {
        tts_chunk_id: "tts_001",
        segment_ids: ["sb_001"],
        script_excerpt:
          "这是一段非常长的没有任何标点符号的口播文本需要被拆分成多个字幕以便观众能够在屏幕上看到适时的字幕更新",
        duration_sec: 10,
      },
    ]);

    // 无标点长文本也应拆分为多条
    expect(captions.length).toBeGreaterThanOrEqual(3);
    // 每条不宜过长
    for (const c of captions) {
      expect(c.text.length).toBeLessThanOrEqual(24);
    }
  });

  it("SRT/VTT 构建保持兼容（小数秒、index）", () => {
    const srt = buildSrtFromCaptions([
      {
        index: 1,
        start_sec: 1.25,
        end_sec: 2.75,
        text: "小数秒字幕",
        segment_ids: ["sb_001"],
      },
    ]);
    expect(srt).toContain("00:00:01,250 --> 00:00:02,750");

    const vtt = buildVttFromCaptions([
      {
        index: 1,
        start_sec: 0.5,
        end_sec: 1.5,
        text: "VTT测试",
        segment_ids: ["sb_001"],
      },
    ]);
    expect(vtt).toContain("WEBVTT");
    expect(vtt).toContain("00:00:00.500 --> 00:00:01.500");
  });
});

describe("closeCaptionGaps", () => {
  const caption = (
    index: number,
    startSec: number,
    endSec: number,
    text: string,
  ) => ({
    index,
    start_sec: startSec,
    end_sec: endSec,
    text,
    segment_ids: [`sb_${index}`],
  });

  it("closes small gaps between consecutive captions", () => {
    const input = [
      caption(1, 0, 1.5, "第一句"),
      caption(2, 2.0, 3.5, "第二句"),
      caption(3, 4.0, 5.5, "第三句"),
    ];

    const result = closeCaptionGaps(input);

    expect(result[0]!.end_sec).toBe(2.0);
    expect(result[1]!.end_sec).toBe(4.0);
    expect(result[2]!.end_sec).toBe(5.5);
  });

  it("does not close gaps exceeding maxGapSec", () => {
    const input = [
      caption(1, 0, 1.0, "第一句"),
      caption(2, 5.0, 6.0, "第二句"),
    ];

    const result = closeCaptionGaps(input, 2);

    expect(result[0]!.end_sec).toBe(1.0);
  });

  it("handles already-continuous captions", () => {
    const input = [
      caption(1, 0, 2.0, "第一句"),
      caption(2, 2.0, 4.0, "第二句"),
    ];

    const result = closeCaptionGaps(input);

    expect(result[0]!.end_sec).toBe(2.0);
    expect(result[1]!.end_sec).toBe(4.0);
  });

  it("handles single caption", () => {
    const input = [caption(1, 0, 3.0, "唯一一句")];
    const result = closeCaptionGaps(input);
    expect(result).toEqual(input);
  });

  it("handles empty array", () => {
    expect(closeCaptionGaps([])).toEqual([]);
  });

  it("does not modify start_sec or text", () => {
    const input = [
      caption(1, 1.0, 2.0, "A"),
      caption(2, 2.5, 4.0, "B"),
    ];

    const result = closeCaptionGaps(input);

    expect(result[0]!.start_sec).toBe(1.0);
    expect(result[0]!.text).toBe("A");
    expect(result[1]!.start_sec).toBe(2.5);
    expect(result[1]!.text).toBe("B");
  });
});
