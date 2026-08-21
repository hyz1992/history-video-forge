import { z } from "zod";

export const VoiceProfileKind = z.enum(["preset", "generated", "system"]);

export const VoiceProviderStatus = z.enum([
  "missing",
  "creating",
  "ready",
  "failed",
  "deleted",
]);

const Score = z.number().min(0).max(1);

export const VoiceIntent = z
  .object({
    content_family: z.string().min(1),
    narrator_persona: z.string().min(1),
    desired_traits: z.array(z.string().min(1)),
    avoid_traits: z.array(z.string().min(1)),
    gender_tone: z.string().min(1).nullable().optional(),
    age_band: z.string().min(1).nullable().optional(),
    pitch: z.string().min(1).nullable().optional(),
    pace: z.string().min(1).nullable().optional(),
    energy: Score.nullable().optional(),
    authority: Score.nullable().optional(),
    suspense: Score.nullable().optional(),
    warmth: Score.nullable().optional(),
    style_notes: z.array(z.string().min(1)),
  })
  .strict();

export const VoiceProfile = z
  .object({
    voice_profile_id: z.string().min(1),
    kind: VoiceProfileKind,
    /**
     * S2-2B（详细设计 §6.4）：档案归属。公共档案（preset/system）为 null；
     * 用户生成档案为创建用户 id。可选字段兼容历史 JSON（无该字段时由
     * repository 按 kind 归一化：generated → 私有，其余 → 公共）。
     */
    owner_id: z.string().min(1).nullable().optional(),
    visibility: z.enum(["public", "private"]).optional(),
    name: z.string().min(1),
    description: z.string().min(1),
    design_prompt: z.string().min(1).max(2048),
    preview_text: z.string().min(1).max(1024),
    provider_name: z.string().min(1),
    provider_voice_id: z.string().min(1).nullable(),
    provider_status: VoiceProviderStatus,
    target_model: z.string().min(1),
    recommended_content_families: z.array(z.string().min(1)),
    voice_traits: z.array(z.string().min(1)),
    avoid_traits: z.array(z.string().min(1)),
    gender_tone: z.string().min(1).nullable(),
    age_band: z.string().min(1).nullable(),
    pitch: z.string().min(1).nullable(),
    pace: z.string().min(1).nullable(),
    energy: Score.nullable(),
    authority: Score.nullable(),
    suspense: Score.nullable(),
    warmth: Score.nullable(),
    preview_audio_uri: z.string().min(1).nullable(),
    usage_count: z.number().int().nonnegative(),
    last_used_at: z.string().nullable(),
    quality_score: Score.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const VoiceMatchResult = z
  .object({
    selected_voice_profile_id: z.string().min(1),
    match_score: Score,
    match_decision: z.enum([
      "matched_existing",
      "created_local_profile",
      "fallback_system",
    ]),
    match_reasons: z.array(z.string().min(1)),
    rejected_profile_ids: z.array(
      z
        .object({
          voice_profile_id: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type VoiceIntent = z.infer<typeof VoiceIntent>;
export type VoiceProfile = z.infer<typeof VoiceProfile>;
export type VoiceMatchResult = z.infer<typeof VoiceMatchResult>;
