import type {
  DbClient,
} from "../../../db/client.js";
import {
  VoiceProfile,
  type VoiceProfile as VoiceProfileRecord,
} from "../../../../../shared/src/index.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "./voice-presets.js";

export async function seedGlobalVoiceProfiles(
  db: DbClient,
): Promise<void> {
  for (const seed of SHARED_VOICE_PROFILE_SEEDS) {
    if (!db.voiceProfiles.has(seed.voice_profile_id)) {
      db.voiceProfiles.set(seed.voice_profile_id, VoiceProfile.parse(seed));
    }
  }
}

export async function listVoiceProfiles(
  db: DbClient,
): Promise<VoiceProfileRecord[]> {
  return [...db.voiceProfiles.values()];
}

export async function getVoiceProfileById(
  db: DbClient,
  id: string,
): Promise<VoiceProfileRecord | null> {
  return db.voiceProfiles.get(id) ?? null;
}

export async function saveVoiceProfile(
  db: DbClient,
  profile: VoiceProfileRecord,
): Promise<VoiceProfileRecord> {
  const parsed = VoiceProfile.parse(profile);
  db.voiceProfiles.set(parsed.voice_profile_id, parsed);
  return parsed;
}

export async function updateVoiceProfileProviderState(
  db: DbClient,
  id: string,
  patch: Pick<VoiceProfileRecord, "provider_status"> &
    Partial<Pick<VoiceProfileRecord, "provider_voice_id" | "preview_audio_uri">>,
): Promise<VoiceProfileRecord | null> {
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
  return updated;
}
