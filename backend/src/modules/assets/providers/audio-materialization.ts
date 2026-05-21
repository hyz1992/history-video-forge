import { stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AssetStorageCategory,
  AssetsRunStorage,
  WrittenAssetFile,
} from "../assets-file-storage.js";
import { copyAssetFile, writeAssetFile } from "../assets-file-storage.js";
import { createToneWavBuffer } from "./audio-fixture.js";

export type AudioMaterializedFrom = "library_file" | "generated_fixture";

export async function materializeLibraryAudio(input: {
  storage: AssetsRunStorage;
  category: Extract<AssetStorageCategory, "audio/bgm" | "audio/sfx">;
  fileName: string;
  fileUri: string;
  durationSec: number;
  fallbackFrequencyHz?: number;
}): Promise<{
  written: WrittenAssetFile;
  sourceMaterializedFrom: AudioMaterializedFrom;
}> {
  const sourcePath = await resolveExistingLocalAudioPath(input.fileUri);
  if (sourcePath) {
    return {
      written: await copyAssetFile({
        storage: input.storage,
        category: input.category,
        sourcePath,
        fileName: input.fileName,
      }),
      sourceMaterializedFrom: "library_file",
    };
  }

  return {
    written: await writeAssetFile({
      storage: input.storage,
      category: input.category,
      fileName: input.fileName,
      data: createToneWavBuffer({
        durationSec: input.durationSec,
        frequencyHz: input.fallbackFrequencyHz,
        amplitude: 0.18,
      }),
    }),
    sourceMaterializedFrom: "generated_fixture",
  };
}

async function resolveExistingLocalAudioPath(
  fileUri: string,
): Promise<string | null> {
  if (fileUri.startsWith("library://")) {
    return null;
  }

  const candidate = fileUri.startsWith("file://")
    ? fileURLToPath(fileUri)
    : isAbsolute(fileUri)
      ? fileUri
      : resolve(process.cwd(), fileUri);

  try {
    const stats = await stat(candidate);
    return stats.isFile() ? candidate : null;
  } catch {
    return null;
  }
}
