import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildDashscopeImageToVideoPayload,
  clampDashscopeImageToVideoDuration,
  createDashscopeImageToVideoProvider,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.js";
import type { AssetProviderContext } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

let tempDir = "";

afterEach(() => {
  vi.unstubAllGlobals();
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

function makeVideoProviderContextWithImageArtifact(
  projectStorageRootDir: string,
): AssetProviderContext {
  const imagePath = join(projectStorageRootDir, "source-frame.png");
  mkdirSync(projectStorageRootDir, { recursive: true });
  writeFileSync(imagePath, new Uint8Array([137, 80, 78, 71]));

  const assetPlan: AssetPlan = {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "ancient court",
      visual_tone: "tense",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "historical short video",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_plan",
      estimated_total_duration_sec: 5,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "task_video_001",
        order: 0,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "A tense historical close-up.",
        production_intent: "Generate video from first frame.",
        recommended_mode: "auto",
        provider_hint: "dashscope_image_to_video",
        prompt_draft: "A tense historical close-up, slow push-in.",
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "high",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { video_clip: 1 },
      by_cost_tier: { high: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
  const planTask = assetPlan.tasks[0]!;

  const manifest: AssetManifest = {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: null,
      enabled_provider_types: ["video"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_video_001",
        task_id: "task_video_001",
        task_type: "video_clip",
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
    artifacts: [
      {
        artifact_id: "artifact_img_001",
        artifact_type: "image",
        origin: "provider",
        file_uri: imagePath,
        created_at: "2026-05-19T00:00:00.000Z",
        metadata: {
          width: 720,
          height: 1280,
        },
      },
    ],
    audio_summary: {
      voice_profile_id: "voice_plan",
      tts_total_duration_sec: null,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
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
        visual_route_type: "image_with_motion",
        motion_artifact_id: "artifact_motion_001",
        fallback_visual_artifact_id: "artifact_img_001",
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "fallback_ready",
        notes: [],
      },
    ],
    readiness: "partial",
    notes: [],
  };

  return {
    manifest,
    assetPlan,
    execution: manifest.executions[0]!,
    planTask,
    assetManifestRecordId: "asset_manifest_001",
    assetRunId: "asset_run_001",
    projectStorageRootDir,
  };
}

describe("DashScope image-to-video provider payload", () => {
  it("builds a Wan first-frame image-to-video payload", () => {
    const payload = buildDashscopeImageToVideoPayload({
      model: "wan2.7-i2v-2026-04-25",
      prompt: "A tense historical close-up, slow push-in.",
      sourceImageUrl: "data:image/png;base64,abc",
      resolution: "720P",
      durationSec: 5,
      promptExtend: true,
      watermark: false,
    });

    expect(payload).toEqual({
      model: "wan2.7-i2v-2026-04-25",
      input: {
        prompt: "A tense historical close-up, slow push-in.",
        media: [{ type: "first_frame", url: "data:image/png;base64,abc" }],
      },
      parameters: {
        resolution: "720P",
        duration: 5,
        prompt_extend: true,
        watermark: false,
      },
    });
  });

  it("clamps duration to the provider supported range", () => {
    expect(clampDashscopeImageToVideoDuration(1)).toBe(2);
    expect(clampDashscopeImageToVideoDuration(5)).toBe(5);
    expect(clampDashscopeImageToVideoDuration(30)).toBe(15);
  });

  it("builds a wan2.6-i2v-flash payload with img_url and explicit audio=true", () => {
    const payload = buildDashscopeImageToVideoPayload({
      model: "wan2.6-i2v-flash",
      prompt: "A tense historical close-up, slow push-in.",
      sourceImageUrl: "data:image/png;base64,abc",
      resolution: "720P",
      durationSec: 5,
      promptExtend: true,
      watermark: false,
    });

    expect(payload).toEqual({
      model: "wan2.6-i2v-flash",
      input: {
        prompt: "A tense historical close-up, slow push-in.",
        img_url: "data:image/png;base64,abc",
      },
      parameters: {
        resolution: "720P",
        duration: 5,
        prompt_extend: true,
        watermark: false,
        audio: true,
      },
    });
  });

  it("submits, polls, downloads, and normalizes a video artifact", async () => {
    tempDir = join(tmpdir(), `dashscope-i2v-provider-${Date.now()}`);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      calls.push(urlText);

      if (urlText.endsWith("/video-synthesis")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("X-DashScope-Async")).toBe("enable");
        return new Response(JSON.stringify({
          output: { task_id: "task_i2v_001" },
        }), { status: 200 });
      }

      if (urlText.endsWith("/api/v1/tasks/task_i2v_001")) {
        return new Response(JSON.stringify({
          output: {
            task_id: "task_i2v_001",
            task_status: "SUCCEEDED",
            video_url: "https://dashscope-result.test/video.mp4",
          },
          usage: {
            output_video_duration: 5,
            SR: 720,
          },
        }), { status: 200 });
      }

      if (urlText === "https://dashscope-result.test/video.mp4") {
        return new Response("fake mp4", { status: 200 });
      }

      return new Response("unexpected", { status: 500 });
    }));

    const adapter = createDashscopeImageToVideoProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      model: "wan2.7-i2v-2026-04-25",
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    const ctx = makeVideoProviderContextWithImageArtifact(tempDir);
    const prepared = await adapter.prepare(ctx);
    const sourceUrl = ((prepared.rawRequestJson.payload as {
      input: { media: Array<{ url: string }> };
    }).input.media[0]?.url);
    expect(sourceUrl).toMatch(/^data:image\/png;base64,/);

    const submitted = await adapter.submit(ctx, prepared);
    const polled = await adapter.poll(ctx, submitted);
    const downloaded = await adapter.download(ctx, polled);
    const normalized = await adapter.normalizeResult({
      ctx,
      downloadedArtifacts: downloaded,
      rawResponseJson: polled.rawResponseJson,
    });

    expect(normalized.artifacts[0]).toMatchObject({
      artifact_type: "video",
      origin: "provider",
      metadata: {
        provider_name: "dashscope_image_to_video",
        provider_job_id: "task_i2v_001",
        source_image_artifact_id: "artifact_img_001",
        model: "wan2.7-i2v-2026-04-25",
      },
    });
    expect(normalized.notes).toContain("dashscope image-to-video generated");
    expect(calls.some((url) => url.includes("/video-synthesis"))).toBe(true);
    expect(existsSync(normalized.artifacts[0]!.file_uri)).toBe(true);
  });

  it("拆分超过 15 秒的显式时长：25 秒 → 2 段各 13 秒，artifact 带 split 元数据且首段 index 0", async () => {
    tempDir = join(tmpdir(), `dashscope-i2v-split-${Date.now()}`);
    let taskSeq = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const urlText = String(url);

      if (urlText.endsWith("/video-synthesis")) {
        return new Response(JSON.stringify({
          output: { task_id: `task_i2v_split_${++taskSeq}` },
        }), { status: 200 });
      }

      const taskMatch = urlText.match(/\/api\/v1\/tasks\/(task_i2v_split_\d+)$/);
      if (taskMatch) {
        return new Response(JSON.stringify({
          output: {
            task_id: taskMatch[1],
            task_status: "SUCCEEDED",
            video_url: `https://dashscope-result.test/${taskMatch[1]}.mp4`,
          },
        }), { status: 200 });
      }

      if (urlText.startsWith("https://dashscope-result.test/")) {
        // 两段内容互异：验证独立落盘（审查 P1——此前固定文件名互相覆盖）
        return new Response(`fake mp4 ${urlText.split("/").pop()}`, { status: 200 });
      }

      return new Response("unexpected", { status: 500 });
    }));

    const adapter = createDashscopeImageToVideoProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      model: "wan2.7-i2v-2026-04-25",
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    const ctx = makeVideoProviderContextWithImageArtifact(tempDir);
    ctx.planTask.parameters = { duration_sec: 25, resolution: "1080P" };
    const prepared = await adapter.prepare(ctx);
    const requestMeta = prepared.rawRequestJson as {
      split_total?: number;
      split_index?: number;
      duration_sec?: number;
    };
    expect(requestMeta.split_total).toBe(2);
    expect(requestMeta.split_index).toBe(0);
    expect(requestMeta.duration_sec).toBe(13);
    const payloadParams = (prepared.rawRequestJson.payload as {
      parameters: { duration: number; resolution: string };
    }).parameters;
    expect(payloadParams.duration).toBe(13);
    expect(payloadParams.resolution).toBe("1080P");

    const submitted = await adapter.submit(ctx, prepared);
    const polled = await adapter.poll(ctx, submitted);
    expect(polled.status).toBe("completed");
    const downloaded = await adapter.download(ctx, polled);
    expect(downloaded).toHaveLength(2);
    const splitMetaList = downloaded.map((a) => {
      const m = a.metadata as Record<string, unknown>;
      return {
        index: m.video_split_index,
        total: m.video_split_total,
        of: m.video_split_of_task,
        duration: m.duration_sec,
      };
    });
    expect(splitMetaList).toEqual([
      { index: 0, total: 2, of: "task_video_001", duration: 13 },
      { index: 1, total: 2, of: "task_video_001", duration: 13 },
    ]);

    // 审查 P1 回归：各段独立落盘——文件名含段序、URI 互异、内容互异、
    // hash 互异，两份文件同时存在且未被覆盖
    const [part0, part1] = downloaded;
    expect(part0.file_uri).not.toBe(part1.file_uri);
    expect(part0.file_uri).toContain("task_video_001_part1.mp4");
    expect(part1.file_uri).toContain("task_video_001_part2.mp4");
    expect(part0.artifact_id).not.toBe(part1.artifact_id);
    expect(existsSync(part0.file_uri)).toBe(true);
    expect(existsSync(part1.file_uri)).toBe(true);
    expect(readFileSync(part0.file_uri, "utf-8")).not.toBe(
      readFileSync(part1.file_uri, "utf-8"),
    );
    const hash0 = (part0.metadata as Record<string, unknown>).file_hash;
    const hash1 = (part1.metadata as Record<string, unknown>).file_hash;
    expect(hash0).toBeTruthy();
    expect(hash1).toBeTruthy();
    expect(hash0).not.toBe(hash1);
  });

  it("不超过 15 秒的显式时长不拆分", async () => {
    tempDir = join(tmpdir(), `dashscope-i2v-nosplit-${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unexpected", { status: 500 })));

    const adapter = createDashscopeImageToVideoProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      model: "wan2.7-i2v-2026-04-25",
    });
    const ctx = makeVideoProviderContextWithImageArtifact(tempDir);
    ctx.planTask.parameters = { duration_sec: 15, resolution: "720P" };
    const prepared = await adapter.prepare(ctx);
    expect(prepared.rawRequestJson.split_total).toBeUndefined();
    const payloadParams = (prepared.rawRequestJson.payload as {
      parameters: { duration: number };
    }).parameters;
    expect(payloadParams.duration).toBe(15);
  });

  it("TTS chunk 带真实探测时长时视频时长以口播为准（覆盖 plan 估计值）", async () => {
    tempDir = join(tmpdir(), `dashscope-i2v-tts-${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unexpected", { status: 500 })));

    const adapter = createDashscopeImageToVideoProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      model: "wan2.7-i2v-2026-04-25",
    });
    const ctx = makeVideoProviderContextWithImageArtifact(tempDir);
    // plan 显式时长是估计值（15s），但该段真实口播只有 6.3s（已探测）
    ctx.planTask.parameters = { duration_sec: 15, resolution: "720P" };
    ctx.manifest.artifacts.push({
      artifact_id: "artifact_tts_chunk_measured",
      artifact_type: "tts_chunk_audio",
      origin: "provider",
      file_uri: "file:///tmp/tts.wav",
      created_at: new Date().toISOString(),
      metadata: { duration_sec: 6.3, duration_source: "audio_probe_proportional" },
    });
    const route = ctx.manifest.segment_routes[0]!;
    route.tts_artifact_id = "artifact_tts_chunk_measured";

    const prepared = await adapter.prepare(ctx);
    const payloadParams = (prepared.rawRequestJson.payload as {
      parameters: { duration: number };
    }).parameters;
    // 视频时长 = ceil(6.3) = 7s，与口播等长，而不是 plan 估计的 15s
    expect(payloadParams.duration).toBe(7);
  });

  it("TTS chunk 为 estimated 估计时长时不覆盖显式视频时长", async () => {
    tempDir = join(tmpdir(), `dashscope-i2v-est-${Date.now()}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unexpected", { status: 500 })));

    const adapter = createDashscopeImageToVideoProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      model: "wan2.7-i2v-2026-04-25",
    });
    const ctx = makeVideoProviderContextWithImageArtifact(tempDir);
    // fake TTS 与 DashScope 探测失败路径写 duration_source: "estimated"（估计占位）
    ctx.planTask.parameters = { duration_sec: 15, resolution: "720P" };
    ctx.manifest.artifacts.push({
      artifact_id: "artifact_tts_chunk_estimated",
      artifact_type: "tts_chunk_audio",
      origin: "provider",
      file_uri: "file:///tmp/tts-estimated.wav",
      created_at: new Date().toISOString(),
      metadata: { duration_sec: 6.3, duration_source: "estimated" },
    });
    const route = ctx.manifest.segment_routes[0]!;
    route.tts_artifact_id = "artifact_tts_chunk_estimated";

    const prepared = await adapter.prepare(ctx);
    const payloadParams = (prepared.rawRequestJson.payload as {
      parameters: { duration: number };
    }).parameters;
    // estimated 不是实测：显式 15s 不被 6.3s 估计值覆盖
    expect(payloadParams.duration).toBe(15);
  });
});
