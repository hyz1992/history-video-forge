/**
 * DashScope image provider payload builder shell tests.
 *
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import { describe, expect, it } from "vitest";
import { buildDashscopeImagePayload } from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-provider.js";

describe("dashscope image payload builder", () => {
  it("wan2.6 payload contains prompt text in messages format", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "古代宫殿中景",
      negativePrompt: "现代建筑",
      size: "1080*1920",
    });

    const json = JSON.stringify(payload);
    expect(json).toContain("古代宫殿中景");
    expect(json).toContain("现代建筑");

    // wan2.6 uses messages array
    expect(payload.input.messages).toBeDefined();
    expect(payload.input.messages![0].content[0].text).toBe("古代宫殿中景");
    expect(payload.parameters.negative_prompt).toBe("现代建筑");
  });

  it("negative prompt is passed only when present", () => {
    const withoutNeg = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test prompt",
    });

    expect(withoutNeg.parameters.negative_prompt).toBe("");

    const withNeg = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test prompt",
      negativePrompt: "low quality",
    });

    expect(withNeg.parameters.negative_prompt).toBe("low quality");
  });

  it("wanx (non-wan2.6) uses legacy prompt format with default negative", () => {
    const payload = buildDashscopeImagePayload({
      model: "wanx-v1",
      prompt: "战国宫门",
    });

    expect(payload.input.prompt).toBe("战国宫门");
    expect(payload.input.messages).toBeUndefined();
    expect((payload as { input: { negative_prompt: string } }).input.negative_prompt).toContain("低质量");
  });

  it("size normalizes x separator to *", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test",
      size: "1920x1080",
    });

    expect(payload.parameters.size).toBe("1920*1080");
  });

  it("sets default size to 1080*1920 when not provided", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test",
    });

    expect(payload.parameters.size).toBe("1080*1920");
  });
});
