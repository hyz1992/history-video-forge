import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDashscopeDesignedVoice,
  sanitizePreferredVoiceName,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-voice-design-provider.js";
import {
  buildDashscopeTtsPayload,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.js";

interface DashscopeVoiceLiveCheckEnv {
  RUN_DASHSCOPE_VOICE_LIVE_CHECK?: string;
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
}

interface VoiceLiveCheckPlan {
  mode: "assets_dashscope_voice_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  output_dir: string;
  required_env_keys: string[];
  optional_env_keys: string[];
  required_artifacts: string[];
}

interface VoiceLiveCheckStatus extends VoiceLiveCheckPlan {
  status: "assets_dashscope_voice_live_check_completed";
  voice_design_request_id: string | null;
  provider_voice_id: string;
  tts_request_id: string | null;
  preview_audio_path: string | null;
  tts_audio_path: string;
}

interface VoiceLiveCheckInput {
  outputDir?: string;
  env?: DashscopeVoiceLiveCheckEnv;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-dashscope-voice-live-check",
);
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_TARGET_MODEL = "qwen3-tts-vd-2026-01-26";
const DEFAULT_TTS_MODEL = "qwen3-tts-instruct-flash";
const LIVE_CHECK_CONFIRMATION_KEY = "RUN_DASHSCOPE_VOICE_LIVE_CHECK";

export function buildAssetsDashscopeVoiceLiveCheckPlan(
  input: { outputDir?: string } = {},
): VoiceLiveCheckPlan {
  return {
    mode: "assets_dashscope_voice_live_check",
    automated_gate: false,
    requires_real_env: true,
    provider_mode: "dashscope",
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    required_env_keys: [
      LIVE_CHECK_CONFIRMATION_KEY,
      "ALIYUN_DASHSCOPE_API_KEY",
    ],
    optional_env_keys: [
      "ALIYUN_DASHSCOPE_BASE_URL",
      "ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL",
      "ALIYUN_DASHSCOPE_TTS_MODEL",
    ],
    required_artifacts: [
      "live-check-plan.json",
      "voice-design-response.json",
      "tts-response.json",
      "tts-sample.wav",
      "status.json",
      "trace.md",
    ],
  };
}

export function buildLiveCheckNotEnabledMessage(
  input: { outputDir?: string } = {},
) {
  const plan = buildAssetsDashscopeVoiceLiveCheckPlan(input);
  return {
    status: "live_check_not_enabled",
    message:
      "Set RUN_DASHSCOPE_VOICE_LIVE_CHECK=1 and ALIYUN_DASHSCOPE_API_KEY to run this paid live check.",
    automated_gate: plan.automated_gate,
    required_env_keys: plan.required_env_keys,
  };
}

export async function runAssetsDashscopeVoiceLiveCheck(
  input: VoiceLiveCheckInput = {},
): Promise<VoiceLiveCheckStatus> {
  const plan = buildAssetsDashscopeVoiceLiveCheckPlan(input);
  const env = resolveEnv(input.env);
  assertLiveCheckEnabled(env);
  assertRequiredEnv(env);

  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);

  const resolvedEnv = withDefaults(env);
  const voiceDesign = await createDashscopeDesignedVoice({
    apiKey: resolvedEnv.ALIYUN_DASHSCOPE_API_KEY,
    baseUrl: resolvedEnv.ALIYUN_DASHSCOPE_BASE_URL,
    targetModel: resolvedEnv.ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL,
    preferredName: sanitizePreferredVoiceName("storyforge voice check"),
    voicePrompt:
      "30到45岁之间的中低音旁白，吐字清晰，语速中等偏慢，情绪克制但有叙事张力，适合历史故事短视频。",
    previewText:
      "宫门合上的一瞬间，所有人都知道，这个夜晚不会轻易结束。",
    language: "zh",
    sampleRate: 24000,
    responseFormat: "wav",
  });

  const previewAudioPath = voiceDesign.previewAudioBase64
    ? writeBase64File(
        plan.output_dir,
        "voice-preview.wav",
        voiceDesign.previewAudioBase64,
      )
    : null;
  writeJson(plan.output_dir, "voice-design-response.json", {
    request_id: voiceDesign.requestId,
    provider_voice_id: voiceDesign.providerVoiceId,
    provider_status: voiceDesign.providerStatus,
    preview_audio_path: previewAudioPath,
  });

  const ttsResponse = await submitTts({
    apiKey: resolvedEnv.ALIYUN_DASHSCOPE_API_KEY,
    baseUrl: resolvedEnv.ALIYUN_DASHSCOPE_BASE_URL,
    model: resolvedEnv.ALIYUN_DASHSCOPE_TTS_MODEL,
    providerVoiceId: voiceDesign.providerVoiceId,
    text: "这是一段声音设计后的本地显式测试音频。",
  });
  const audioBuffer = await downloadAudio(ttsResponse.audioUrl);
  const ttsAudioPath = writeBufferFile(plan.output_dir, "tts-sample.wav", audioBuffer);
  writeJson(plan.output_dir, "tts-response.json", {
    request_id: ttsResponse.requestId,
    provider_voice_id: voiceDesign.providerVoiceId,
    audio_path: ttsAudioPath,
  });

  const status: VoiceLiveCheckStatus = {
    ...plan,
    status: "assets_dashscope_voice_live_check_completed",
    voice_design_request_id: voiceDesign.requestId,
    provider_voice_id: voiceDesign.providerVoiceId,
    tts_request_id: ttsResponse.requestId,
    preview_audio_path: previewAudioPath,
    tts_audio_path: ttsAudioPath,
  };
  writeJson(plan.output_dir, "status.json", status);
  writeTrace(plan.output_dir, status);

  return status;
}

