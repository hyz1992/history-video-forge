import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import {
  listVoiceProfiles,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

describe("global voice profile repository", () => {
  it("seeds four shared presets plus one system voice", async () => {
    const db = createDbClient();

    await seedGlobalVoiceProfiles(db);
    await seedGlobalVoiceProfiles(db);

    const profiles = await listVoiceProfiles(db);
    expect(profiles.map((item) => item.voice_profile_id)).toEqual([
      "voice_preset_cold_authority",
      "voice_preset_steady_documentary",
      "voice_preset_crisp_storyteller",
      "voice_preset_eerie_suspense",
      "voice_system_ethan",
    ]);
  });

  it("stores generated profiles globally, not per project", async () => {
    const db = createDbClient();

    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, {
      voice_profile_id: "voice_generated_test",
      kind: "generated",
      name: "测试音色",
      description: "测试用全局音色",
      design_prompt:
        "30 到 40 岁中性旁白声线，中音，吐字清晰，语速中等，适合测试。避免夸张表演。",
      preview_text: "这是一段测试音色的预览文本。",
      provider_name: "dashscope",
      provider_voice_id: null,
      provider_status: "missing",
      target_model: "qwen3-tts-vd-2026-01-26",
      recommended_content_families: ["test"],
      voice_traits: ["clear"],
      avoid_traits: ["overacting"],
      gender_tone: "neutral",
      age_band: "30-40",
      pitch: "mid",
      pace: "medium",
      energy: 0.5,
      authority: 0.5,
      suspense: 0.2,
      warmth: 0.4,
      preview_audio_uri: null,
      usage_count: 0,
      last_used_at: null,
      quality_score: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    });

    const profiles = await listVoiceProfiles(db);
    expect(
      profiles.some((item) => item.voice_profile_id === "voice_generated_test"),
    ).toBe(true);
  });
});
