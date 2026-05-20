import { describe, expect, it } from "vitest";

import {
  getAudioSequenceFrames,
  normalizeAudioVolume,
} from "../../renderer/src/audio-rendering";

describe("audio rendering helpers", () => {
  it("converts audio timing into Remotion frame offsets", () => {
    expect(
      getAudioSequenceFrames({
        startSec: 1.5,
        durationSec: 2,
        fps: 30,
      }),
    ).toEqual({
      from: 45,
      durationInFrames: 60,
    });
  });

  it("clamps audio volume", () => {
    expect(normalizeAudioVolume(-1)).toBe(0);
    expect(normalizeAudioVolume(0.35)).toBe(0.35);
    expect(normalizeAudioVolume(2)).toBe(1);
  });
});
