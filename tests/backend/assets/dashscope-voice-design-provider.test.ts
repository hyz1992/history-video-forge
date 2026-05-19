import { describe, expect, it, vi } from "vitest";

import {
  buildDashscopeVoiceDesignCreatePayload,
  createDashscopeDesignedVoice,
  sanitizePreferredVoiceName,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-voice-design-provider.js";

describe("DashScope voice design provider boundary", () => {
  it("sanitizes preferred_name for Qwen voice design", () => {
    expect(sanitizePreferredVoiceName("冷峻 权谋-01")).toBe("voice_01");
    expect(sanitizePreferredVoiceName("Historical Power Voice 001")).toBe(
      "historical_power",
    );
  });

  it("builds a Qwen voice design create payload", () => {
    expect(
      buildDashscopeVoiceDesignCreatePayload({
        voicePrompt: "35 到 45 岁偏男中低音，吐字清晰。",
        previewText: "诏令还没出宫门，刀兵就先到了阶下。",
        preferredName: "cold_authority",
        targetModel: "qwen3-tts-vd-2026-01-26",
      }),
    ).toEqual({
      model: "qwen-voice-design",
      input: {
        action: "create",
        target_model: "qwen3-tts-vd-2026-01-26",
        preferred_name: "cold_authority",
        voice_prompt: "35 到 45 岁偏男中低音，吐字清晰。",
        preview_text: "诏令还没出宫门，刀兵就先到了阶下。",
      },
      parameters: {
        sample_rate: 24000,
        response_format: "wav",
      },
    });
  });

  it("normalizes create response without real network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: {
              voice: "voice-provider-001",
              preview_audio: {
                data: Buffer.from("preview").toString("base64"),
                sample_rate: 24000,
                response_format: "wav",
              },
            },
            request_id: "req_voice_001",
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await createDashscopeDesignedVoice({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      voicePrompt: "35 到 45 岁偏男中低音，吐字清晰。",
      previewText: "诏令还没出宫门，刀兵就先到了阶下。",
      preferredName: "cold_authority",
      targetModel: "qwen3-tts-vd-2026-01-26",
    });

    expect(result.providerVoiceId).toBe("voice-provider-001");
    expect(result.providerStatus).toBe("ready");
    expect(result.requestId).toBe("req_voice_001");
    expect(result.previewAudioBase64).toBeTruthy();
  });
});
