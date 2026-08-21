import {
  VoiceProfile,
  type VoiceIntent,
  type VoiceProfile as VoiceProfileRecord,
} from "../../../../../shared/src/index.js";

const DESIGNED_VOICE_TARGET_MODEL = "qwen3-tts-vd-2026-01-26";

export interface CreateLocalVoiceProfileFromIntentInput {
  intent: VoiceIntent;
  nowIso: string;
  voiceProfileId: string;
  /** S2-2B：生成档案归属创建用户（运行所属项目 owner）。 */
  ownerId?: string | null;
}

function joinOrDefault(values: string[], fallback: string): string {
  return values.length > 0 ? values.join("、") : fallback;
}

function buildDesignPrompt(intent: VoiceIntent): string {
  const ageAndTone = [
    intent.age_band ?? "30-40",
    intent.gender_tone ?? "neutral",
  ].join(" ");
  const pitch = intent.pitch ?? "mid";
  const pace = intent.pace ?? "medium";
  const traits = joinOrDefault(intent.desired_traits, "自然、清晰");
  const avoidTraits = joinOrDefault(intent.avoid_traits, "夸张表演");

  return [
    `${ageAndTone}中文旁白声线，${pitch}，音色${traits}，吐字清晰，语速${pace}，停连自然，情绪基底贴合${intent.narrator_persona}，适合${intent.content_family}。`,
    `避免${avoidTraits}。`,
  ].join("");
}

export function createLocalVoiceProfileFromIntent(
  input: CreateLocalVoiceProfileFromIntentInput,
): VoiceProfileRecord {
  const { intent, nowIso, voiceProfileId, ownerId } = input;

  return VoiceProfile.parse({
    voice_profile_id: voiceProfileId,
    kind: "generated",
    owner_id: ownerId ?? null,
    name: intent.narrator_persona,
    description: `${intent.content_family} 专用${intent.narrator_persona}`,
    design_prompt: buildDesignPrompt(intent),
    preview_text: "这是一段用于确认音色身份的中文预览样音。",
    provider_name: "dashscope",
    provider_voice_id: null,
    provider_status: "missing",
    target_model: DESIGNED_VOICE_TARGET_MODEL,
    recommended_content_families: [intent.content_family],
    voice_traits: intent.desired_traits,
    avoid_traits: intent.avoid_traits,
    gender_tone: intent.gender_tone ?? null,
    age_band: intent.age_band ?? null,
    pitch: intent.pitch ?? null,
    pace: intent.pace ?? null,
    energy: intent.energy ?? null,
    authority: intent.authority ?? null,
    suspense: intent.suspense ?? null,
    warmth: intent.warmth ?? null,
    preview_audio_uri: null,
    usage_count: 0,
    last_used_at: null,
    quality_score: null,
    created_at: nowIso,
    updated_at: nowIso,
  });
}