function resolveEnv(
  injectedEnv: DashscopeVoiceLiveCheckEnv | undefined,
): DashscopeVoiceLiveCheckEnv {
  return {
    ...readDotEnv(resolve(process.cwd(), ".env")),
    ...readDotEnv(resolve(process.cwd(), "backend/.env")),
    ...process.env,
    ...injectedEnv,
  };
}

function assertLiveCheckEnabled(env: DashscopeVoiceLiveCheckEnv): void {
  if (env.RUN_DASHSCOPE_VOICE_LIVE_CHECK !== "1") {
    throw new Error("live_check_not_enabled");
  }
}

function assertRequiredEnv(env: DashscopeVoiceLiveCheckEnv): void {
  const missing = ["ALIYUN_DASHSCOPE_API_KEY"].filter((key) => {
    const value = env[key as keyof DashscopeVoiceLiveCheckEnv];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`assets_dashscope_voice_live_env_missing:${missing.join(",")}`);
  }
}

function withDefaults(env: DashscopeVoiceLiveCheckEnv): Required<Pick<
  DashscopeVoiceLiveCheckEnv,
  | "ALIYUN_DASHSCOPE_API_KEY"
  | "ALIYUN_DASHSCOPE_BASE_URL"
  | "ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL"
  | "ALIYUN_DASHSCOPE_TTS_MODEL"
>> {
  return {
    ALIYUN_DASHSCOPE_API_KEY: env.ALIYUN_DASHSCOPE_API_KEY ?? "",
    ALIYUN_DASHSCOPE_BASE_URL:
      env.ALIYUN_DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL,
    ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL:
      env.ALIYUN_DASHSCOPE_VOICE_DESIGN_TARGET_MODEL ?? DEFAULT_TARGET_MODEL,
    ALIYUN_DASHSCOPE_TTS_MODEL:
      env.ALIYUN_DASHSCOPE_TTS_MODEL ?? DEFAULT_TTS_MODEL,
  };
}

async function submitTts(input: {
  apiKey: string;
  baseUrl: string;
  model: string;
  providerVoiceId: string;
  text: string;
}): Promise<{ requestId: string | null; audioUrl: string }> {
  const response = await fetch(
    `${input.baseUrl.replace(/\/$/, "")}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "disable",
      },
      body: JSON.stringify(
        buildDashscopeTtsPayload({
          model: input.model,
          text: input.text,
          providerVoiceId: input.providerVoiceId,
          format: "wav",
          sampleRate: 24000,
        }),
      ),
    },
  );
  const raw = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`dashscope_voice_live_tts_failed:${response.status}`);
  }
  const output = readRecord(raw.output);
  const audio = readRecord(output?.audio);
  const audioUrl = audio?.url;
  if (typeof audioUrl !== "string" || audioUrl.trim() === "") {
    throw new Error("dashscope_voice_live_tts_missing_audio_url");
  }
  const requestId = raw.request_id;
  return {
    requestId: typeof requestId === "string" ? requestId : null,
    audioUrl: audioUrl.trim(),
  };
}

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`dashscope_voice_live_audio_download_failed:${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    result[key] = rawValue.trim().replace(/^["']|["']$/gu, "");
  }
  return result;
}

function writeBase64File(
  outputDir: string,
  filename: string,
  base64: string,
): string {
  return writeBufferFile(outputDir, filename, Buffer.from(base64, "base64"));
}

function writeBufferFile(outputDir: string, filename: string, data: Buffer): string {
  mkdirSync(outputDir, { recursive: true });
  const filePath = resolve(outputDir, filename);
  writeFileSync(filePath, data);
  return filePath;
}

function writeJson(outputDir: string, filename: string, value: unknown): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function writeTrace(outputDir: string, status: VoiceLiveCheckStatus): void {
  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# assets DashScope voice live check",
      "",
      `- mode: ${status.mode}`,
      `- automated_gate: ${status.automated_gate}`,
      `- provider_mode: ${status.provider_mode}`,
      `- voice_design_request_id: ${status.voice_design_request_id ?? "unknown"}`,
      `- provider_voice_id: ${status.provider_voice_id}`,
      `- tts_request_id: ${status.tts_request_id ?? "unknown"}`,
      `- preview_audio_path: ${status.preview_audio_path ?? "none"}`,
      `- tts_audio_path: ${status.tts_audio_path}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function parseCliArgs(argv: string[]) {
  const result: { outputDir?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
    }
  }

  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const env = resolveEnv(undefined);

  if (env.RUN_DASHSCOPE_VOICE_LIVE_CHECK !== "1") {
    process.stdout.write(
      `${JSON.stringify(buildLiveCheckNotEnabledMessage(args), null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const status = await runAssetsDashscopeVoiceLiveCheck(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: status.status,
        output_dir: status.output_dir,
        voice_design_request_id: status.voice_design_request_id,
        provider_voice_id: status.provider_voice_id,
        tts_request_id: status.tts_request_id,
        tts_audio_path: status.tts_audio_path,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
