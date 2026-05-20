import type { DbClient } from "../../../db/client.js";
import type { AssetProviderAdapter } from "../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../assets-file-storage.js";
import { readSfxCueParams } from "../audio-cue-params.js";
import { selectMediaLibraryItem } from "../media-library-selector.js";
import { createSilentWavBuffer } from "./audio-fixture.js";

export function createLocalSfxProvider(db: DbClient): AssetProviderAdapter {
  return {
    providerName: "local_sfx",
    providerType: "sfx",
    canHandle: ({ taskType }) => taskType === "sfx_cue",

    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: { task_id: ctx.execution.task_id },
    }),

    submit: async (_ctx, prepared) => ({
      providerJobId: null,
      rawResponseJson: prepared.rawRequestJson,
    }),

    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),

    download: async () => [],

    normalizeResult: async ({ ctx }) => {
      const params = readSfxCueParams(ctx.planTask.parameters);
      if (!ctx.planTask.source_segment_id) {
        return {
          artifacts: [],
          notes: ["local_sfx_missing_segment_optional"],
        };
      }
      if (params.requiredTags.length === 0 && !params.libraryItemId) {
        return {
          artifacts: [],
          notes: ["local_sfx_missing_tags_optional"],
        };
      }

      const selected = await selectMediaLibraryItem(db, {
        type: "sfx",
        libraryItemId: params.libraryItemId,
        requiredTags: params.requiredTags,
        moodTags: params.moodTags,
      });

      if (!selected) {
        return {
          artifacts: [],
          notes: ["local_sfx_missing_optional"],
        };
      }

      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const written = await writeAssetFile({
        storage,
        category: "audio/sfx",
        fileName: `sfx_${ctx.execution.task_id}.wav`,
        data: createSilentWavBuffer({ durationSec: selected.duration_sec }),
      });

      return {
        artifacts: [
          {
            artifact_id: `artifact_sfx_${ctx.execution.task_id}`,
            artifact_type: "sfx_audio",
            origin: "library",
            file_uri: written.fileUri,
            created_at: new Date().toISOString(),
            metadata: {
              duration_sec: selected.duration_sec,
              library_item_id: selected.library_item_id,
              selection_label: params.selectionLabel ?? selected.library_item_id,
              license_type: selected.license.license_type,
              attribution_required: selected.license.attribution_required,
              attribution_text: selected.license.attribution_text,
              required_tags: params.requiredTags,
              matched_mood_tags: params.moodTags.filter((tag) =>
                selected.mood_tags.includes(tag),
              ),
              source_segment_id: ctx.planTask.source_segment_id,
              source_materialized_from: "generated_fixture",
            },
          },
        ],
        notes: ["local SFX audio generated"],
      };
    },

    cancel: async () => {},
  };
}
