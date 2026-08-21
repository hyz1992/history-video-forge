import type { GenerationRunDispatchHandler } from "./generation-run-dispatcher.js";
import { runVoicePreviewDispatch } from "../assets/voice/voice-preview.service.js";

/**
 * S2-2B（详细设计 §9.3）：voice.preview 试听 dispatch handler。
 *
 * 执行体从 run 快照（quote 已授权、配置已冻结）与 dispatch payload 的
 * voice_profile_id 恢复试听目标；usage 记账走 (snapshot, voice-preview:<id>,
 * attemptIndex) 幂等键 + overrun 语义。免 quote 的 stub/fake 本地路径不经过
 * 本 handler（由 voice-profiles.routes 直接调用 executeVoicePreview）。
 */
export function createVoicePreviewDispatchHandler(): GenerationRunDispatchHandler {
  return async (run, context) => {
    const payload = run.dispatchPayloadJson as { voice_profile_id?: string };
    const voiceProfileId = payload.voice_profile_id;
    if (!voiceProfileId) {
      return {
        status: "failed",
        reason_code: "voice_preview_profile_missing",
        message: "voice.preview run requires voice_profile_id in dispatch payload",
      };
    }
    const snapshot = context.db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId);
    if (!snapshot) {
      return {
        status: "failed",
        reason_code: "dispatch_snapshot_missing",
        message: "run snapshot missing; refusing preview dispatch without billing context",
      };
    }
    const outcome = await runVoicePreviewDispatch({
      db: context.db,
      run,
      snapshot,
      voiceProfileId,
    });
    if (outcome.status === "succeeded") {
      return { status: "succeeded", response: { statusCode: 200, body: outcome.body } };
    }
    return {
      status: "failed",
      reason_code: (outcome.body.error as string) ?? "voice_preview_failed",
      message: "voice preview execution failed",
      response: { statusCode: 500, body: outcome.body },
    };
  };
}
