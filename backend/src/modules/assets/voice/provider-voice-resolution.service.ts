import type { DbClient } from "../../../db/client.js";
import {
  createDashscopeDesignedVoice,
} from "../providers/dashscope/dashscope-voice-design-provider.js";
import {
  getVoiceProfileById,
  updateVoiceProfileProviderState,
} from "./voice-profile.repository.js";

export interface ResolveProviderVoiceInput {
  db: DbClient;
  localVoiceProfileId: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ResolveProviderVoiceResult {
  localVoiceProfileId: string;
  providerVoiceId: string;
  targetModel: string;
  matchScore: number | null;
  matchReasons: string[];
}

function previewAudioUriFromBase64(value: string | null): string | null {
  return value ? `data:audio/wav;base64,${value}` : null;
}

export async function resolveProviderVoice(
  input: ResolveProviderVoiceInput,
): Promise<ResolveProviderVoiceResult> {
  const profile = await getVoiceProfileById(input.db, input.localVoiceProfileId);
  if (!profile) {
    throw new Error(`voice_profile_not_found:${input.localVoiceProfileId}`);
  }

  if (profile.provider_status === "deleted") {
    throw new Error(`voice_profile_deleted:${input.localVoiceProfileId}`);
  }

  if (
    (profile.kind === "system" || profile.provider_status === "ready") &&
    profile.provider_voice_id
  ) {
    return {
      localVoiceProfileId: profile.voice_profile_id,
      providerVoiceId: profile.provider_voice_id,
      targetModel: profile.target_model,
      matchScore: null,
      matchReasons: [],
    };
  }

  if (profile.provider_status === "creating") {
    throw new Error(`voice_provider_creation_pending:${input.localVoiceProfileId}`);
  }

  if (profile.provider_name !== "dashscope") {
    throw new Error(`voice_provider_unsupported:${profile.provider_name}`);
  }

  try {
    const designedVoice = await createDashscopeDesignedVoice({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      voicePrompt: profile.design_prompt,
      previewText: profile.preview_text,
      preferredName: profile.voice_profile_id,
      targetModel: profile.target_model,
    });

    await updateVoiceProfileProviderState(input.db, profile.voice_profile_id, {
      provider_status: "ready",
      provider_voice_id: designedVoice.providerVoiceId,
      preview_audio_uri: previewAudioUriFromBase64(
        designedVoice.previewAudioBase64,
      ),
    });

    return {
      localVoiceProfileId: profile.voice_profile_id,
      providerVoiceId: designedVoice.providerVoiceId,
      targetModel: profile.target_model,
      matchScore: null,
      matchReasons: [],
    };
  } catch (error) {
    await updateVoiceProfileProviderState(input.db, profile.voice_profile_id, {
      provider_status: "failed",
    });
    throw new Error(
      `voice_provider_creation_failed:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
