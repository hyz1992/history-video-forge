import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createFakeTtsProvider } from "../../../backend/src/modules/assets/providers/fake-tts-provider.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeTtsManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["tts"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_tts_001",
        task_id: "tts_001",
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
      voice_profile_id: "voice_001",
      tts_total_duration_sec: null,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [
        {
          tts_chunk_id: "chunk_001",
          artifact_id: null,
          segment_ids: ["sb_001"],
          script_excerpt: "秦始皇统一六国",
        },
        {
          tts_chunk_id: "chunk_002",
          artifact_id: null,
          segment_ids: ["sb_002"],
          script_excerpt: "建立了中国第一个中央集权国家",
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
        visual_route_type: "image_only",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "blocked",
        notes: [],
      },
      {
        segment_id: "sb_002",
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

function makeTtsAssetPlan(): AssetPlan {
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
      estimated_total_duration_sec: 5.5,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "chunk_001",
          order: 0,
          script_excerpt: "秦始皇统一六国",
          estimated_duration_sec: 2.5,
        },
        {
          chunk_id: "chunk_002",
          order: 1,
          script_excerpt: "建立了中国第一个中央集权国家",
          estimated_duration_sec: 3.0,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "旁白全文",
        production_intent: "TTS音频生成",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { tts_audio: 1 },
      by_cost_tier: { free: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("fake TTS provider (via execution engine)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "svf-fake-tts-"));
    await mkdir(join(root, "assets-runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("produces TTS chunk and merged audio artifacts and updates routes", async () => {
    const db = createDbClient();

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeTtsManifest(),
      assetPlan: makeTtsAssetPlan(),
      registry: createAssetProviderRegistry([createFakeTtsProvider()]),
      projectStorageRootDir: root,
    });

    // 2 chunk audio artifacts
    const chunkArtifacts = result.manifest.artifacts.filter(
      (item) => item.artifact_type === "tts_chunk_audio",
    );
    expect(chunkArtifacts).toHaveLength(2);

    // 1 merged audio artifact
    const mergedArtifacts = result.manifest.artifacts.filter(
      (item) => item.artifact_type === "tts_merged_audio",
    );
    expect(mergedArtifacts).toHaveLength(1);

    // NO subtitle artifacts
    const subtitleArtifacts = result.manifest.artifacts.filter(
      (item) => item.artifact_type === "subtitle_track",
    );
    expect(subtitleArtifacts).toHaveLength(0);

    // audio_summary updated
    expect(result.manifest.audio_summary.tts_chunk_artifact_ids).toHaveLength(2);
    expect(result.manifest.audio_summary.tts_merged_artifact_id).toBeTruthy();
    expect(result.manifest.audio_summary.subtitle_artifact_id).toBeNull();

    // Each chunk metadata has correct duration
    const chunk1 = chunkArtifacts.find(
      (a) => (a.metadata as Record<string, unknown>).tts_chunk_id === "chunk_001",
    );
    const chunk2 = chunkArtifacts.find(
      (a) => (a.metadata as Record<string, unknown>).tts_chunk_id === "chunk_002",
    );
    expect(chunk1).toBeTruthy();
    expect(chunk2).toBeTruthy();
    expect((chunk1!.metadata as Record<string, unknown>).duration_sec).toBe(2.5);
    expect((chunk2!.metadata as Record<string, unknown>).duration_sec).toBe(3.0);

    // Merged duration = sum of chunks
    expect((mergedArtifacts[0].metadata as Record<string, unknown>).duration_sec).toBe(5.5);
    expect(mergedArtifacts[0]!.file_uri.endsWith(".wav")).toBe(true);
    expect(mergedArtifacts[0]!.metadata).toMatchObject({
      format: "wav",
      duration_source: "estimated",
      timing_source: "estimated",
    });

    const mergedBytes = await readFile(mergedArtifacts[0]!.file_uri);
    expect(mergedBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(mergedBytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(maxPcm16(mergedBytes)).toBeGreaterThan(0);

    for (const chunk of chunkArtifacts) {
      expect(chunk.file_uri.endsWith(".wav")).toBe(true);
      const chunkBytes = await readFile(chunk.file_uri);
      expect(maxPcm16(chunkBytes)).toBeGreaterThan(0);
      expect(chunk.metadata).toMatchObject({
        format: "wav",
        duration_source: "estimated",
        timing_source: "estimated",
      });
    }

    // tts_chunk_routes updated with artifact_ids
    const route1 = result.manifest.audio_summary.tts_chunk_routes.find(
      (r) => r.tts_chunk_id === "chunk_001",
    );
    const route2 = result.manifest.audio_summary.tts_chunk_routes.find(
      (r) => r.tts_chunk_id === "chunk_002",
    );
    expect(route1?.artifact_id).toBeTruthy();
    expect(route2?.artifact_id).toBeTruthy();

    // Segment routes updated with tts_artifact_id
    const segRoute1 = result.manifest.segment_routes.find(
      (r) => r.segment_id === "sb_001",
    );
    const segRoute2 = result.manifest.segment_routes.find(
      (r) => r.segment_id === "sb_002",
    );
    expect(segRoute1?.tts_artifact_id).toBeTruthy();
    expect(segRoute2?.tts_artifact_id).toBeTruthy();

    // audio_summary tts_total_duration_sec set
    expect(result.manifest.audio_summary.tts_total_duration_sec).toBe(5.5);

    // Audio files exist on disk
    for (const chunk of chunkArtifacts) {
      expect(await stat(chunk.file_uri)).toBeTruthy();
    }
    expect(await stat(mergedArtifacts[0].file_uri)).toBeTruthy();
  });
});

function maxPcm16(wav: Buffer): number {
  let max = 0;
  for (let offset = 44; offset + 1 < wav.length; offset += 2) {
    max = Math.max(max, Math.abs(wav.readInt16LE(offset)));
  }
  return max;
}
