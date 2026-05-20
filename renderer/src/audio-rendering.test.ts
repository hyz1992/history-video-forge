import { describe, expect, it } from "vitest";

import {
  getAudioLoopSequences,
  getFadedAudioVolume,
} from "./audio-rendering";

describe("audio rendering helpers", () => {
  it("applies fade in and fade out to base volume", () => {
    expect(
      getFadedAudioVolume({
        baseVolume: 0.5,
        localSec: 0.5,
        durationSec: 10,
        fadeInSec: 1,
        fadeOutSec: 2,
      }),
    ).toBeCloseTo(0.25);

    expect(
      getFadedAudioVolume({
        baseVolume: 0.5,
        localSec: 9,
        durationSec: 10,
        fadeInSec: 1,
        fadeOutSec: 2,
      }),
    ).toBeCloseTo(0.25);
  });

  it("keeps full volume when fade values are absent or non-positive", () => {
    expect(
      getFadedAudioVolume({
        baseVolume: 1.4,
        localSec: 0,
        durationSec: 10,
        fadeInSec: 0,
        fadeOutSec: -1,
      }),
    ).toBe(1);
  });

  it("splits looped audio into repeated source sequences", () => {
    expect(
      getAudioLoopSequences({
        clipDurationSec: 12,
        sourceDurationSec: 5,
      }),
    ).toEqual([
      { offsetSec: 0, durationSec: 5 },
      { offsetSec: 5, durationSec: 5 },
      { offsetSec: 10, durationSec: 2 },
    ]);
  });

  it("uses one sequence when the source is long enough", () => {
    expect(
      getAudioLoopSequences({
        clipDurationSec: 4,
        sourceDurationSec: 10,
      }),
    ).toEqual([{ offsetSec: 0, durationSec: 4 }]);
  });
});
