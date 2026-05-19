import { describe, expect, it } from "vitest";

import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";

function makeWavBuffer(input: {
  durationSec: number;
  sampleRate: number;
  channels?: number;
  bytesPerSample?: number;
}): Buffer {
  const channels = input.channels ?? 1;
  const bytesPerSample = input.bytesPerSample ?? 2;
  const bitsPerSample = bytesPerSample * 8;
  const byteRate = input.sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataSize = Math.round(input.durationSec * byteRate);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(input.sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

describe("readAudioDurationSec", () => {
  it("reads WAV duration from RIFF WAVE headers", () => {
    const wavBuffer = makeWavBuffer({
      durationSec: 1.5,
      sampleRate: 24000,
    });

    expect(
      readAudioDurationSec({
        data: wavBuffer,
        format: "wav",
        sampleRate: 24000,
      }),
    ).toBeCloseTo(1.5, 3);
  });

  it("reads PCM duration when sample rate, bytes per sample, and channels are explicit", () => {
    const pcmBuffer = Buffer.alloc(48000 * 2 * 2);

    expect(
      readAudioDurationSec({
        data: pcmBuffer,
        format: "pcm",
        sampleRate: 48000,
        bytesPerSample: 2,
        channels: 2,
      }),
    ).toBeCloseTo(1, 3);
  });

  it("uses 16-bit mono defaults only for explicit PCM input", () => {
    const pcmBuffer = Buffer.alloc(24000 * 2);

    expect(
      readAudioDurationSec({
        data: pcmBuffer,
        format: "pcm",
        sampleRate: 24000,
      }),
    ).toBeCloseTo(1, 3);
    expect(
      readAudioDurationSec({
        data: pcmBuffer,
        sampleRate: 24000,
      }),
    ).toBeNull();
  });

  it("returns null for malformed or unsupported audio data", () => {
    expect(
      readAudioDurationSec({
        data: Buffer.from("not-a-wav"),
        format: "wav",
        sampleRate: 24000,
      }),
    ).toBeNull();
    expect(
      readAudioDurationSec({
        data: Buffer.from("not-an-mp3"),
        format: "mp3",
        sampleRate: 24000,
      }),
    ).toBeNull();
  });
});
