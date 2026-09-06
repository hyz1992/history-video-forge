import { z } from "zod";
import { GenerationConfigurationV1 } from "../generation/generation-configuration.schema.js";
import { canonicalStringify } from "../generation/generation-configuration-resolver.js";
import { DEFAULT_NARRATION_CREATIVE_SETTINGS, NarrationDurationBand, NarrationSubtitleSettingsSnapshot, QualifiedNarrationSettings } from "./narration.schema.js";
import { NarrationSha256 } from "./narration-timing.schema.js";

/** WebCrypto 同时可用于后端和浏览器；只对已通过 strict schema 的 JSON 求 SHA-256。 */
async function sha256(value: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalStringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function hashNarrationSettings(value: unknown): Promise<string> {
  return sha256(QualifiedNarrationSettings.parse(value));
}
export function hashNarrationSubtitleSettings(value: unknown): Promise<string> {
  return sha256(NarrationSubtitleSettingsSnapshot.parse(value));
}
/** 只冻结项目语音投影；单次 override、字幕/视觉和整体 revision 均不混入。 */
export function hashProjectNarrationTtsSettings(value: unknown): Promise<string> {
  const configuration = GenerationConfigurationV1.parse(value);
  return sha256({
    modelSelection: configuration.capabilities["tts.synthesize"],
    voiceProfileId: configuration.creative.voice_profile_id,
    narration: configuration.creative.narration ?? DEFAULT_NARRATION_CREATIVE_SETTINGS,
  });
}
export const NarrationInvalidationState = z.object({
  sourceTextSha256: NarrationSha256, pronunciationRulesVersion: z.string().min(1),
  ttsSettingsSha256: NarrationSha256, targetDurationBand: NarrationDurationBand,
  subtitleSettingsSha256: NarrationSha256, visualSettingsSha256: NarrationSha256,
}).strict();
export const NarrationInvalidationInput = z.object({
  before: NarrationInvalidationState, after: NarrationInvalidationState,
  scope: z.enum(["draft", "user_default", "project_saved"]),
}).strict();
export interface NarrationInvalidation {
  regenerateNarration: boolean;
  reconfirmNarration: boolean;
  rebuildSubtitles: boolean;
  invalidatedStages: Array<"storyboard" | "asset_plan" | "assets" | "compose" | "render" | "publish">;
}
/** 设计 §4.3：此函数只返回失效意图，事务指针更新由后续生命周期服务执行。 */
export function resolveNarrationInvalidation(value: unknown): NarrationInvalidation {
  const { before, after, scope } = NarrationInvalidationInput.parse(value);
  const none: NarrationInvalidation = { regenerateNarration: false, reconfirmNarration: false, rebuildSubtitles: false, invalidatedStages: [] };
  if (scope !== "project_saved") return none;
  const audio = before.sourceTextSha256 !== after.sourceTextSha256 || before.pronunciationRulesVersion !== after.pronunciationRulesVersion || before.ttsSettingsSha256 !== after.ttsSettingsSha256;
  const subtitle = before.subtitleSettingsSha256 !== after.subtitleSettingsSha256;
  const visual = before.visualSettingsSha256 !== after.visualSettingsSha256;
  const band = before.targetDurationBand.minMs !== after.targetDurationBand.minMs || before.targetDurationBand.maxMs !== after.targetDurationBand.maxMs;
  return {
    regenerateNarration: audio, reconfirmNarration: audio || band, rebuildSubtitles: audio || subtitle,
    invalidatedStages: audio ? ["storyboard", "asset_plan", "assets", "compose", "render", "publish"] :
      visual ? ["asset_plan", "assets", "compose", "render", "publish"] : subtitle ? ["compose", "render", "publish"] : [],
  };
}
