import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createFakeImageProvider } from "../../../backend/src/modules/assets/providers/fake-image-provider.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

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
        task_id: "img_001",
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
      era_style: "春秋战国",
      visual_tone: "冷峻",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "中国古代历史短视频",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 2,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "画面输入",
        production_intent: "生成分镜主图",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "古代宫殿中景",
        parameters: {},
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png"],
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("fake image provider (via execution engine)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "svf-fake-img-"));
    await mkdir(join(root, "assets-runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("produces an image artifact and updates segment route", async () => {
    const db = createDbClient();

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeImageManifest(),
      assetPlan: makeImageAssetPlan(),
      registry: createAssetProviderRegistry([createFakeImageProvider()]),
      projectStorageRootDir: root,
    });

    const imageArtifact = result.manifest.artifacts.find(
      (item) => item.artifact_type === "image",
    );

    expect(imageArtifact).toMatchObject({
      artifact_id: "artifact_img_img_001",
      artifact_type: "image",
      metadata: {
        width: 1080,
        height: 1920,
      },
    });
    expect(imageArtifact?.metadata).toHaveProperty("file_hash");
    expect(await stat(imageArtifact!.file_uri)).toBeTruthy();

    expect(result.manifest.segment_routes[0]).toMatchObject({
      primary_visual_artifact_id: "artifact_img_img_001",
      visual_route_type: "image_only",
      readiness: "ready",
    });
  });
});
