export function createSilentWavBuffer(input: {
  durationSec: number;
  sampleRate?: number;
}): Buffer {
  return createPcm16WavBuffer({
    durationSec: input.durationSec,
    sampleRate: input.sampleRate,
    sampleAt: () => 0,
  });
}

export function createToneWavBuffer(input: {
  durationSec: number;
  sampleRate?: number;
  frequencyHz?: number;
  amplitude?: number;
}): Buffer {
  const sampleRate = input.sampleRate ?? 16_000;
  const frequencyHz = input.frequencyHz ?? 440;
  const amplitude = Math.min(1, Math.max(0, input.amplitude ?? 0.2));
  return createPcm16WavBuffer({
    durationSec: input.durationSec,
    sampleRate,
    sampleAt: (sampleIndex) =>
      Math.sin((2 * Math.PI * frequencyHz * sampleIndex) / sampleRate) *
      amplitude,
  });
}

function createPcm16WavBuffer(input: {
  durationSec: number;
  sampleRate?: number;
  sampleAt: (sampleIndex: number) => number;
}): Buffer {
  const sampleRate = input.sampleRate ?? 16_000;
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.max(1, Math.round(input.durationSec * sampleRate));
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sample = Math.min(1, Math.max(-1, input.sampleAt(sampleIndex)));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + sampleIndex * 2);
  }

  return buffer;
}
