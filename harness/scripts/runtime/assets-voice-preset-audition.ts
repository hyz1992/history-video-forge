/**
 * 语音预设试听 live-check。
 *
 * 为选定的预设音色分别调用 DashScope 语音设计 API，
 * 保存每个音色的预览音频和 TTS 测试样句，供人工试听对比。
 *
 * 运行方式：
 *   npx tsx harness/scripts/runtime/assets-voice-preset-audition.ts --presets cold_authority,steady_documentary
 *
 * 必须设置环境变量：
 *   RUN_DASHSCOPE_VOICE_LIVE_CHECK=1
 *   ALIYUN_DASHSCOPE_API_KEY=<your-key>
 */

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
import { SHARED_VOICE_PROFILE_SEEDS } from "../../../backend/src/modules/assets/voice/voice-presets.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PresetAuditionResult {
  voice_profile_id: string;
  name: string;
  description: string;
  provider_voice_id: string | null;
  voice_design_status: "ok" | "failed";
  voice_design_error?: string;
  preview_audio_path: string | null;
  tts_audio_path: string | null;
  tts_status: "ok" | "failed" | "skipped";
  tts_error?: string;
}

interface AuditionManifest {
  mode: "assets_voice_preset_audition";
  output_dir: string;
  presets_auditioned: string[];
  results: PresetAuditionResult[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-voice-preset-audition",
);
const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const LIVE_CHECK_CONFIRMATION_KEY = "RUN_DASHSCOPE_VOICE_LIVE_CHECK";

const TTS_TEST_SENTENCE = "公元前531年，楚王听说晏子要来，想当众羞辱他。楚王知道晏子身材矮小，特意在城门旁边开了个小洞。";

// 历史叙事推荐试听的预设音色（按适用性排序）
const HISTORY_NARRATIVE_PRESETS = [
  "voice_preset_steady_documentary",
  "voice_preset_cold_authority",
  "voice_preset_crisp_storyteller",
];

// 所有可试听的预设（排除 system 类型）
const ALL_DESIGNABLE_PRESETS = SHARED_VOICE_PROFILE_SEEDS
  .filter((p) => p.kind !== "system")
  .map((p) => p.voice_profile_id);

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseCliArgs(argv: string[]) {
  const result: { outputDir?: string; presets?: string[] } = {};
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    const next = argv[i + 1];
    if (cur === "--output-dir" && next) {
      result.outputDir = next;
      i++;
    } else if (cur === "--presets" && next) {
      result.presets = next.split(",").map((s) => s.trim()).filter(Boolean);
      i++;
    }
  }
  return result;
}

// ─── Env ──────────────────────────────────────────────────────────────────────

function readDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = rawValue.trim().replace(/^["']|["']$/gu, "");
  }
  return result;
}

