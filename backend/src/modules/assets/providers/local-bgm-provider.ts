import type { DbClient } from "../../../db/client.js";
import type { AssetProviderAdapter } from "../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../assets-file-storage.js";
import { readBgmCueParams } from "../audio-cue-params.js";
import { selectMediaLibraryItem } from "../media-library-selector.js";
import { createSilentWavBuffer } from "./audio-fixture.js";

export function createLocalBgmProvider(db: DbClient): AssetProviderAdapter {
  return {
    providerName: "local_bgm",
    providerType: "bgm",
    canHandle: ({ taskType }) => taskType === "bgm_cue",

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
      const params = readBgmCueParams(ctx.planTask.parameters);
      const selected = await selectMediaLibraryItem(db, {
        type: "bgm",
        libraryItemId: params.libraryItemId,
        requiredTags: params.requiredTags,
        moodTags: params.moodTags,
      });

      if (!selected) {
        return {
          artifacts: [],
          notes: ["local_bgm_missing_optional"],
        };
      }

      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });
      const written = await writeAssetFile({
        storage,
        category: "audio/bgm",
        fileName: `bgm_${ctx.execution.task_id}.wav`,
        data: createSilentWavBuffer({ durationSec: selected.duration_sec }),
      });

      return {
        artifacts: [
          {
            artifact_id: `artifact_bgm_${ctx.execution.task_id}`,
            artifact_type: "bgm_audio",
            origin: "library",
            file_uri: written.fileUri,
            created_at: new Date().toISOString(),
            metadata: {
              duration_sec: selected.duration_sec,
              loopable: selected.loopable,
              library_item_id: selected.library_item_id,
              selection_label: params.selectionLabel ?? selected.library_item_id,
              license_type: selected.license.license_type,
              attribution_required: selected.license.attribution_required,
              attribution_text: selected.license.attribution_text,
              required_tags: params.requiredTags,
              matched_mood_tags: params.moodTags.filter((tag) =>
                selected.mood_tags.includes(tag),
              ),
              source_materialized_from: "generated_fixture",
            },
          },
        ],
        notes: ["local BGM audio generated"],
      };
    },

    cancel: async () => {},
  };
}
