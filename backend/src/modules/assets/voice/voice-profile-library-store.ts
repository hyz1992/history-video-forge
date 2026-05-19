import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import {
  VoiceProfile,
  type VoiceProfile as VoiceProfileRecord,
} from "../../../../../shared/src/index.js";

export const VOICE_PROFILE_LIBRARY_SCHEMA_VERSION = "voice_profiles_v1";

const VoiceProfileLibraryDocument = z
  .object({
    schema_version: z.literal(VOICE_PROFILE_LIBRARY_SCHEMA_VERSION),
    updated_at: z.string(),
    profiles: z.array(VoiceProfile),
  })
  .strict();

export type VoiceProfileLibraryDocument = z.infer<
  typeof VoiceProfileLibraryDocument
>;

export interface VoiceProfileLibraryStoreOptions {
  rootDir?: string;
}

export function buildVoiceProfileLibraryPath(
  options: VoiceProfileLibraryStoreOptions = {},
): string {
  return resolve(
    options.rootDir ?? process.cwd(),
    "storage",
    "voice-profiles",
    "voice-profiles.json",
  );
}

export async function loadVoiceProfileLibrary(
  options: VoiceProfileLibraryStoreOptions = {},
): Promise<VoiceProfileLibraryDocument> {
  const filePath = buildVoiceProfileLibraryPath(options);
  if (!existsSync(filePath)) {
    return {
      schema_version: VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
      updated_at: new Date(0).toISOString(),
      profiles: [],
    };
  }

  return VoiceProfileLibraryDocument.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );
}

export async function saveVoiceProfileLibrary(input: {
  rootDir?: string;
  profiles: VoiceProfileRecord[];
  nowIso?: string;
}): Promise<VoiceProfileLibraryDocument> {
  const profiles = input.profiles
    .map((profile) => VoiceProfile.parse(profile))
    .sort((left, right) =>
      left.voice_profile_id.localeCompare(right.voice_profile_id),
    );
  const document = VoiceProfileLibraryDocument.parse({
    schema_version: VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
    updated_at: input.nowIso ?? new Date().toISOString(),
    profiles,
  });
  const filePath = buildVoiceProfileLibraryPath({ rootDir: input.rootDir });
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return document;
}
