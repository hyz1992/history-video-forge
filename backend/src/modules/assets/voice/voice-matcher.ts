import {
  VoiceMatchResult,
  type VoiceIntent,
  type VoiceMatchResult as VoiceMatchResultRecord,
  type VoiceProfile,
} from "../../../../../shared/src/index.js";

const MATCH_EXISTING_THRESHOLD = 0.75;
const CREATE_LOCAL_THRESHOLD = 0.55;

export interface MatchVoiceProfileInput {
  intent: VoiceIntent;
  profiles: VoiceProfile[];
  allowLocalProfileCreation: boolean;
}

interface ScoredProfile {
  profile: VoiceProfile;
  score: number;
  reasons: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map(normalize));
}

function overlapRatio(left: string[], right: string[]): number {
  if (left.length === 0) return 0;
  const rightSet = normalizedSet(right);
  const count = left.filter((value) => rightSet.has(normalize(value))).length;
  return count / left.length;
}

function closeness(expected: number | null | undefined, actual: number | null): number {
  if (expected === null || expected === undefined || actual === null) return 0.5;
  return Math.max(0, 1 - Math.abs(expected - actual));
}

function optionalExact(
  expected: string | null | undefined,
  actual: string | null,
): number {
  if (!expected || !actual) return 0.5;
  return normalize(expected) === normalize(actual) ? 1 : 0;
}

function scoreProfile(intent: VoiceIntent, profile: VoiceProfile): ScoredProfile {
  const reasons: string[] = [];
  const recommendedFamilies = profile.recommended_content_families.map(normalize);
  const contentMatches = recommendedFamilies.includes(normalize(intent.content_family));
  const contentScore = contentMatches ? 1 : 0;
  if (contentMatches) {
    reasons.push(`content_family:${intent.content_family}`);
  }

  const desiredRatio = overlapRatio(intent.desired_traits, profile.voice_traits);
  if (desiredRatio > 0) {
    reasons.push(`desired_traits:${desiredRatio.toFixed(2)}`);
  }

  const avoidRatio = overlapRatio(intent.avoid_traits, profile.voice_traits);
  if (avoidRatio > 0) {
    reasons.push(`avoid_penalty:${avoidRatio.toFixed(2)}`);
  }

  const numericScore =
    (
      closeness(intent.energy, profile.energy) +
      closeness(intent.authority, profile.authority) +
      closeness(intent.suspense, profile.suspense) +
      closeness(intent.warmth, profile.warmth)
    ) / 4;
  reasons.push(`numeric_closeness:${numericScore.toFixed(2)}`);

  const compatibilityScore =
    (
      optionalExact(intent.pitch, profile.pitch) +
      optionalExact(intent.pace, profile.pace) +
      optionalExact(intent.gender_tone, profile.gender_tone) +
      optionalExact(intent.age_band, profile.age_band)
    ) / 4;
  if (compatibilityScore > 0) {
    reasons.push(`compatibility:${compatibilityScore.toFixed(2)}`);
  }

  const readinessScore =
    profile.provider_status === "ready" || profile.kind === "system" ? 1 : 0;

  const score =
    0.25 * contentScore +
    0.25 * desiredRatio +
    0.15 * (1 - avoidRatio) +
    0.2 * numericScore +
    0.1 * compatibilityScore +
    0.05 * readinessScore;

  return {
    profile,
    score: Number(score.toFixed(4)),
    reasons,
  };
}

export function matchVoiceProfile(
  input: MatchVoiceProfileInput,
): VoiceMatchResultRecord {
  const candidates = input.profiles
    .filter((profile) => profile.provider_status !== "deleted")
    .map((profile) => scoreProfile(input.intent, profile))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.profile.voice_profile_id.localeCompare(right.profile.voice_profile_id);
    });

  const best = candidates[0];
  if (!best) {
    return VoiceMatchResult.parse({
      selected_voice_profile_id: "voice_system_ethan",
      match_score: 0,
      match_decision: "fallback_system",
      match_reasons: ["no_profiles_available"],
      rejected_profile_ids: [],
    });
  }

  const rejected = candidates.slice(1).map((candidate) => ({
    voice_profile_id: candidate.profile.voice_profile_id,
    reason: `score:${candidate.score.toFixed(2)}`,
  }));

  if (best.score >= MATCH_EXISTING_THRESHOLD) {
    return VoiceMatchResult.parse({
      selected_voice_profile_id: best.profile.voice_profile_id,
      match_score: best.score,
      match_decision: "matched_existing",
      match_reasons: best.reasons,
      rejected_profile_ids: rejected,
    });
  }

  if (input.allowLocalProfileCreation && best.score < CREATE_LOCAL_THRESHOLD) {
    return VoiceMatchResult.parse({
      selected_voice_profile_id: "voice_generated_candidate",
      match_score: best.score,
      match_decision: "created_local_profile",
      match_reasons: [
        `best_existing:${best.profile.voice_profile_id}`,
        `best_score:${best.score.toFixed(2)}`,
        "below_create_local_threshold",
      ],
      rejected_profile_ids: candidates.map((candidate) => ({
        voice_profile_id: candidate.profile.voice_profile_id,
        reason: `score:${candidate.score.toFixed(2)}`,
      })),
    });
  }

  return VoiceMatchResult.parse({
    selected_voice_profile_id: best.profile.voice_profile_id,
    match_score: best.score,
    match_decision: "fallback_system",
    match_reasons: [
      `best_existing:${best.profile.voice_profile_id}`,
      `best_score:${best.score.toFixed(2)}`,
      "below_match_existing_threshold",
    ],
    rejected_profile_ids: rejected,
  });
}
