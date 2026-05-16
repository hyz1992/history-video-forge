/**
 * DashScope TTS provider payload builder shell tests.
 *
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import { describe, expect, it } from "vitest";
import { buildDashscopeTtsPayload } from "../../../backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.js";

describe("dashscope TTS payload builder", () => {
  it("payload includes text and voice_profile_id", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts-test",
      text: "第一句旁白。",
      voiceProfileId: "voice_001",
      format: "wav",
    });

    expect(payload.input.text).toBe("第一句旁白。");
    expect(payload.input.voice).toBe("voice_001");

    const json = JSON.stringify(payload);
    expect(json).toContain("第一句旁白。");
    expect(json).toContain("voice_001");
  });

  it("defaults to wav format and 24000 sample rate", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts",
      text: "test",
      voiceProfileId: "voice_001",
    });

    expect(payload.parameters.format).toBe("wav");
    expect(payload.parameters.sample_rate).toBe(24000);
  });

  it("respects explicit format override", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts",
      text: "test",
      voiceProfileId: "voice_001",
      format: "mp3",
    });

    expect(payload.parameters.format).toBe("mp3");
  });

  it("uses voiceProfileId as voice in input", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts",
      text: "测试文本",
      voiceProfileId: "Cherry",
    });

    expect(payload.input.voice).toBe("Cherry");
  });
});
