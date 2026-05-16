import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createFakeTtsProvider } from "../../../backend/src/modules/assets/providers/fake-tts-provider.js";
import { createLocalSubtitleProvider } from "../../../backend/src/modules/assets/providers/local-subtitle-provider.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeTtsAndSubtitleManifest(): AssetManifest {
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
      {
        execution_id: "exec_sub_001",
        task_id: "sub_001",
        task_type: "subtitle_track",
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

function makeTtsAndSubtitleAssetPlan(): AssetPlan {
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
      {
        task_id: "sub_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: "字幕生成",
        production_intent: "字幕轨道生成",
        recommended_mode: "auto",
        provider_hint: "local_subtitle",
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
      total_tasks: 2,
      by_type: { tts_audio: 1, subtitle_track: 1 },
      by_cost_tier: { free: 2 },
      estimated_provider_calls: 2,
      notes: [],
    },
    global_production_notes: [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("local subtitle provider (via execution engine)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "svf-local-sub-"));
    await mkdir(join(root, "assets-runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("produces SRT and VTT subtitle artifacts after TTS runs", async () => {
    const db = createDbClient();

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeTtsAndSubtitleManifest(),
      assetPlan: makeTtsAndSubtitleAssetPlan(),
      registry: createAssetProviderRegistry([
        createFakeTtsProvider(),
        createLocalSubtitleProvider(),
      ]),
      projectStorageRootDir: root,
    });

    // 2 TTS chunk artifacts exist
    const chunkArtifacts = result.manifest.artifacts.filter(
      (item) => item.artifact_type === "tts_chunk_audio",
    );
    expect(chunkArtifacts).toHaveLength(2);

    // 2 subtitle artifacts (SRT + VTT)
    const subtitleArtifacts = result.manifest.artifacts.filter(
      (item) => item.artifact_type === "subtitle_track",
    );
    expect(subtitleArtifacts).toHaveLength(2);

    // SRT artifact
    const srtArtifact = subtitleArtifacts.find(
      (a) => (a.metadata as Record<string, unknown>).format === "srt",
    );
    expect(srtArtifact).toBeTruthy();
    expect((srtArtifact!.metadata as Record<string, unknown>).format).toBe("srt");

    // VTT artifact
    const vttArtifact = subtitleArtifacts.find(
      (a) => (a.metadata as Record<string, unknown>).format === "vtt",
    );
    expect(vttArtifact).toBeTruthy();
    expect((vttArtifact!.metadata as Record<string, unknown>).format).toBe("vtt");

    // audio_summary.subtitle_artifact_id points to the SRT artifact
    expect(result.manifest.audio_summary.subtitle_artifact_id).toBe(
      srtArtifact!.artifact_id,
    );

    // Every segment route has subtitle_artifact_id set
    expect(
      result.manifest.segment_routes.every(
        (route) => route.subtitle_artifact_id !== null,
      ),
    ).toBe(true);

    // subtitle_track execution's output_artifact_ids contains both
    const subtitleExecution = result.manifest.executions.find(
      (item) => item.task_type === "subtitle_track",
    );
    expect(subtitleExecution?.output_artifact_ids).toHaveLength(2);
    expect(subtitleExecution?.output_artifact_ids).toContain(srtArtifact!.artifact_id);
    expect(subtitleExecution?.output_artifact_ids).toContain(vttArtifact!.artifact_id);

    // Subtitle files exist on disk
    expect(await stat(srtArtifact!.file_uri)).toBeTruthy();
    expect(await stat(vttArtifact!.file_uri)).toBeTruthy();
  });
});
