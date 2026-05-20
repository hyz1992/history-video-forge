import { describe, expect, it } from "vitest";

import { DEFAULT_SUBTITLE_STYLE } from "../../shared/src/index.js";
import {
  DEFAULT_SUBTITLE_STYLE_PROP,
  getActiveSubtitleCue,
  makeSubtitleContainerStyle,
} from "../../renderer/src/subtitle-rendering";

describe("subtitle rendering helpers", () => {
  it("selects the active cue by frame time", () => {
    expect(
      getActiveSubtitleCue({
        cues: [
          { start_sec: 0, end_sec: 1, text: "first" },
          { start_sec: 1, end_sec: 2, text: "second" },
        ],
        frame: 45,
        fps: 30,
      })?.text,
    ).toBe("second");
  });

  it("constrains bottom subtitle style inside safe areas", () => {
    const style = makeSubtitleContainerStyle({
      frameWidth: 1080,
      frameHeight: 1920,
      style: DEFAULT_SUBTITLE_STYLE_PROP,
    });

    expect(style.position).toBe("absolute");
    expect(style.bottom).toBeGreaterThanOrEqual(96);
    expect(style.maxWidth).toBe("90%");
    expect(style.WebkitLineClamp).toBe(2);
    expect(style.overflow).toBe("hidden");
  });

  it("keeps the renderer default style aligned with shared default style", () => {
    expect(DEFAULT_SUBTITLE_STYLE_PROP).toEqual(DEFAULT_SUBTITLE_STYLE);
  });
});
