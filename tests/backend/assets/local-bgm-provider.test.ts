import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import type { AssetProviderContext } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { readAudioDurationSec } from "../../../backend/src/modules/assets/audio-duration-probe.js";
import { createToneWavBuffer } from "../../../backend/src/modules/assets/providers/audio-fixture.js";
import { createLocalBgmProvider } from "../../../backend/src/modules/assets/providers/local-bgm-provider.js";
import type {
  AssetManifest,
  AssetPlan,
  MediaLibraryItem,
} from "../../../shared/src/index.js";

describe("local BGM provider", () => {
  let root: string | null = null;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = null;
    }
  });

  it("selects an approved library item and returns a renderable bgm_audio artifact", async () => {
    const db = createDbClient();
    root = await mkdtemp(join(tmpdir(), "svf2-local-bgm-"));
    const sourcePath = join(root, "source-bgm.wav");
    const sourceBytes = createToneWavBuffer({
      durationSec: 8,
      sampleRate: 16_000,
      frequencyHz: 220,
    });
    await writeFile(sourcePath, sourceBytes);
    const item: MediaLibraryItem = {
      library_item_id: "bgm_background_001",
      type: "bgm",
      file_uri: sourcePath,
      mime_type: "audio/wav",
      duration_sec: 8,
      loopable: true,
      tags: ["background", "ancient"],
      mood_tags: ["tense"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
      },
      file_hash: "sha256:bgm001",
      imported_at: "2026-05-20T00:00:00.000Z",
      approved_for_use: true,
    };
    await saveMediaLibraryItem(db, item);

    const provider = createLocalBgmProvider(db);
    const ctx = makeBgmContext({
      projectStorageRootDir: root,
      parameters: {
        required_tags: ["background"],
        mood_tags: ["tense"],
        selection_label: "tense bed",
      },
    });

    const result = await provider.normalizeResult({
      ctx,
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts[0]).toMatchObject({
      artifact_id: "artifact_bgm_bgm_001",
      artifact_type: "bgm_audio",
      origin: "library",
      metadata: {
        duration_sec: 8,
        loopable: true,
        library_item_id: "bgm_background_001",
        selection_label: "tense bed",
        license_type: "cc0",
        attribution_required: false,
        required_tags: ["background"],
        matched_mood_tags: ["tense"],
        source_materialized_from: "library_file",
      },
    });
    expect(result.artifacts[0]?.file_uri).toContain(root);

    const bytes = await readFile(result.artifacts[0]!.file_uri);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(readAudioDurationSec({ data: bytes })).toBeCloseTo(8, 2);
    expect(maxPcm16(bytes)).toBeGreaterThan(0);
    expect(bytes.equals(sourceBytes)).toBe(true);
  });

  it("returns no artifacts when no approved BGM item matches", async () => {
    const db = createDbClient();
    root = await mkdtemp(join(tmpdir(), "svf2-local-bgm-"));
    const provider = createLocalBgmProvider(db);

    const result = await provider.normalizeResult({
      ctx: makeBgmContext({
        projectStorageRootDir: root,
        parameters: { required_tags: ["missing"] },
      }),
      downloadedArtifacts: [],
      rawResponseJson: null,
    });

    expect(result.artifacts).toEqual([]);
    expect(result.notes).toContain("local_bgm_missing_optional");
  });
});

function makeBgmContext(input: {
  projectStorageRootDir: string;
  parameters: Record<string, unknown>;
}): AssetProviderContext {
  const assetPlan = makeMinimalAssetPlanWithBgmTask(input.parameters);
  return {
    manifest: makeMinimalManifestWithBgmPlacement(),
    assetPlan,
    execution: {
      execution_id: "exec_bgm_001",
      task_id: "bgm_001",
      task_type: "bgm_cue",
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
    assetRunId: "assets_run_bgm",
    projectStorageRootDir: input.projectStorageRootDir,
  };
}

function maxPcm16(wav: Buffer): number {
  let max = 0;
  for (let offset = 44; offset + 1 < wav.length; offset += 2) {
    max = Math.max(max, Math.abs(wav.readInt16LE(offset)));
  }
  return max;
}

function makeMinimalManifestWithBgmPlacement(): AssetManifest {
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
      bgm_placements: [
        {
          bgm_placement_id: "bgm_place_bgm_001",
          source_task_id: "bgm_001",
          scope: "global",
          artifact_id: null,
          start_policy: "timeline_start",
          end_policy: "timeline_end",
          segment_ids: [],
          volume: 0.3,
          fade_in_sec: 0,
          fade_out_sec: 0,
        },
      ],
      sfx_artifact_ids: [],
    },
    segment_routes: [],
    readiness: "partial",
    notes: [],
  };
}

function makeMinimalAssetPlanWithBgmTask(
  parameters: Record<string, unknown>,
): AssetPlan {
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
        task_id: "bgm_001",
        order: 0,
        task_type: "bgm_cue",
        source_segment_id: null,
        source_excerpt: "background music",
        production_intent: "select background music",
        recommended_mode: "auto",
        provider_hint: "local_bgm",
        prompt_draft: null,
        parameters,
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
      by_type: { bgm_cue: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}
