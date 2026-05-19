import type {
  DbClient,
} from "../../../db/client.js";
import {
  VoiceProfile,
  type VoiceProfile as VoiceProfileRecord,
} from "../../../../../shared/src/index.js";
import {
  loadVoiceProfileLibrary,
  saveVoiceProfileLibrary,
} from "./voice-profile-library-store.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "./voice-presets.js";

export function configureVoiceProfilePersistence(
  db: DbClient,
  options: { rootDir?: string },
): void {
  db.voiceProfilePersistence = {
    rootDir: options.rootDir,
    enabled: true,
    loaded: false,
  };
}

export async function loadPersistedVoiceProfiles(
  db: DbClient,
): Promise<void> {
  if (db.voiceProfilePersistence.loaded) {
    return;
  }
  if (!db.voiceProfilePersistence.enabled) {
    db.voiceProfilePersistence.loaded = true;
    return;
  }

  const document = await loadVoiceProfileLibrary({
    rootDir: db.voiceProfilePersistence.rootDir,
  });
  for (const profile of document.profiles) {
    db.voiceProfiles.set(profile.voice_profile_id, profile);
  }
  db.voiceProfilePersistence.loaded = true;
}

async function persistVoiceProfiles(db: DbClient): Promise<void> {
  if (!db.voiceProfilePersistence.enabled) {
    return;
  }

  await saveVoiceProfileLibrary({
    rootDir: db.voiceProfilePersistence.rootDir,
    profiles: [...db.voiceProfiles.values()],
  });
}

export async function seedGlobalVoiceProfiles(
  db: DbClient,
): Promise<void> {
  await loadPersistedVoiceProfiles(db);

  let changed = false;
  for (const seed of SHARED_VOICE_PROFILE_SEEDS) {
    if (!db.voiceProfiles.has(seed.voice_profile_id)) {
      db.voiceProfiles.set(seed.voice_profile_id, VoiceProfile.parse(seed));
      changed = true;
    }
  }
  if (changed) {
    await persistVoiceProfiles(db);
  }
}

export async function listVoiceProfiles(
  db: DbClient,
): Promise<VoiceProfileRecord[]> {
  await loadPersistedVoiceProfiles(db);
  return [...db.voiceProfiles.values()];
}

export async function getVoiceProfileById(
  db: DbClient,
  id: string,
): Promise<VoiceProfileRecord | null> {
  await loadPersistedVoiceProfiles(db);
  return db.voiceProfiles.get(id) ?? null;
}

export async function saveVoiceProfile(
  db: DbClient,
  profile: VoiceProfileRecord,
): Promise<VoiceProfileRecord> {
  await loadPersistedVoiceProfiles(db);
  const parsed = VoiceProfile.parse(profile);
  db.voiceProfiles.set(parsed.voice_profile_id, parsed);
  await persistVoiceProfiles(db);
  return parsed;
}

export async function updateVoiceProfileProviderState(
  db: DbClient,
  id: string,
  patch: Pick<VoiceProfileRecord, "provider_status"> &
    Partial<Pick<VoiceProfileRecord, "provider_voice_id" | "preview_audio_uri">>,
): Promise<VoiceProfileRecord | null> {
  await loadPersistedVoiceProfiles(db);
  const existing = db.voiceProfiles.get(id);
  if (!existing) return null;

  const updated = VoiceProfile.parse({
    ...existing,
    provider_status: patch.provider_status,
    provider_voice_id:
      patch.provider_voice_id === undefined
        ? existing.provider_voice_id
        : patch.provider_voice_id,
    preview_audio_uri:
      patch.preview_audio_uri === undefined
        ? existing.preview_audio_uri
        : patch.preview_audio_uri,
    updated_at: new Date().toISOString(),
  });

  db.voiceProfiles.set(id, updated);
  await persistVoiceProfiles(db);
  return updated;
}
