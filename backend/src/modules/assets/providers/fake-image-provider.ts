import { Buffer } from "node:buffer";

import type {
  AssetProviderAdapter,
  AssetProviderContext,
} from "../assets-provider-adapter.js";
import {
  resolveAssetsRunStorage,
  writeAssetFile,
} from "../assets-file-storage.js";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

export function createFakeImageProvider(): AssetProviderAdapter {
  return {
    providerName: "fake_image",
    providerType: "image",
    canHandle: ({ taskType }) => taskType === "image_still",

    prepare: async (ctx) => ({
      providerJobId: null,
      rawRequestJson: { task_id: ctx.execution.task_id },
    }),

    submit: async (ctx, prepared) => ({
      providerJobId: `fake_job_${ctx.execution.task_id}`,
      rawResponseJson: prepared.rawRequestJson,
    }),

    poll: async (_ctx, submitted) => ({
      status: "completed",
      rawResponseJson: submitted.rawResponseJson,
    }),

    download: async () => [],

    normalizeResult: async ({ ctx }) => {
      const storage = resolveAssetsRunStorage({
        projectStorageRootDir: ctx.projectStorageRootDir,
        runId: ctx.assetRunId,
      });

      const fileName = `${ctx.execution.task_id}.png`;
      const written = await writeAssetFile({
        storage,
        category: "images",
        fileName,
        data: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
      });

      const artifact = {
        artifact_id: `artifact_img_${ctx.execution.task_id}_v${ctx.execution.attempts}`,
        artifact_type: "image" as const,
        origin: "provider" as const,
        file_uri: written.fileUri,
        created_at: new Date().toISOString(),
        metadata: {
          width: 1080,
          height: 1920,
          file_hash: written.fileHash,
          relative_path: written.relativePath,
        },
      };

      return { artifacts: [artifact], notes: ["fake image generated"] };
    },

    cancel: async () => {},
  };
}
