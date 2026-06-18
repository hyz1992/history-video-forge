export function readAudioDurationSec(input: {
  data: Buffer;
  format?: string;
  sampleRate?: number;
  bytesPerSample?: number;
  channels?: number;
}): number | null {
  const format = input.format?.toLowerCase();

  if (format === "wav" || isRiffWave(input.data)) {
    return readWavDurationSec(input.data);
  }

  if (format === "pcm") {
    return readPcmDurationSec({
      data: input.data,
      sampleRate: input.sampleRate,
      bytesPerSample: input.bytesPerSample ?? 2,
      channels: input.channels ?? 1,
    });
  }

  return null;
}

function isRiffWave(data: Buffer): boolean {
  return (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WAVE"
  );
}

function readWavDurationSec(data: Buffer): number | null {
  if (!isRiffWave(data)) {
    return null;
  }

  let offset = 12;
  let byteRate: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= data.length) {
    const chunkId = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;
    const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2);

    if (chunkId === "fmt ") {
      if (chunkDataOffset + chunkSize > data.length) {
        return null;
      }
      if (chunkSize < 16) {
        return null;
      }
      byteRate = data.readUInt32LE(chunkDataOffset + 8);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, data.length - chunkDataOffset);
    } else if (chunkDataOffset + chunkSize > data.length) {
      return null;
    }

    if (byteRate !== null && dataSize !== null) {
      break;
    }

    offset = nextOffset;
  }

  if (byteRate === null || byteRate <= 0 || dataSize === null) {
    return null;
  }

  return dataSize / byteRate;
}

function readPcmDurationSec(input: {
  data: Buffer;
  sampleRate?: number;
  bytesPerSample: number;
  channels: number;
}): number | null {
  const { sampleRate, bytesPerSample, channels } = input;
  if (
    sampleRate === undefined ||
    sampleRate <= 0 ||
    bytesPerSample <= 0 ||
    channels <= 0
  ) {
    return null;
  }

  return input.data.length / (sampleRate * bytesPerSample * channels);
}
