import {
  VoiceIntent,
  VoiceMatchResult,
  type AssetPlan,
  type VoiceIntent as VoiceIntentRecord,
  type VoiceMatchResult as VoiceMatchResultRecord,
} from "../../../../../shared/src/index.js";
import type { DbClient } from "../../../db/client.js";
import { createLocalVoiceProfileFromIntent } from "./voice-profile-creator.js";
import {
  getVoiceProfileById,
  listVoiceProfiles,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
} from "./voice-profile.repository.js";
import { matchVoiceProfile } from "./voice-matcher.js";

const DEFAULT_HISTORICAL_VOICE_INTENT: VoiceIntentRecord = {
  content_family: "historical_power",
  narrator_persona: "克制的历史旁白",
  desired_traits: ["cold", "authoritative", "restrained"],
  avoid_traits: ["shouting", "broadcast_exaggeration"],
  gender_tone: "male_leaning",
  age_band: "35-45",
  pitch: "mid_low",
  pace: "medium_slow",
  energy: 0.45,
  authority: 0.85,
  suspense: 0.65,
  warmth: 0.2,
  style_notes: ["重音明确", "短停顿"],
};

export interface ResolveVoiceProfileInput {
  db: DbClient;
  requestedVoiceProfileId: string;
  assetPlan: AssetPlan;
}

export interface ResolveVoiceProfileResult {
  voiceProfileId: string;
  matchResult: VoiceMatchResultRecord;
}

function readVoiceIntent(assetPlan: AssetPlan): VoiceIntentRecord {
  const candidate = assetPlan.global_audio_strategy.voice_intent;
  const parsed = VoiceIntent.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_HISTORICAL_VOICE_INTENT;
}

export async function resolveVoiceProfile(
  input: ResolveVoiceProfileInput,
): Promise<ResolveVoiceProfileResult> {
  await seedGlobalVoiceProfiles(input.db);

  const requestedId = input.requestedVoiceProfileId.trim();
  if (requestedId) {
    const requested = await getVoiceProfileById(input.db, requestedId);
    if (requested && requested.provider_status !== "deleted") {
      return {
        voiceProfileId: requested.voice_profile_id,
        matchResult: VoiceMatchResult.parse({
          selected_voice_profile_id: requested.voice_profile_id,
          match_score: 1,
          match_decision: "matched_existing",
          match_reasons: ["explicit_request"],
          rejected_profile_ids: [],
        }),
      };
    }
  }

  const intent = readVoiceIntent(input.assetPlan);
  const profiles = await listVoiceProfiles(input.db);
  const matchResult = matchVoiceProfile({
    intent,
    profiles,
    allowLocalProfileCreation: true,
  });

  if (matchResult.match_decision === "created_local_profile") {
    const profile = await saveVoiceProfile(
      input.db,
      createLocalVoiceProfileFromIntent({
        intent,
        nowIso: new Date().toISOString(),
        voiceProfileId: `voice_generated_${input.db.generateId()}`,
      }),
    );

    return {
      voiceProfileId: profile.voice_profile_id,
      matchResult: VoiceMatchResult.parse({
        ...matchResult,
        selected_voice_profile_id: profile.voice_profile_id,
      }),
    };
  }

  return {
    voiceProfileId: matchResult.selected_voice_profile_id,
    matchResult,
  };
}
