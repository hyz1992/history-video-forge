import { ScriptLocalValidationResult } from "../../../../shared/src/index.js";
import { QualifiedNarrationSettings, type ResolvedGenerationConfigurationV1 } from "../../../../shared/src/index.js";
import { createHash } from "node:crypto";
import { canonicalStringify, type NarrationRecord, type NarrationDurationBand } from "../../../../shared/src/index.js";
export const narrationTextHash = (text: string) => createHash("sha256").update(text).digest("hex");
export function resolveNarrationReadiness(input: {
    mode: string;
    scriptRecordId: string | null;
    scriptTextSha256: string | null;
    scriptConfirmed: boolean;
    projectTtsSettingsSha256: string | null;
    targetDurationBand: NarrationDurationBand | null;
    activeNarration: NarrationRecord | null;
}): {
    ready: boolean;
    reason: string | null;
} {
    const deny = (reason: string) => ({ ready: false, reason });
    if (input.mode !== "narration_first_v1")
        return deny("narration_mode_unavailable");
    if (!input.scriptConfirmed)
        return deny("script_not_confirmed");
    const record = input.activeNarration;
    if (!record)
        return deny("narration_required");
    if (record.status === "stale" || record.scriptRecordId !== input.scriptRecordId || record.sourceTextSha256 !== input.scriptTextSha256 || record.sourceProjectTtsSettingsSha256 !== input.projectTtsSettingsSha256)
        return deny("narration_stale");
    if (record.status !== "confirmed")
        return deny("narration_not_confirmed");
    if (!record.output || record.output.validationReport.status !== "pass")
        return deny("narration_timing_invalid");
    if (!input.targetDurationBand || canonicalStringify(record.acceptedDurationBandSnapshot) !== canonicalStringify(input.targetDurationBand))
        return deny("narration_duration_not_accepted");
    return { ready: true, reason: null };
}
export function settingsFromResolvedNarration(resolved: ResolvedGenerationConfigurationV1, voiceId: unknown): QualifiedNarrationSettings {
    return QualifiedNarrationSettings.parse({ model: resolved.resolved_capabilities["tts.synthesize"].model_id, voice: voiceId, region: "cn-beijing", protocol: "dashscope_ws", parametersVersion: "neutral-pcm24k-v1", tone: resolved.effective.creative.narration?.tone ?? "neutral", rate: resolved.effective.creative.narration?.rate ?? 1, pitch: 1, volume: 50, sampleRate: 24000, format: "pcm", textType: "PlainText", wordTimestampEnabled: true, enableSsml: false, seed: 0, inputMode: "natural_paragraphs_single_task" });
}
export function hasPassingNarrationScriptValidation(value: unknown): boolean {
    const result = ScriptLocalValidationResult.safeParse(value);
    return result.success && result.data.decision === "pass" && result.data.errors.length === 0;
}

/** 保留原始record，另投影已终止run，避免权限转移后仍伪装生成中。 */
export function narrationVisibleStatus(recordStatus:NarrationRecord["status"],runStatus:string|null):NarrationRecord["status"] {
 if(recordStatus!=="generating")return recordStatus;
 if(runStatus==="failed")return "failed";
 if(runStatus==="needs_reconciliation"||runStatus==="succeeded")return "unknown";
 return recordStatus;
}
