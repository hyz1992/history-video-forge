import { createHash } from "node:crypto";
import { GenerationConfigurationV1, NarrationSubtitleSettingsSnapshot, SUBTITLE_STYLE_PRESET_REGISTRY_V1, DEFAULT_SUBTITLE_STYLE, applySubtitleStyleOverrides, canonicalStringify } from "../../../../shared/src/index.js";
/** 与生成时解析语义一致：未选预设时使用默认样式，不应用预设覆盖。 */
export function resolveNarrationSubtitleSettings(value: unknown): NarrationSubtitleSettingsSnapshot {
    const creative = GenerationConfigurationV1.parse(value).creative;
    const preset = creative.subtitle_style_preset_id === null ? null : SUBTITLE_STYLE_PRESET_REGISTRY_V1.find(p => p.preset_id === creative.subtitle_style_preset_id);
    if (preset === undefined)
        throw new Error("generation_creative_preset_unavailable");
    const overrides = preset ? creative.subtitle_style_overrides : {};
    if (preset && Object.keys(overrides).some(key => !preset.resolved_params.overridable_fields.includes(key as never)))
        throw new Error("generation_creative_subtitle_override_invalid");
    return NarrationSubtitleSettingsSnapshot.parse({ presetId: preset?.preset_id ?? null, presetVersion: preset?.preset_version ?? null,
        resolvedStyle: preset ? applySubtitleStyleOverrides(preset.resolved_params.style, overrides) : DEFAULT_SUBTITLE_STYLE, overrides,
        lineBreak: { strategy: "punctuation_and_length", maxCharactersPerLine: 18, version: "narration-lines/v1" }, resolverVersion: "creative-subtitle-resolver/v1" });
}
export function narrationSubtitleSettingsHash(settings: NarrationSubtitleSettingsSnapshot) {
    return createHash("sha256").update(canonicalStringify(NarrationSubtitleSettingsSnapshot.parse(settings))).digest("hex");
}
export function resolveNarrationSubtitleReadiness(input: {
    mode: string;
    configuration: unknown;
    record: import("../../../../shared/src/index.js").NarrationRecord | null;
    revision: import("../../../../shared/src/index.js").NarrationSubtitleRevision | null;
    target?: import("./narration-subtitle-target.js").NarrationSubtitleTarget | null;
}) {
    if (input.mode !== "narration_first_v1")
        return { ready: true, reason: null, subtitle_settings_hash: null };
    let hash: string | null = null;
    try {
        hash = narrationSubtitleSettingsHash(resolveNarrationSubtitleSettings(input.configuration));
    }
    catch { /* 不可解析配置不能伪装成当前字幕。 */ }
    const r = input.revision, n = input.record;
    const targetReady = !input.target || input.target.state === "ready" && input.target.settingsHash === hash && input.target.revisionId === input.revision?.id;
    const ready = targetReady && !!hash && !!r && !!n?.output && r.projectId === n.projectId && r.narrationRecordId === n.id && r.audioHash === n.output.audio.sha256 && r.timingHash === n.output.timingMap.sha256 && r.subtitleSettingsHash === hash && narrationSubtitleSettingsHash(r.subtitleSettingsSnapshotJson) === hash && r.builderVersion === 'narration-subtitles/v1';
    return { ready, reason: ready ? null : 'narration_subtitle_update_required', subtitle_settings_hash: hash };
}
