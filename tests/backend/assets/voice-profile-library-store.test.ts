import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildVoiceProfileLibraryPath,
  loadVoiceProfileLibrary,
  saveVoiceProfileLibrary,
  VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
} from "../../../backend/src/modules/assets/voice/voice-profile-library-store.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "../../../backend/src/modules/assets/voice/voice-presets.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "voice-profile-store-"));
  tempDirs.push(root);
  return root;
}

describe("voice profile library store", () => {
  it("returns an empty document when the store file is missing", async () => {
    const rootDir = await makeTempRoot();

    const document = await loadVoiceProfileLibrary({ rootDir });

    expect(document).toMatchObject({
      schema_version: VOICE_PROFILE_LIBRARY_SCHEMA_VERSION,
      profiles: [],
    });
  });

  it("saves stable pretty JSON and reloads VoiceProfile records", async () => {
    const rootDir = await makeTempRoot();

    await saveVoiceProfileLibrary({
      rootDir,
      profiles: [
        SHARED_VOICE_PROFILE_SEEDS[1]!,
        SHARED_VOICE_PROFILE_SEEDS[0]!,
      ],
      nowIso: "2026-05-19T12:00:00.000Z",
    });

    const filePath = buildVoiceProfileLibraryPath({ rootDir });
    const raw = await readFile(filePath, "utf8");
    expect(raw).toContain("\"schema_version\": \"voice_profiles_v1\"");
    expect(raw).toContain("\"updated_at\": \"2026-05-19T12:00:00.000Z\"");
    expect(raw.indexOf("voice_preset_cold_authority")).toBeLessThan(
      raw.indexOf("voice_preset_steady_documentary"),
    );

    const loaded = await loadVoiceProfileLibrary({ rootDir });
    expect(loaded.profiles.map((profile) => profile.voice_profile_id)).toEqual([
      "voice_preset_cold_authority",
      "voice_preset_steady_documentary",
    ]);
  });
});
