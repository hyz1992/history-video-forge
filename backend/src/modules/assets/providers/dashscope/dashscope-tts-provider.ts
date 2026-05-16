/**
 * DashScope TTS provider shell.
 *
 * Payload builder only; full provider adapter (AssetProviderAdapter) wired later.
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

export interface DashScopeTtsInput {
  model: string;
  text: string;
  voiceProfileId: string;
  format?: "mp3" | "wav" | "flac" | "pcm";
  sampleRate?: number;
}

export interface DashScopeTtsPayload {
  model: string;
  input: {
    text: string;
    voice: string;
  };
  parameters: {
    format: string;
    sample_rate?: number;
  };
}

export function buildDashscopeTtsPayload(
  input: DashScopeTtsInput,
): DashScopeTtsPayload {
  return {
    model: input.model,
    input: {
      text: input.text,
      voice: input.voiceProfileId,
    },
    parameters: {
      format: input.format ?? "wav",
      sample_rate: input.sampleRate ?? 24000,
    },
  };
}
