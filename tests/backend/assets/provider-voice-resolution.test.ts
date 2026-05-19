import { describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { resolveProviderVoice } from "../../../backend/src/modules/assets/voice/provider-voice-resolution.service.js";
import {
  seedGlobalVoiceProfiles,
  updateVoiceProfileProviderState,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

describe("provider voice resolution", () => {
  it("reuses an existing provider voice id without creating a new designed voice", async () => {
    const db = createDbClient();
    await seedGlobalVoiceProfiles(db);
    await updateVoiceProfileProviderState(db, "voice_preset_cold_authority", {
      provider_status: "ready",
      provider_voice_id: "provider-voice-ready-001",
      preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("voice design should not be called");
      }),
    );

    const result = await resolveProviderVoice({
      db,
      localVoiceProfileId: "voice_preset_cold_authority",
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
    });

    expect(result).toMatchObject({
      localVoiceProfileId: "voice_preset_cold_authority",
      providerVoiceId: "provider-voice-ready-001",
      targetModel: "qwen3-tts-vd-2026-01-26",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
