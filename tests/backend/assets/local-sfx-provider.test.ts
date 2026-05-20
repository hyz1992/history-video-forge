import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import type { AssetProviderContext } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { createLocalSfxProvider } from "../../../backend/src/modules/assets/providers/local-sfx-provider.js";
import type {
  AssetManifest,
  AssetPlan,
  MediaLibraryItem,
} from "../../../shared/src/index.js";

describe("local SFX provider", () => {
  let root: string | null = null;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it("selects an approved library item and returns a renderable sfx_audio artifact", async () => {
    const db = createDbClient();
    root = await mkdtemp(join(tmpdir(), "svf2-local-sfx-"));
    const item: MediaLibraryItem = {
      library_item_id: "sfx_hit_001",
      type: "sfx",
      file_uri: "library://sfx/hit.wav",
      mime_type: "audio/wav",
      duration_sec: 1.2,
      loopable: false,
      tags: ["hit", "court"],
      mood_tags: ["sharp"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
      },
      file_hash: "sha256:sfx001",
      imported_at: "2026-05-20T00:00:00.000Z",
      approved_for_use: true,
    };
    await saveMediaLibraryItem(db, item);

    const provider = createLocalSfxProvider(db);
    const ctx = makeSfxContext({
      projectStorageRootDir: root,
      sourceSegmentId: "seg_1",
      parameters: {
        sfx_tags: ["hit"],
        mood_tags: ["sharp"],
      },
    });

    const result = await provider.normalizeResult({
      ctx,
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts[0]).toMatchObject({
      artifact_id: "artifact_sfx_sfx_001",
      artifact_type: "sfx_audio",
      origin: "library",
      metadata: {
        duration_sec: 1.2,
        library_item_id: "sfx_hit_001",
        source_segment_id: "seg_1",
        license_type: "cc0",
        attribution_required: false,
        required_tags: ["hit"],
        matched_mood_tags: ["sharp"],
        source_materialized_from: "generated_fixture",
      },
    });
    expect(result.artifacts[0]?.file_uri).toContain(root);

    const bytes = await readFile(result.artifacts[0]!.file_uri);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(readAudioDurationSec({ data: bytes })).toBeCloseTo(1.2, 2);
  });

  it("returns no artifacts when the SFX cue has no source segment", async () => {
    const db = createDbClient();
    root = await mkdtemp(join(tmpdir(), "svf2-local-sfx-"));
    const provider = createLocalSfxProvider(db);

    const result = await provider.normalizeResult({
      ctx: makeSfxContext({
        projectStorageRootDir: root,
        sourceSegmentId: null,
        parameters: { sfx_tags: ["hit"] },
      }),
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts).toEqual([]);
    expect(result.notes).toContain("local_sfx_missing_segment_optional");
  });

  it("returns no artifacts when the SFX cue has no structured tags", async () => {
    const db = createDbClient();
    root = await mkdtemp(join(tmpdir(), "svf2-local-sfx-"));
    const provider = createLocalSfxProvider(db);

    const result = await provider.normalizeResult({
      ctx: makeSfxContext({
        projectStorageRootDir: root,
        sourceSegmentId: "seg_1",
        parameters: { mood_tags: ["sharp"] },
      }),
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts).toEqual([]);
    expect(result.notes).toContain("local_sfx_missing_tags_optional");
  });
});

function makeSfxContext(input: {
  projectStorageRootDir: string;
  sourceSegmentId: string | null;
  parameters: Record<string, unknown>;
}): AssetProviderContext {
  const assetPlan = makeMinimalAssetPlanWithSfxTask({
    sourceSegmentId: input.sourceSegmentId,
    parameters: input.parameters,
  });
  return {
    manifest: makeMinimalManifestWithSegment(input.sourceSegmentId ?? "seg_1"),
    assetPlan,
    execution: {
      execution_id: "exec_sfx_001",
      task_id: "sfx_001",
      task_type: "sfx_cue",
      status: "planned",
      origin: "provider",
      started_at: null,
      completed_at: null,
      provider_id: null,
      attempts: 0,
      output_artifact_ids: [],
      notes: [],
    },
    planTask: assetPlan.tasks[0]!,
    assetManifestRecordId: "manifest_001",
    assetRunId: "assets_run_sfx",
    projectStorageRootDir: input.projectStorageRootDir,
  };
}

function makeMinimalManifestWithSegment(segmentId: string): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_test",
      enabled_provider_types: ["tts", "image", "video", "sfx", "bgm"],
      allow_manual_placeholders: false,
    },
    executions: [],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "voice_test",
      tts_total_duration_sec: 8,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: segmentId,
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
    readiness: "partial",
    notes: [],
  };
}

function makeMinimalAssetPlanWithSfxTask(input: {
  sourceSegmentId: string | null;
  parameters: Record<string, unknown>;
}): AssetPlan {
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
      global_prompt_prefix: "",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_test",
      estimated_total_duration_sec: 8,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "sfx_001",
        order: 0,
        task_type: "sfx_cue",
        source_segment_id: input.sourceSegmentId,
        source_excerpt: "sharp hit",
        production_intent: "select sound effect",
        recommended_mode: "auto",
        provider_hint: "local_sfx",
        prompt_draft: null,
        parameters: input.parameters,
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
      by_type: { sfx_cue: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}
