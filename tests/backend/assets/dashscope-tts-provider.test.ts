/**
 * DashScope TTS provider payload builder shell tests.
 *
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import {
  buildDashscopeTtsPayload,
  createDashscopeTtsProvider,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

function makeWavBuffer(input: {
  durationSec: number;
  sampleRate: number;
  channels?: number;
  bytesPerSample?: number;
}): Buffer {
  const channels = input.channels ?? 1;
  const bytesPerSample = input.bytesPerSample ?? 2;
  const byteRate = input.sampleRate * channels * bytesPerSample;
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
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}

describe("dashscope TTS payload builder", () => {
  it("payload includes text and voice_profile_id", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts-test",
      text: "第一句旁白。",
      providerVoiceId: "voice_001",
      format: "wav",
    });

    expect(payload.input.text).toBe("第一句旁白。");
    expect(payload.input.voice).toBe("voice_001");

    const json = JSON.stringify(payload);
    expect(json).toContain("第一句旁白。");
    expect(json).toContain("voice_001");
  });

  it("defaults to wav format and 24000 sample rate", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts",
      text: "test",
      providerVoiceId: "voice_001",
    });

    expect(payload.parameters.format).toBe("wav");
    expect(payload.parameters.sample_rate).toBe(24000);
  });

  it("respects explicit format override", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts",
      text: "test",
      providerVoiceId: "voice_001",
      format: "mp3",
    });

    expect(payload.parameters.format).toBe("mp3");
  });

  it("uses providerVoiceId as voice in input", () => {
    const payload = buildDashscopeTtsPayload({
      model: "qwen-tts",
      text: "测试文本",
      providerVoiceId: "Cherry",
    });

    expect(payload.input.voice).toBe("Cherry");
  });
});

function makeTtsManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "Cherry",
      enabled_provider_types: ["tts"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_tts_001",
        task_id: "task_tts",
        task_type: "tts_audio",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: null,
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
    ],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "Cherry",
      tts_total_duration_sec: null,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [
        {
          tts_chunk_id: "chunk_001",
          artifact_id: null,
          segment_ids: ["sb_001"],
          script_excerpt: "第一句旁白。",
        },
      ],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: null,
        subtitle_artifact_id: null,
        primary_visual_artifact_id: null,
        visual_route_type: "missing",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "blocked",
        notes: [],
      },
    ],
    readiness: "blocked",
    notes: [],
  };
}

function makeTtsAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "test",
      visual_tone: "test",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "test",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "Cherry",
      estimated_total_duration_sec: 1,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "chunk_001",
          order: 0,
          script_excerpt: "第一句旁白。",
          estimated_duration_sec: 1,
        },
      ],
    },
    tasks: [
      {
        task_id: "task_tts",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "第一句旁白。",
        production_intent: "generate narration",
        recommended_mode: "auto",
        provider_hint: "dashscope_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { tts_audio: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

describe("dashscope TTS provider adapter", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("uses DashScope sync TTS and writes chunk plus merged artifacts", async () => {
    tempDir = join(tmpdir(), `dashscope-tts-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url.includes("/api/v1/services/aigc/multimodal-generation/generation")) {
        return new Response(
          JSON.stringify({
            output: { audio: { url: "https://download.test/chunk.wav" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });

    const result = await executeAssetManifest({
      db: createDbClient(),
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeTtsManifest(),
      assetPlan: makeTtsAssetPlan(),
      registry: createAssetProviderRegistry([
        createDashscopeTtsProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "qwen3-tts-instruct-flash",
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    const submitCall = fetchCalls.find((call) =>
      call.url.includes("/api/v1/services/aigc/multimodal-generation/generation"),
    );
    expect(submitCall?.init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "X-DashScope-Async": "disable",
    });

    const chunkArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_chunk_audio",
    );
    const mergedArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_merged_audio",
    );

    expect(chunkArtifact?.metadata).toMatchObject({
      voice_profile_id: "Cherry",
      tts_chunk_id: "chunk_001",
      segment_ids: ["sb_001"],
    });
    expect(mergedArtifact?.metadata).toMatchObject({
      voice_profile_id: "Cherry",
      chunk_artifact_ids: [chunkArtifact?.artifact_id],
    });
    await expect(stat(chunkArtifact!.file_uri)).resolves.toBeTruthy();
    await expect(stat(mergedArtifact!.file_uri)).resolves.toBeTruthy();
  });

  it("records probed WAV duration metadata for chunk and merged artifacts", async () => {
    tempDir = join(tmpdir(), `dashscope-tts-duration-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const assetPlan = makeTtsAssetPlan();
    assetPlan.tts_plan.estimated_total_duration_sec = 4;
    assetPlan.tts_plan.chunks[0]!.estimated_duration_sec = 4;
    const wavBuffer = makeWavBuffer({
      durationSec: 1.5,
      sampleRate: 24000,
    });

    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/v1/services/aigc/multimodal-generation/generation")) {
        return new Response(
          JSON.stringify({
            output: { audio: { url: "https://download.test/chunk.wav" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(wavBuffer, { status: 200 });
    });

    const result = await executeAssetManifest({
      db: createDbClient(),
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeTtsManifest(),
      assetPlan,
      registry: createAssetProviderRegistry([
        createDashscopeTtsProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "qwen3-tts-instruct-flash",
          format: "wav",
          sampleRate: 24000,
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    const chunkArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_chunk_audio",
    );
    const mergedArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_merged_audio",
    );

    expect(chunkArtifact?.metadata).toMatchObject({
      duration_sec: 1.5,
      estimated_duration_sec: 4,
      duration_source: "audio_probe",
      timing_source: "audio_probe",
    });
    expect(mergedArtifact?.metadata).toMatchObject({
      duration_sec: 1.5,
      estimated_duration_sec: 4,
      duration_source: "audio_probe",
      timing_source: "audio_probe",
    });
  });

  it("falls back to estimated duration when downloaded audio cannot be probed", async () => {
    tempDir = join(tmpdir(), `dashscope-tts-duration-fallback-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const assetPlan = makeTtsAssetPlan();
    assetPlan.tts_plan.estimated_total_duration_sec = 4;
    assetPlan.tts_plan.chunks[0]!.estimated_duration_sec = 4;

    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/api/v1/services/aigc/multimodal-generation/generation")) {
        return new Response(
          JSON.stringify({
            output: { audio: { url: "https://download.test/chunk.mp3" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(Buffer.from("not-probeable-audio"), { status: 200 });
    });

    const result = await executeAssetManifest({
      db: createDbClient(),
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeTtsManifest(),
      assetPlan,
      registry: createAssetProviderRegistry([
        createDashscopeTtsProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "qwen3-tts-instruct-flash",
          format: "mp3",
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    const chunkArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_chunk_audio",
    );

    expect(chunkArtifact?.metadata).toMatchObject({
      duration_sec: 4,
      estimated_duration_sec: 4,
      duration_source: "estimated",
      timing_source: "estimated",
      duration_probe_error: "audio_duration_probe_unavailable",
    });
  });

  it("creates missing provider voice before TTS and keeps local voice metadata", async () => {
    tempDir = join(tmpdir(), `dashscope-designed-tts-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const db = createDbClient();
    await seedGlobalVoiceProfiles(db);

    const manifest = makeTtsManifest();
    manifest.execution_options.voice_profile_id = "voice_preset_cold_authority";
    manifest.audio_summary.voice_profile_id = "voice_preset_cold_authority";

    const assetPlan = makeTtsAssetPlan();
    assetPlan.tts_plan.voice_profile_id = "voice_preset_cold_authority";

    let ttsPayload: Record<string, any> | null = null;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/services/audio/tts/customization")) {
        return new Response(
          JSON.stringify({
            output: {
              voice: "voice-provider-001",
              preview_audio: {
                data: Buffer.from("preview").toString("base64"),
                sample_rate: 24000,
                response_format: "wav",
              },
            },
            request_id: "req_voice_001",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url.includes("/api/v1/services/aigc/multimodal-generation/generation")) {
        ttsPayload = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            output: { audio: { url: "https://download.test/chunk.wav" } },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
    });

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest,
      assetPlan,
      registry: createAssetProviderRegistry([
        createDashscopeTtsProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "qwen3-tts-vd-2026-01-26",
          db,
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    expect(ttsPayload?.input.voice).toBe("voice-provider-001");
    expect(result.manifest.audio_summary.voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );

    const chunkArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_chunk_audio",
    );
    const mergedArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "tts_merged_audio",
    );

    expect(chunkArtifact?.metadata).toMatchObject({
      voice_profile_id: "voice_preset_cold_authority",
      provider_voice_id: "voice-provider-001",
      voice_profile_match_score: null,
      voice_profile_match_reasons: [],
      sample_rate: 24000,
      format: "wav",
      timing_source: "estimated",
    });
    expect(mergedArtifact?.metadata).toMatchObject({
      voice_profile_id: "voice_preset_cold_authority",
      provider_voice_id: "voice-provider-001",
      voice_profile_match_score: null,
      voice_profile_match_reasons: [],
      sample_rate: 24000,
      format: "wav",
      timing_source: "estimated",
    });

    const profile = db.voiceProfiles.get("voice_preset_cold_authority");
    expect(profile?.provider_status).toBe("ready");
    expect(profile?.provider_voice_id).toBe("voice-provider-001");
  });
});
