import { describe, expect, it } from "vitest";
import { taskTypeToProviderType, isProviderTypeEnabled } from "../../../backend/src/modules/assets/provider-type-map.js";

describe("taskTypeToProviderType", () => {
  it("maps image_still to image", () => {
    expect(taskTypeToProviderType("image_still")).toBe("image");
  });
  it("maps video_clip to video", () => {
    expect(taskTypeToProviderType("video_clip")).toBe("video");
  });
  it("maps tts_audio to tts", () => {
    expect(taskTypeToProviderType("tts_audio")).toBe("tts");
  });
  it("maps subtitle_track to tts (字幕随 TTS)", () => {
    expect(taskTypeToProviderType("subtitle_track")).toBe("tts");
  });
  it("maps sfx_cue to sfx", () => {
    expect(taskTypeToProviderType("sfx_cue")).toBe("sfx");
  });
  it("maps bgm_cue to bgm", () => {
    expect(taskTypeToProviderType("bgm_cue")).toBe("bgm");
  });
  it("maps render_motion_cue to null (inline，不受 filter 影响)", () => {
    expect(taskTypeToProviderType("render_motion_cue")).toBeNull();
  });
});

describe("isProviderTypeEnabled", () => {
  it("returns true when enabled_provider_types contains the type", () => {
    expect(isProviderTypeEnabled("image_still", ["tts", "image", "video", "sfx", "bgm"])).toBe(true);
  });
  it("returns false when enabled_provider_types excludes the type", () => {
    expect(isProviderTypeEnabled("image_still", ["tts", "sfx", "bgm"])).toBe(false);
  });
  it("returns true for render_motion_cue regardless (null provider type)", () => {
    expect(isProviderTypeEnabled("render_motion_cue", ["tts"])).toBe(true);
  });
  it("returns true when enabled_provider_types is undefined (all enabled)", () => {
    expect(isProviderTypeEnabled("image_still", undefined)).toBe(true);
  });
});

// ─── T4：character_sheet 的供应商类型映射（设计 §3.7 第 3 项） ────────────────

describe("character_sheet 供应商类型映射", () => {
  it("映射到 image（缺映射会经 fail-open 绕过 provider 启用语义）", () => {
    expect(taskTypeToProviderType("character_sheet")).toBe("image");
    expect(isProviderTypeEnabled("character_sheet", ["image"])).toBe(true);
    expect(isProviderTypeEnabled("character_sheet", ["tts", "sfx"])).toBe(false);
  });
});
