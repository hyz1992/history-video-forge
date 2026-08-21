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
  recordVoiceProfileUsage,
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
  /**
   * S2-2B（详细设计 §6.4）：运行所属项目 owner。决定音色库可见性
   * （公共 + 本人私有）；创建本地生成档案时归属该用户。
   */
  ownerId?: string | null;
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
    const requested = await getVoiceProfileById(input.db, requestedId, {
      ownerId: input.ownerId,
    });
    if (requested && requested.provider_status !== "deleted") {
      await recordVoiceProfileUsage(input.db, requested.voice_profile_id);
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
  const profiles = await listVoiceProfiles(input.db, { ownerId: input.ownerId });
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
        ownerId: input.ownerId,
      }),
    );
    await recordVoiceProfileUsage(input.db, profile.voice_profile_id);

    return {
      voiceProfileId: profile.voice_profile_id,
      matchResult: VoiceMatchResult.parse({
        ...matchResult,
        selected_voice_profile_id: profile.voice_profile_id,
      }),
    };
  }

  await recordVoiceProfileUsage(input.db, matchResult.selected_voice_profile_id);

  return {
    voiceProfileId: matchResult.selected_voice_profile_id,
    matchResult,
  };
}
