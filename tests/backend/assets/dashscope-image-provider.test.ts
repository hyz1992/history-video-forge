/**
 * DashScope image provider payload builder shell tests.
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
  buildDashscopeImagePayload,
  createDashscopeImageProvider,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-provider.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

describe("dashscope image payload builder", () => {
  it("wan2.6 payload contains prompt text in messages format", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "古代宫殿中景",
      negativePrompt: "现代建筑",
      size: "1080*1920",
    });

    const json = JSON.stringify(payload);
    expect(json).toContain("古代宫殿中景");
    expect(json).toContain("现代建筑");

    // wan2.6 uses messages array
    expect(payload.input.messages).toBeDefined();
    expect(payload.input.messages![0].content[0].text).toBe("古代宫殿中景");
    expect(payload.parameters.negative_prompt).toBe("现代建筑");
  });

  it("negative prompt is passed only when present", () => {
    const withoutNeg = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test prompt",
    });

    expect(withoutNeg.parameters.negative_prompt).toBe("");

    const withNeg = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test prompt",
      negativePrompt: "low quality",
    });

    expect(withNeg.parameters.negative_prompt).toBe("low quality");
  });

  it("wanx (non-wan2.6) uses legacy prompt format with default negative", () => {
    const payload = buildDashscopeImagePayload({
      model: "wanx-v1",
      prompt: "战国宫门",
    });

    expect(payload.input.prompt).toBe("战国宫门");
    expect(payload.input.messages).toBeUndefined();
    expect((payload as { input: { negative_prompt: string } }).input.negative_prompt).toContain("低质量");
  });

  it("size normalizes x separator to *", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test",
      size: "1920x1080",
    });

    expect(payload.parameters.size).toBe("1920*1080");
  });

  it("sets default size to 1080*1920 when not provided", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test",
    });

    expect(payload.parameters.size).toBe("1080*1920");
  });
});

function makeImageManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["image"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_img_001",
        task_id: "task_img_001",
        task_type: "image_still",
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
      voice_profile_id: "voice_001",
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
        visual_route_type: "image_only",
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

function makeImageAssetPlan(): AssetPlan {
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
      global_negative_prompts: ["no text"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 1,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "task_img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "palace gate",
        production_intent: "generate one image",
        recommended_mode: "auto",
        provider_hint: "dashscope_image",
        prompt_draft: "ancient palace gate at night",
        parameters: { size: "720*1280", negative_prompt: "modern buildings" },
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
      by_type: { image_still: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

describe("dashscope image provider adapter", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("submits async image task, polls, downloads, and writes image artifact", async () => {
    tempDir = join(tmpdir(), `dashscope-image-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url.includes("/api/v1/services/aigc/image-generation/generation")) {
        return new Response(
          JSON.stringify({ output: { task_id: "task_001" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/tasks/task_001")) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: "https://download.test/image.png" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
        status: 200,
      });
    });

    const result = await executeAssetManifest({
      db: createDbClient(),
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeImageManifest(),
      assetPlan: makeImageAssetPlan(),
      registry: createAssetProviderRegistry([
        createDashscopeImageProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "wan2.6-t2i",
          pollIntervalMs: 0,
          maxPollAttempts: 1,
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    const submitCall = fetchCalls.find((call) =>
      call.url.includes("/api/v1/services/aigc/image-generation/generation"),
    );
    expect(submitCall?.init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "X-DashScope-Async": "enable",
    });

    const imageArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "image",
    );
    expect(imageArtifact?.metadata).toMatchObject({
      width: 720,
      height: 1280,
      model: "wan2.6-t2i",
      provider_name: "dashscope_image",
    });
    expect(result.manifest.segment_routes[0]).toMatchObject({
      primary_visual_artifact_id: imageArtifact?.artifact_id,
      visual_route_type: "image_only",
      readiness: "ready",
    });
    await expect(stat(imageArtifact!.file_uri)).resolves.toBeTruthy();
  });
});
