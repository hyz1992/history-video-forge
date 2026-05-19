import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildDashscopeTtsPayload,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.js";

interface DashscopeTtsLiveCheckEnv {
  RUN_DASHSCOPE_TTS_LIVE_CHECK?: string;
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
  ALIYUN_DASHSCOPE_TTS_VOICE?: string;
}

interface TtsLiveCheckPlan {
  mode: "assets_dashscope_tts_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  output_dir: string;
  required_env_keys: string[];
  optional_env_keys: string[];
  required_artifacts: string[];
  default_voice: string;
  default_model: string;
}

interface TtsLiveCheckStatus extends TtsLiveCheckPlan {
  status: "assets_dashscope_tts_live_check_completed";
  request_id: string | null;
  provider_voice_id: string;
  model: string;
  sample_rate: number;
  format: "wav";
  text_length: number;
  audio_path: string;
  audio_bytes: number;
}

interface TtsLiveCheckInput {
  outputDir?: string;
  text?: string;
  voice?: string;
  model?: string;
  env?: DashscopeTtsLiveCheckEnv;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-dashscope-tts-live-check",
);
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_TTS_MODEL = "qwen3-tts-instruct-flash";
const DEFAULT_TTS_VOICE = "Ethan";
const DEFAULT_TEXT = "This is a short Story Video Forge TTS live check.";
const SAMPLE_RATE = 24000;
const RESPONSE_FORMAT = "wav";
const LIVE_CHECK_CONFIRMATION_KEY = "RUN_DASHSCOPE_TTS_LIVE_CHECK";

export function buildAssetsDashscopeTtsLiveCheckPlan(
  input: { outputDir?: string } = {},
): TtsLiveCheckPlan {
  return {
    mode: "assets_dashscope_tts_live_check",
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
      "ALIYUN_DASHSCOPE_TTS_MODEL",
      "ALIYUN_DASHSCOPE_TTS_VOICE",
    ],
    required_artifacts: [
      "live-check-plan.json",
      "tts-response.json",
      "tts-sample.wav",
      "status.json",
      "trace.md",
    ],
    default_voice: DEFAULT_TTS_VOICE,
    default_model: DEFAULT_TTS_MODEL,
  };
}

export function buildTtsLiveCheckNotEnabledMessage(
  input: { outputDir?: string } = {},
) {
  const plan = buildAssetsDashscopeTtsLiveCheckPlan(input);
  return {
    status: "tts_live_check_not_enabled",
    message:
      "Set RUN_DASHSCOPE_TTS_LIVE_CHECK=1 and ALIYUN_DASHSCOPE_API_KEY to run this real TTS live check.",
    automated_gate: plan.automated_gate,
    required_env_keys: plan.required_env_keys,
  };
}

export async function runAssetsDashscopeTtsLiveCheck(
  input: TtsLiveCheckInput = {},
): Promise<TtsLiveCheckStatus> {
  const plan = buildAssetsDashscopeTtsLiveCheckPlan(input);
  const env = resolveEnv(input.env);
  assertLiveCheckEnabled(env);
  assertRequiredEnv(env);

  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);

  const resolved = withDefaults(env, input);
  const ttsResponse = await submitTts({
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    providerVoiceId: resolved.voice,
    text: resolved.text,
  });
  const audioBuffer = await downloadAudio(ttsResponse.audioUrl);
  const audioPath = writeBufferFile(plan.output_dir, "tts-sample.wav", audioBuffer);

  writeJson(plan.output_dir, "tts-response.json", {
    request_id: ttsResponse.requestId,
    provider_voice_id: resolved.voice,
    model: resolved.model,
    audio_path: audioPath,
    audio_bytes: audioBuffer.byteLength,
  });

  const status: TtsLiveCheckStatus = {
    ...plan,
    status: "assets_dashscope_tts_live_check_completed",
    request_id: ttsResponse.requestId,
    provider_voice_id: resolved.voice,
    model: resolved.model,
    sample_rate: SAMPLE_RATE,
    format: RESPONSE_FORMAT,
    text_length: resolved.text.length,
    audio_path: audioPath,
    audio_bytes: audioBuffer.byteLength,
  };
  writeJson(plan.output_dir, "status.json", status);
  writeTrace(plan.output_dir, status);

  return status;
}

