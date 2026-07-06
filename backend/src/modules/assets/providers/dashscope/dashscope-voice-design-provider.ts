const VOICE_DESIGN_MODEL = "qwen-voice-design";
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_RESPONSE_FORMAT = "wav";
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_PREFERRED_NAME = "storyforge";
const MAX_PREFERRED_NAME_LENGTH = 16;

export interface DashscopeVoiceDesignCreateInput {
  voicePrompt: string;
  previewText: string;
  preferredName: string;
  targetModel: string;
  language?: "zh" | "en" | "de" | "it" | "pt" | "es" | "ja" | "ko" | "fr" | "ru";
  sampleRate?: 8000 | 16000 | 24000 | 48000;
  responseFormat?: "pcm" | "wav" | "mp3" | "opus";
}

export interface DashscopeVoiceDesignCreatePayload {
  model: typeof VOICE_DESIGN_MODEL;
  input: {
    action: "create";
    target_model: string;
    preferred_name: string;
    voice_prompt: string;
    preview_text: string;
    language?: string;
  };
  parameters: {
    sample_rate: number;
    response_format: string;
  };
}

export interface CreateDashscopeDesignedVoiceInput
  extends DashscopeVoiceDesignCreateInput {
  apiKey: string;
  baseUrl?: string;
}

export interface DashscopeDesignedVoiceResult {
  providerVoiceId: string;
  providerStatus: "ready" | "failed";
  requestId: string | null;
  previewAudioBase64: string | null;
  rawResponseJson: Record<string, unknown>;
}

export function sanitizePreferredVoiceName(label?: string | null): string {
  const normalized = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safeName = /^[a-z]/.test(normalized)
    ? normalized
    : `voice_${normalized}`;

  return (safeName || DEFAULT_PREFERRED_NAME)
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_PREFERRED_NAME_LENGTH) || DEFAULT_PREFERRED_NAME;
}

export function buildDashscopeVoiceDesignCreatePayload(
  input: DashscopeVoiceDesignCreateInput,
): DashscopeVoiceDesignCreatePayload {
  return {
    model: VOICE_DESIGN_MODEL,
    input: {
      action: "create",
      target_model: input.targetModel,
      preferred_name: sanitizePreferredVoiceName(input.preferredName),
      voice_prompt: input.voicePrompt,
      preview_text: input.previewText,
      ...(input.language ? { language: input.language } : {}),
    },
    parameters: {
      sample_rate: input.sampleRate ?? DEFAULT_SAMPLE_RATE,
      response_format: input.responseFormat ?? DEFAULT_RESPONSE_FORMAT,
    },
  };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

function endpointFor(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/services/audio/tts/customization`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeCreateResponse(
  rawResponseJson: Record<string, unknown>,
): DashscopeDesignedVoiceResult {
  const output = readRecord(rawResponseJson.output);
  const providerVoiceId = output?.voice;
  if (typeof providerVoiceId !== "string" || providerVoiceId.trim() === "") {
    throw new Error("dashscope_voice_design_missing_voice");
  }

  const previewAudio = output ? readRecord(output.preview_audio) : undefined;
  const previewAudioData = previewAudio?.data;
  const requestId = rawResponseJson.request_id;

  return {
    providerVoiceId: providerVoiceId.trim(),
    providerStatus: "ready",
    requestId: typeof requestId === "string" ? requestId : null,
    previewAudioBase64:
      typeof previewAudioData === "string" && previewAudioData.trim()
        ? previewAudioData.trim()
        : null,
    rawResponseJson,
  };
}

export async function createDashscopeDesignedVoice(
  input: CreateDashscopeDesignedVoiceInput,
): Promise<DashscopeDesignedVoiceResult> {
  if (!input.apiKey.trim()) {
    throw new Error("dashscope_api_key_missing");
  }

  const response = await fetch(endpointFor(input.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildDashscopeVoiceDesignCreatePayload(input)),
  });

  const rawResponseJson = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `dashscope_voice_design_failed:${response.status}:${JSON.stringify(rawResponseJson)}`,
    );
  }

  return normalizeCreateResponse(rawResponseJson);
}
