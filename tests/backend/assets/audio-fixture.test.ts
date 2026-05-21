import { describe, expect, it } from "vitest";

import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";
import {
  createSilentWavBuffer,
  createToneWavBuffer,
} from "../../../backend/src/modules/assets/providers/audio-fixture.js";

describe("audio fixture helper", () => {
  it("creates a valid WAV buffer with the requested duration", () => {
    const wav = createSilentWavBuffer({ durationSec: 1.25, sampleRate: 16_000 });

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(readAudioDurationSec({ data: wav })).toBeCloseTo(1.25, 2);
  });

  it("creates a valid audible tone WAV buffer", () => {
    const wav = createToneWavBuffer({
      durationSec: 1,
      sampleRate: 16_000,
      frequencyHz: 440,
      amplitude: 0.25,
    });

    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(readAudioDurationSec({ data: wav })).toBeCloseTo(1, 2);
    expect(maxPcm16(wav)).toBeGreaterThan(0);
  });
});

function maxPcm16(wav: Buffer): number {
  let max = 0;
  for (let offset = 44; offset + 1 < wav.length; offset += 2) {
    max = Math.max(max, Math.abs(wav.readInt16LE(offset)));
  }
  return max;
}
