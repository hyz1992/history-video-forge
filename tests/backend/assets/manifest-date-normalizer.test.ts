import { describe, expect, it } from "vitest";

import { normalizeAssetManifestDates } from "../../../backend/src/modules/assets/manifest-date-normalizer.js";
import { AssetManifest } from "../../../shared/src/index.js";

describe("normalizeAssetManifestDates", () => {
  it("normalizes legacy generated artifact origins to provider", () => {
    const normalized = normalizeAssetManifestDates({
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
      executions: [],
      artifacts: [
        {
          artifact_id: "cover_001",
          artifact_type: "image",
          origin: "generated",
          file_uri: "memory://cover.png",
          created_at: new Date("2026-06-18T00:00:00.000Z"),
          metadata: {
            width: 1080,
            height: 1920,
          },
        },
      ],
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
      segment_routes: [],
      readiness: "partial",
      notes: [],
    });

    const parsed = AssetManifest.parse(normalized);

    expect(parsed.artifacts[0]?.origin).toBe("provider");
    expect(parsed.artifacts[0]?.created_at).toBe("2026-06-18T00:00:00.000Z");
  });
});
