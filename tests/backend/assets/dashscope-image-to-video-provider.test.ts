import {
  existsSync,
  mkdirSync,
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
});
