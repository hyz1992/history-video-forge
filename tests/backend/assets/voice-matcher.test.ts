import { describe, expect, it } from "vitest";

import { createLocalVoiceProfileFromIntent } from "../../../backend/src/modules/assets/voice/voice-profile-creator.js";
import { matchVoiceProfile } from "../../../backend/src/modules/assets/voice/voice-matcher.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "../../../backend/src/modules/assets/voice/voice-presets.js";

describe("voice matcher", () => {
  it("selects cold authority for historical power intent", () => {
    const result = matchVoiceProfile({
      intent: {
        content_family: "historical_power",
        narrator_persona: "克制的历史旁白",
        desired_traits: ["cold", "authoritative", "restrained"],
        avoid_traits: ["shouting"],
        gender_tone: "male_leaning",
        age_band: "35-45",
        pitch: "mid_low",
        pace: "medium_slow",
        energy: 0.45,
        authority: 0.9,
        suspense: 0.7,
        warmth: 0.2,
        style_notes: ["短停顿"],
      },
      profiles: SHARED_VOICE_PROFILE_SEEDS,
      allowLocalProfileCreation: true,
    });

    expect(result.selected_voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );
    expect(result.match_decision).toBe("matched_existing");
    expect(result.match_score).toBeGreaterThanOrEqual(0.75);
    expect(result.match_reasons.join(" ")).toContain("desired_traits");
  });

  it("creates a local profile when no seed is close enough", () => {
    const intent = {
      content_family: "gentle_healing",
      narrator_persona: "温柔疗愈旁白",
      desired_traits: ["warm", "soft", "healing"],
      avoid_traits: ["cold", "authoritative"],
      gender_tone: "female_leaning",
      age_band: "25-35",
      pitch: "mid_high",
      pace: "slow",
      energy: 0.25,
      authority: 0.2,
      suspense: 0.1,
      warmth: 0.95,
      style_notes: ["轻柔停顿"],
    };

    const match = matchVoiceProfile({
      intent,
      profiles: SHARED_VOICE_PROFILE_SEEDS,
      allowLocalProfileCreation: true,
    });
    const profile = createLocalVoiceProfileFromIntent({
      intent,
      nowIso: "2026-05-19T00:00:00.000Z",
      voiceProfileId: "voice_generated_gentle_healing",
    });

    expect(match.match_decision).toBe("created_local_profile");
    expect(profile.provider_status).toBe("missing");
    expect(profile.provider_voice_id).toBeNull();
    expect(profile.design_prompt).toContain("温柔疗愈旁白");
    expect(profile.design_prompt).toContain("避免");
  });
});
