/**
 * WAV 合并工具测试（TDD）。
 *
 * 验证 mergeWavBuffers 正确解析多个 WAV 的 RIFF/data chunk，
 * 拼接 PCM data 并生成单个合法 WAV header，
 * 而不是简单 Buffer.concat 多个 WAV 文件头。
 */

import { describe, expect, it } from "vitest";

import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";
import { mergeWavBuffers } from "../../../backend/src/modules/assets/wav-merge.js";

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

function countRiffHeaders(data: Buffer): number {
  let count = 0;
  for (let i = 0; i <= data.length - 4; i++) {
    if (
      data[i] === 0x52 &&
      data[i + 1] === 0x49 &&
      data[i + 2] === 0x46 &&
      data[i + 3] === 0x46
    ) {
      count += 1;
    }
  }
  return count;
}

describe("mergeWavBuffers", () => {
  it("合并两个短 WAV，readAudioDurationSec 返回总时长", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.5, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 2.0, sampleRate: 24000 });

    const merged = mergeWavBuffers([wav1, wav2]);
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 24000,
    });

    expect(duration).toBeCloseTo(3.5, 2);
  });

  it("合并后输出只含一个 RIFF 文件头", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.0, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 2.0, sampleRate: 24000 });

    const merged = mergeWavBuffers([wav1, wav2]);

    expect(countRiffHeaders(merged)).toBe(1);
  });

  it("合并后输出以 RIFF 开头、包含 WAVE 标识", () => {
    const wav1 = makeWavBuffer({ durationSec: 0.5, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 0.3, sampleRate: 24000 });

    const merged = mergeWavBuffers([wav1, wav2]);

    expect(merged.toString("ascii", 0, 4)).toBe("RIFF");
    expect(merged.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("合并后 data chunk 大小等于所有输入 PCM data 之和", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.0, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 1.5, sampleRate: 24000 });

    const dataSize1 = wav1.readUInt32LE(40);
    const dataSize2 = wav2.readUInt32LE(40);

    const merged = mergeWavBuffers([wav1, wav2]);
    const mergedDataSize = merged.readUInt32LE(40);

    expect(mergedDataSize).toBe(dataSize1 + dataSize2);
  });

  it("单个 WAV 合并后仍为合法 WAV 且时长一致", () => {
    const wav1 = makeWavBuffer({ durationSec: 2.5, sampleRate: 48000 });

    const merged = mergeWavBuffers([wav1]);
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 48000,
    });

    expect(duration).toBeCloseTo(2.5, 2);
    expect(countRiffHeaders(merged)).toBe(1);
  });

  it("三个 WAV 合并后时长正确累加", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.0, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 2.0, sampleRate: 24000 });
    const wav3 = makeWavBuffer({ durationSec: 0.5, sampleRate: 24000 });

    const merged = mergeWavBuffers([wav1, wav2, wav3]);
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 24000,
    });

    expect(duration).toBeCloseTo(3.5, 2);
    expect(countRiffHeaders(merged)).toBe(1);
  });

  it("采样率不一致时抛出明确错误", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.0, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 1.0, sampleRate: 48000 });

    expect(() => mergeWavBuffers([wav1, wav2])).toThrow(/sample rate/i);
  });

  it("声道数不一致时抛出明确错误", () => {
    const wav1 = makeWavBuffer({
      durationSec: 1.0,
      sampleRate: 24000,
      channels: 1,
    });
    const wav2 = makeWavBuffer({
      durationSec: 1.0,
      sampleRate: 24000,
      channels: 2,
    });

    expect(() => mergeWavBuffers([wav1, wav2])).toThrow(/channel/i);
  });

  it("空数组抛出错误", () => {
    expect(() => mergeWavBuffers([])).toThrow();
  });

  it("非 WAV 数据抛出错误", () => {
    const notWav = Buffer.from("not a wav file at all");
    expect(() => mergeWavBuffers([notWav])).toThrow();
  });

  it("合并后的 WAV 文件大小与 header 声明一致", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.2, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 0.8, sampleRate: 24000 });

    const merged = mergeWavBuffers([wav1, wav2]);
    const declaredFileSize = merged.readUInt32LE(4);

    // RIFF fileSize = totalSize - 8
    expect(declaredFileSize).toBe(merged.length - 8);
  });

  it("16-bit 立体声 WAV 合并后参数保持一致", () => {
    const wav1 = makeWavBuffer({
      durationSec: 1.0,
      sampleRate: 44100,
      channels: 2,
      bytesPerSample: 2,
    });
    const wav2 = makeWavBuffer({
      durationSec: 2.0,
      sampleRate: 44100,
      channels: 2,
      bytesPerSample: 2,
    });

    const merged = mergeWavBuffers([wav1, wav2]);
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 44100,
    });

    expect(duration).toBeCloseTo(3.0, 2);
    expect(countRiffHeaders(merged)).toBe(1);

    // 验证 fmt chunk 参数
    expect(merged.readUInt16LE(22)).toBe(2); // channels
    expect(merged.readUInt32LE(24)).toBe(44100); // sample rate
    expect(merged.readUInt16LE(34)).toBe(16); // bits per sample
  });
});