function resolveEnv(
  injectedEnv: DashscopeTtsLiveCheckEnv | undefined,
): DashscopeTtsLiveCheckEnv {
  return {
    ...readDotEnv(resolve(process.cwd(), ".env")),
    ...readDotEnv(resolve(process.cwd(), "backend/.env")),
    ...process.env,
    ...injectedEnv,
  };
}

function assertLiveCheckEnabled(env: DashscopeTtsLiveCheckEnv): void {
  if (env.RUN_DASHSCOPE_TTS_LIVE_CHECK !== "1") {
    throw new Error("tts_live_check_not_enabled");
  }
}

function assertRequiredEnv(env: DashscopeTtsLiveCheckEnv): void {
  const missing = ["ALIYUN_DASHSCOPE_API_KEY"].filter((key) => {
    const value = env[key as keyof DashscopeTtsLiveCheckEnv];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`assets_dashscope_tts_live_env_missing:${missing.join(",")}`);
  }
}

function withDefaults(env: DashscopeTtsLiveCheckEnv, input: TtsLiveCheckInput) {
  return {
    apiKey: env.ALIYUN_DASHSCOPE_API_KEY ?? "",
    baseUrl: env.ALIYUN_DASHSCOPE_BASE_URL ?? DEFAULT_BASE_URL,
    model: input.model ?? env.ALIYUN_DASHSCOPE_TTS_MODEL ?? DEFAULT_TTS_MODEL,
    voice: input.voice ?? env.ALIYUN_DASHSCOPE_TTS_VOICE ?? DEFAULT_TTS_VOICE,
    text: input.text ?? DEFAULT_TEXT,
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
          format: RESPONSE_FORMAT,
          sampleRate: SAMPLE_RATE,
        }),
      ),
    },
  );
  const raw = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`dashscope_tts_live_check_failed:${response.status}`);
  }
  const audioUrl = extractAudioUrl(raw);
  if (!audioUrl) {
    throw new Error("dashscope_tts_live_check_missing_audio_url");
  }
  const requestId = raw.request_id;
  return {
    requestId: typeof requestId === "string" ? requestId : null,
    audioUrl,
  };
}

function extractAudioUrl(raw: Record<string, unknown>): string | null {
  const output = readRecord(raw.output);
  const audio = readRecord(output?.audio);
  const url = audio?.url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`dashscope_tts_live_check_audio_download_failed:${response.status}`);
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

function writeTrace(outputDir: string, status: TtsLiveCheckStatus): void {
  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# assets DashScope TTS live check",
      "",
      `- mode: ${status.mode}`,
      `- automated_gate: ${status.automated_gate}`,
      `- provider_mode: ${status.provider_mode}`,
      `- request_id: ${status.request_id ?? "unknown"}`,
      `- provider_voice_id: ${status.provider_voice_id}`,
      `- model: ${status.model}`,
      `- sample_rate: ${status.sample_rate}`,
      `- format: ${status.format}`,
      `- audio_path: ${status.audio_path}`,
      `- audio_bytes: ${status.audio_bytes}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function parseCliArgs(argv: string[]) {
  const result: {
    outputDir?: string;
    text?: string;
    voice?: string;
    model?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }
    if (current === "--text" && next) {
      result.text = next;
      index += 1;
      continue;
    }
    if (current === "--voice" && next) {
      result.voice = next;
      index += 1;
      continue;
    }
    if (current === "--model" && next) {
      result.model = next;
      index += 1;
    }
  }

  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const env = resolveEnv(undefined);

  if (env.RUN_DASHSCOPE_TTS_LIVE_CHECK !== "1") {
    process.stdout.write(
      `${JSON.stringify(buildTtsLiveCheckNotEnabledMessage(args), null, 2)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const status = await runAssetsDashscopeTtsLiveCheck(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: status.status,
        output_dir: status.output_dir,
        request_id: status.request_id,
        provider_voice_id: status.provider_voice_id,
        model: status.model,
        audio_path: status.audio_path,
        audio_bytes: status.audio_bytes,
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
