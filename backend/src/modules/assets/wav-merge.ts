/**
 * WAV 合并工具。
 *
 * 正确解析多个 PCM WAV 的 RIFF header 与 data chunk，
 * 拼接 PCM data 并生成单个合法 WAV header。
 * 不使用 Buffer.concat 直接拼接，避免多个 RIFF 头导致播放器只播放第一段。
 */

interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcmData: Buffer;
  dataSize: number;
}

export function mergeWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("Cannot merge empty WAV buffer list");
  }

  const parsed = buffers.map((buf) => parseWavChunks(buf));
  const first = parsed[0]!;

  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i]!;
    if (p.sampleRate !== first.sampleRate) {
      throw new Error(
        `WAV sample rate mismatch: chunk 0=${first.sampleRate}, chunk ${i}=${p.sampleRate}`,
      );
    }
    if (p.channels !== first.channels) {
      throw new Error(
        `WAV channel count mismatch: chunk 0=${first.channels}, chunk ${i}=${p.channels}`,
      );
    }
    if (p.bitsPerSample !== first.bitsPerSample) {
      throw new Error(
        `WAV bits per sample mismatch: chunk 0=${first.bitsPerSample}, chunk ${i}=${p.bitsPerSample}`,
      );
    }
  }

  const totalDataSize = parsed.reduce((sum, p) => sum + p.dataSize, 0);
  const pcmData = Buffer.concat(parsed.map((p) => p.pcmData));

  const header = buildWavHeader({
    sampleRate: first.sampleRate,
    channels: first.channels,
    bitsPerSample: first.bitsPerSample,
    dataSize: totalDataSize,
  });

  return Buffer.concat([header, pcmData]);
}

function parseWavChunks(buffer: Buffer): ParsedWav {
  if (buffer.length < 44) {
    throw new Error("Buffer too small to be a valid WAV");
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Missing RIFF header");
  }
  if (buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Missing WAVE identifier");
  }

  let offset = 12;
  let fmtInfo: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
  } | null = null;
  let pcmData: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (dataOffset + chunkSize > buffer.length) {
      throw new Error(
        `WAV chunk "${chunkId}" extends past buffer end`,
      );
    }

    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = buffer.readUInt16LE(dataOffset);
      if (audioFormat !== 1) {
        throw new Error(
          `Unsupported WAV audio format: ${audioFormat} (expected PCM=1)`,
        );
      }
      fmtInfo = {
        channels: buffer.readUInt16LE(dataOffset + 2),
        sampleRate: buffer.readUInt32LE(dataOffset + 4),
        bitsPerSample: buffer.readUInt16LE(dataOffset + 14),
      };
    } else if (chunkId === "data") {
      pcmData = buffer.subarray(dataOffset, dataOffset + chunkSize);
    }

    // RIFF chunks are 2-byte aligned; skip padding byte if chunkSize is odd
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  if (!fmtInfo) {
    throw new Error("WAV missing fmt chunk");
  }
  if (!pcmData) {
    throw new Error("WAV missing data chunk");
  }

  return {
    ...fmtInfo,
    pcmData,
    dataSize: pcmData.length,
  };
}

function buildWavHeader(input: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataSize: number;
}): Buffer {
  const { sampleRate, channels, bitsPerSample, dataSize } = input;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  // fileSize = totalSize - 8 = (44 + dataSize) - 8 = 36 + dataSize
  const fileSize = 36 + dataSize;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt sub-chunk size
  header.writeUInt16LE(1, 20); // audio format PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);

  return header;
}
