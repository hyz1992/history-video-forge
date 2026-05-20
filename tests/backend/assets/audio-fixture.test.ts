import { describe, expect, it } from "vitest";

import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";
import { createSilentWavBuffer } from "../../../backend/src/modules/assets/providers/audio-fixture.js";

describe("audio fixture helper", () => {
  it("creates a valid WAV buffer with the requested duration", () => {
    const wav = createSilentWavBuffer({ durationSec: 1.25, sampleRate: 16_000 });

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(readAudioDurationSec({ data: wav })).toBeCloseTo(1.25, 2);
  });
});
