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

  // ─── Crossfade tests ──────────────────────────────────────────────────────

  function makeWavBufferWithSamples(input: {
    durationSec: number;
    sampleRate: number;
    sampleValue: number;
    channels?: number;
  }): Buffer {
    const channels = input.channels ?? 1;
    const bytesPerSample = 2;
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
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(dataSize, 40);

    const clamped = Math.max(-32768, Math.min(32767, input.sampleValue));
    for (let i = 0; i < dataSize; i += 2) {
      buffer.writeInt16LE(clamped, 44 + i);
    }
    return buffer;
  }

  it("crossfade 30ms 时两段 WAV 输出总时长正确缩短", () => {
    const wav1 = makeWavBufferWithSamples({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 10000,
    });
    const wav2 = makeWavBufferWithSamples({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 20000,
    });

    const merged = mergeWavBuffers([wav1, wav2], { crossfadeMs: 30 });
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 24000,
    });

    // 2.0 - 0.03 = 1.97
    expect(duration).toBeCloseTo(1.97, 1);
    expect(countRiffHeaders(merged)).toBe(1);
  });

  it("crossfade 区域内样本值为两段线性混合", () => {
    const wav1 = makeWavBufferWithSamples({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 10000,
    });
    const wav2 = makeWavBufferWithSamples({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 20000,
    });

    const merged = mergeWavBuffers([wav1, wav2], { crossfadeMs: 30 });
    const sampleRate = 24000;
    const overlapFrames = Math.round((30 * sampleRate) / 1000);
    // Crossfade starts at: chunk1_frames - overlapFrames = 24000 - 720 = 23280
    const crossfadeStartFrame = sampleRate - overlapFrames;
    const midFrame = crossfadeStartFrame + Math.floor(overlapFrames / 2);
    const midSample = merged.readInt16LE(44 + midFrame * 2);

    // At midpoint gain is 0.5, so ~15000
    expect(midSample).toBeGreaterThan(13000);
    expect(midSample).toBeLessThan(17000);
  });

  it("crossfade 前区域保持 chunk1 原值，后区域保持 chunk2 原值", () => {
    const wav1 = makeWavBufferWithSamples({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 10000,
    });
    const wav2 = makeWavBufferWithSamples({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 20000,
    });

    const merged = mergeWavBuffers([wav1, wav2], { crossfadeMs: 30 });

    // Well before crossfade: should be chunk1 value
    const beforeSample = merged.readInt16LE(44 + 100 * 2);
    expect(beforeSample).toBe(10000);

    // Well after crossfade: should be chunk2 value
    const sampleRate = 24000;
    const overlapFrames = Math.round((30 * sampleRate) / 1000);
    const afterFrame = sampleRate + 100; // 100 frames into chunk2's non-overlap region
    const afterSample = merged.readInt16LE(44 + afterFrame * 2);
    expect(afterSample).toBe(20000);
  });

  it("crossfadeMs=0 行为与无 crossfade 完全一致", () => {
    const wav1 = makeWavBuffer({ durationSec: 1.0, sampleRate: 24000 });
    const wav2 = makeWavBuffer({ durationSec: 1.0, sampleRate: 24000 });

    const mergedPlain = mergeWavBuffers([wav1, wav2]);
    const mergedZero = mergeWavBuffers([wav1, wav2], { crossfadeMs: 0 });

    expect(mergedPlain.equals(mergedZero)).toBe(true);
  });

  it("单段 WAV 带 crossfade 选项不缩短", () => {
    const wav = makeWavBufferWithSamples({
      durationSec: 2.0,
      sampleRate: 24000,
      sampleValue: 5000,
    });

    const merged = mergeWavBuffers([wav], { crossfadeMs: 30 });
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 24000,
    });

    expect(duration).toBeCloseTo(2.0, 2);
  });

  // ─── DashScope streaming sentinel size ────────────────────────────────────

  function makeWavBufferWithSentinelDataSize(input: {
    durationSec: number;
    sampleRate: number;
    sampleValue?: number;
  }): Buffer {
    // 模拟 DashScope 流式合成返回的 WAV：data chunk size 字段写的是
    // 哨兵值 0x7FFFFFEB（≈ Int32.MAX，表示"流式长度未知"），
    // 而非实际 PCM 字节数。
    const bytesPerSample = 2;
    const channels = 1;
    const byteRate = input.sampleRate * channels * bytesPerSample;
    const blockAlign = channels * bytesPerSample;
    const dataSize = Math.round(input.durationSec * byteRate);
    const sampleValue = input.sampleValue ?? 10000;
    const clamped = Math.max(-32768, Math.min(32767, sampleValue));
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
    buffer.writeUInt16LE(bytesPerSample * 8, 34);
    buffer.write("data", 36, "ascii");
    // 哨兵值：实际 dataSize 远小于此
    buffer.writeUInt32LE(0x7fffffeb, 40);

    for (let i = 0; i < dataSize; i += 2) {
      buffer.writeInt16LE(clamped, 44 + i);
    }
    return buffer;
  }

  it("DashScope 流式 WAV（data size 哨兵值）不再抛 'extends past buffer end'", () => {
    // 回归用例：修复前 mergeWavBuffers 对 data chunk size 超界的 WAV 直接抛
    // "WAV chunk \"data\" extends past buffer end"，导致多 chunk TTS 合并失败。
    const wav1 = makeWavBufferWithSentinelDataSize({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 10000,
    });
    const wav2 = makeWavBufferWithSentinelDataSize({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 20000,
    });

    expect(() => mergeWavBuffers([wav1, wav2])).not.toThrow();
  });

  it("DashScope 流式 WAV 合并后时长与实际 PCM 字节数一致（非哨兵值）", () => {
    const wav1 = makeWavBufferWithSentinelDataSize({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 10000,
    });
    const wav2 = makeWavBufferWithSentinelDataSize({
      durationSec: 1.0,
      sampleRate: 24000,
      sampleValue: 20000,
    });

    const merged = mergeWavBuffers([wav1, wav2]);
    const duration = readAudioDurationSec({
      data: merged,
      format: "wav",
      sampleRate: 24000,
    });

    // 合并后的 WAV header 用实际 PCM 字节数重建，时长应准确为 2.0 秒，
    // 而非哨兵值暗示的 ~24 小时。
    expect(duration).toBeCloseTo(2.0, 1);
    expect(countRiffHeaders(merged)).toBe(1);
    // 合并后 data chunk size 字段应为真实字节数，不再是哨兵值
    expect(merged.readUInt32LE(40)).toBeLessThan(0x7fffff00);
  });
});