function resolveEnv(): Record<string, string | undefined> {
  return {
    ...readDotEnv(resolve(process.cwd(), ".env")),
    ...readDotEnv(resolve(process.cwd(), "backend/.env")),
    ...process.env,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeJson(outputDir: string, filename: string, value: unknown): void {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function writeBase64File(outputDir: string, filename: string, base64: string): string {
  mkdirSync(outputDir, { recursive: true });
  const filePath = resolve(outputDir, filename);
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

function writeBufferFile(outputDir: string, filename: string, data: Buffer): string {
  mkdirSync(outputDir, { recursive: true });
  const filePath = resolve(outputDir, filename);
  writeFileSync(filePath, data);
  return filePath;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

async function submitTts(input: {
  apiKey: string;
  baseUrl: string;
  providerVoiceId: string;
  text: string;
}): Promise<{ audioUrl: string }> {
  const payload = buildDashscopeTtsPayload({
    model: "qwen3-tts-vd-2026-01-26",
    text: input.text,
    providerVoiceId: input.providerVoiceId,
    format: "wav",
    sampleRate: 24000,
  });

  const response = await fetch(
    `${input.baseUrl.replace(/\/$/, "")}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "disable",
      },
      body: JSON.stringify(payload),
    },
  );

  const raw = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`TTS failed: ${response.status} ${JSON.stringify(raw)}`);
  }

  const output = readRecord(raw.output);
  const audio = readRecord(output?.audio);
  const audioUrl = audio?.url;
  if (typeof audioUrl !== "string" || audioUrl.trim() === "") {
    throw new Error("TTS response missing audio URL");
  }
  return { audioUrl: audioUrl.trim() };
}

async function downloadAudio(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audio download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ─── Core ─────────────────────────────────────────────────────────────────────

async function auditionPreset(input: {
  apiKey: string;
  baseUrl: string;
  profileId: string;
  outputDir: string;
}): Promise<PresetAuditionResult> {
  const profile = SHARED_VOICE_PROFILE_SEEDS.find(
    (p) => p.voice_profile_id === input.profileId,
  );

  if (!profile) {
    return {
      voice_profile_id: input.profileId,
      name: input.profileId,
      description: "",
      provider_voice_id: null,
      voice_design_status: "failed",
      voice_design_error: `未找到预设音色: ${input.profileId}`,
      preview_audio_path: null,
      tts_audio_path: null,
      tts_status: "skipped",
    };
  }

  // 使用 voice_profile_id 的末段作为文件名前缀，中文 name 会被 sanitize 清空
  const shortId = profile.voice_profile_id.replace(/^voice_preset_/, "");
  const safeName = sanitizePreferredVoiceName(shortId) || shortId;
  const result: PresetAuditionResult = {
    voice_profile_id: profile.voice_profile_id,
    name: profile.name,
    description: profile.description,
    provider_voice_id: null,
    voice_design_status: "failed",
    preview_audio_path: null,
    tts_audio_path: null,
    tts_status: "skipped",
  };

  // Step 1: Voice design
  try {
    const design = await createDashscopeDesignedVoice({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      targetModel: profile.target_model,
      preferredName: safeName,
      voicePrompt: profile.design_prompt,
      previewText: profile.preview_text,
      language: "zh",
      sampleRate: 24000,
      responseFormat: "wav",
    });

    result.provider_voice_id = design.providerVoiceId;
    result.voice_design_status = "ok";

    // Save preview audio
    if (design.previewAudioBase64) {
      result.preview_audio_path = writeBase64File(
        input.outputDir,
        `preview_${safeName}.wav`,
        design.previewAudioBase64,
      );
    }

    // Save voice design response
    writeJson(input.outputDir, `voice_design_${safeName}.json`, {
      voice_profile_id: profile.voice_profile_id,
      name: profile.name,
      provider_voice_id: design.providerVoiceId,
      request_id: design.requestId,
      preview_audio_path: result.preview_audio_path,
    });
  } catch (err) {
    result.voice_design_error = err instanceof Error ? err.message : String(err);
    writeJson(input.outputDir, `voice_design_${safeName}_error.json`, {
      voice_profile_id: profile.voice_profile_id,
      error: result.voice_design_error,
    });
    return result;
  }

  // Step 2: TTS test sentence
  try {
    const tts = await submitTts({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerVoiceId: result.provider_voice_id!,
      text: TTS_TEST_SENTENCE,
    });
    const audioBuffer = await downloadAudio(tts.audioUrl);
    result.tts_audio_path = writeBufferFile(
      input.outputDir,
      `tts_${safeName}.wav`,
      audioBuffer,
    );
    result.tts_status = "ok";
  } catch (err) {
    result.tts_error = err instanceof Error ? err.message : String(err);
    result.tts_status = "failed";
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runVoicePresetAudition(input: {
  outputDir?: string;
  presetIds?: string[];
  env?: Record<string, string | undefined>;
}): Promise<AuditionManifest> {
  const outputDir = input.outputDir ?? DEFAULT_OUTPUT_DIR;
  const env = input.env ?? resolveEnv();

  if (env[LIVE_CHECK_CONFIRMATION_KEY] !== "1") {
    throw new Error(
      `live_check_not_enabled: 请设置 ${LIVE_CHECK_CONFIRMATION_KEY}=1 确认运行付费语音设计 API`,
    );
  }

  const apiKey = env.ALIYUN_DASHSCOPE_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new Error("缺少 ALIYUN_DASHSCOPE_API_KEY 环境变量");
  }

  const baseUrl = (typeof env.ALIYUN_DASHSCOPE_BASE_URL === "string" && env.ALIYUN_DASHSCOPE_BASE_URL.trim())
    ? env.ALIYUN_DASHSCOPE_BASE_URL.trim()
    : DEFAULT_BASE_URL;

  const presetIds = input.presetIds ?? HISTORY_NARRATIVE_PRESETS;

  // Validate preset IDs
  const validIds = new Set(ALL_DESIGNABLE_PRESETS);
  for (const id of presetIds) {
    if (!validIds.has(id)) {
      throw new Error(
        `无效预设 ID: ${id}。可选: ${ALL_DESIGNABLE_PRESETS.join(", ")}`,
      );
    }
  }

  mkdirSync(outputDir, { recursive: true });

  const results: PresetAuditionResult[] = [];
  for (const profileId of presetIds) {
    const result = await auditionPreset({
      apiKey: apiKey.trim(),
      baseUrl,
      profileId,
      outputDir,
    });
    results.push(result);
  }

  const manifest: AuditionManifest = {
    mode: "assets_voice_preset_audition",
    output_dir: outputDir,
    presets_auditioned: presetIds,
    results,
  };

  writeJson(outputDir, "audition-manifest.json", manifest);
  writeTrace(outputDir, manifest);

  return manifest;
}

// ─── Trace ────────────────────────────────────────────────────────────────────

function writeTrace(outputDir: string, manifest: AuditionManifest): void {
  const lines = [
    "# 语音预设试听报告",
    "",
    `输出目录: ${manifest.output_dir}`,
    `试听预设数: ${manifest.results.length}`,
    "",
    "## 结果汇总",
    "",
  ];

  for (const r of manifest.results) {
    const statusIcon = r.voice_design_status === "ok" ? "✅" : "❌";
    lines.push(`### ${statusIcon} ${r.name} (\`${r.voice_profile_id}\`)`);
    lines.push("");
    lines.push(`- 描述: ${r.description}`);
    lines.push(`- 语音设计: ${r.voice_design_status}`);
    if (r.provider_voice_id) {
      lines.push(`- 供应商音色 ID: \`${r.provider_voice_id}\``);
    }
    if (r.voice_design_error) {
      lines.push(`- 设计错误: ${r.voice_design_error}`);
    }
    if (r.preview_audio_path) {
      lines.push(`- 预览音频: \`${r.preview_audio_path}\``);
    }
    lines.push(`- TTS 测试: ${r.tts_status}`);
    if (r.tts_audio_path) {
      lines.push(`- TTS 音频: \`${r.tts_audio_path}\``);
    }
    if (r.tts_error) {
      lines.push(`- TTS 错误: ${r.tts_error}`);
    }
    lines.push("");
  }

  writeFileSync(resolve(outputDir, "trace.md"), lines.join("\n"), "utf8");
}

// ─── CLI Entry ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.presets) {
    process.stderr.write(`试听预设: ${args.presets.join(", ")}\n`);
  } else {
    process.stderr.write(`试听默认历史叙事预设: ${HISTORY_NARRATIVE_PRESETS.join(", ")}\n`);
  }

  const manifest = await runVoicePresetAudition({
    outputDir: args.outputDir,
    presetIds: args.presets,
  });

  const summary = manifest.results.map((r) => ({
    name: r.name,
    profile_id: r.voice_profile_id,
    design: r.voice_design_status,
    tts: r.tts_status,
    preview: r.preview_audio_path,
    tts_sample: r.tts_audio_path,
  }));

  process.stdout.write(JSON.stringify({ status: "completed", summary }, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
