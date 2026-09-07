import { hasPassingNarrationScriptValidation } from "./narration-readiness.js";
import { z } from "zod";
import type { AppInstance } from "../../app.js";
import type { ProjectRecord, GenerationRunRecord } from "../../db/client.js";
import { GenerateNarrationRequest, ConfirmNarrationRequest, NarrationRecord, QualifiedNarrationSettings, ResolvedGenerationConfigurationV1Schema, NarrationSubtitleSettingsSnapshot, DEFAULT_SUBTITLE_STYLE, hashNarrationSettings, hashProjectNarrationTtsSettings, canonicalStringify } from "../../../../shared/src/index.js";
import { NarrationRepository } from "./narration.repository.js";
import { narrationTextHash, settingsFromResolvedNarration } from "./narration-readiness.js";
import { NarrationBundleStorage } from "./narration-bundle-storage.js";
import { resolveProjectStorageRoot } from "../../db/repositories/prisma-first-aggregate-hydrator.js";
import { resolveQuoteConfiguration } from "../generation-cost/generation-cost.service.js";
import { createOrRestoreGenerationRun } from "../generation-run/generation-run.service.js";
import { getVoiceProfileById } from "../assets/voice/voice-profile.repository.js";
import { assertNarrationExecutionCompatibility } from "./narration-execution-compatibility.js";
import { parseNarrationSpeechRequest } from "./providers/dashscope-speech-ws-client.js";
export const NarrationDispatchPayload = z.object({
    narration_record_id: z.string().min(1), source_script_record_id: z.string().min(1), source_text_sha256: z.string().regex(/^[0-9a-f]{64}$/), source_text: z.string(),
    source_project_tts_settings_sha256: z.string().regex(/^[0-9a-f]{64}$/), settings_sha256: z.string().regex(/^[0-9a-f]{64}$/), settings: QualifiedNarrationSettings,
    subtitle_settings: NarrationSubtitleSettingsSnapshot, owner_id: z.string().min(1), provider_request_key: z.string().min(1), pricing: z.object({ provider_model_id: z.string(), pricing_version: z.string(), price_micros_per_10k_characters: z.string().regex(/^\d+$/).nullable() }).strict(),
}).strict();
export function narrationStorage(app: Pick<AppInstance, "storageBaseDir">, project: Awaited<ReturnType<NarrationRepository["sourceContext"]>>["project"]) {
    const storageRootDir = "storageRootDir" in project ? project.storageRootDir : resolveProjectStorageRoot({ storageRoot: app.storageBaseDir, createdAt: project.createdAt, displayName: project.storageDisplayName, shortId: "p_" + project.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8).padEnd(8, "0"), storageKey: project.storageKey });
    return new NarrationBundleStorage({ projectId: project.id, storageRootDir });
}
export async function prepareNarrationRun(app: AppInstance, projectId: string, ownerId: string, actorId: string, request: GenerateNarrationRequest) {
    const repository = new NarrationRepository(app.db), source = await repository.sourceContext(projectId, ownerId);
    if (source.project.narrationTimingMode !== "narration_first_v1")
        throw new Error("narration_mode_unavailable");
    if (!source.script || source.script.id !== request.source_script_record_id || source.script.projectId !== projectId)
        throw new Error("narration_source_conflict");
    const sourceHash = narrationTextHash(source.script.scriptText);
    if (!source.confirmation || source.confirmation.sourceTextSha256 !== sourceHash || !hasPassingNarrationScriptValidation(source.script.validationResultJson))
        throw new Error("script_not_confirmed");
    if (source.configuration?.revision !== request.expected_configuration_revision)
        throw new Error("narration_configuration_conflict");
    const projectionHash = await hashProjectNarrationTtsSettings(source.configuration.configurationJson);
    const resolution = await resolveQuoteConfiguration(app.db, source.project as ProjectRecord, { operation: "script.narration.generate", runOverrides: { creative: { narration: request.settings_override ?? {} } } }, app.prismaClient);
    if (!resolution.ok)
        throw new Error("narration_execution_incompatible");
    const resolved = resolution.value.resolved, selected = resolved.resolved_capabilities["tts.synthesize"], model = resolution.value.source.catalog.find(m => m.id === selected.provider_model_id);
    const voice = await getVoiceProfileById(app.db, resolved.resolved_creative.voice.voice_profile_id ?? "", { ownerId });
    const settings = settingsFromResolvedNarration(resolved, voice?.provider_voice_id);
    assertNarrationExecutionCompatibility({ catalog: resolution.value.source.catalog, projectMode: source.project.narrationTimingMode, operation: "script.narration.generate", model, voice, settings, modelId: selected.model_id, providerKey: selected.provider_key, deploymentScope: settings.region });
    parseNarrationSpeechRequest({ sourceText: source.script.scriptText, settings });
    const subtitle = resolved.resolved_creative.subtitle;
    const subtitleSettings = NarrationSubtitleSettingsSnapshot.parse({ presetId: subtitle.preset_id, presetVersion: subtitle.preset_version, resolvedStyle: subtitle.resolved_style ?? DEFAULT_SUBTITLE_STYLE, overrides: subtitle.applied_overrides, lineBreak: { strategy: "punctuation_and_length", maxCharactersPerLine: 18, version: "narration-lines/v1" }, resolverVersion: "creative-subtitle-resolver/v1" });
    const recordId = app.db.generateId(), settingsHash = await hashNarrationSettings(settings);
    const price = model?.pricingJson as {
        price_micros_per_10k_characters?: unknown;
        unpriced?: boolean;
    } | undefined;
    const payload = NarrationDispatchPayload.parse({ narration_record_id: recordId, source_script_record_id: source.script.id, source_text_sha256: sourceHash, source_text: source.script.scriptText, source_project_tts_settings_sha256: projectionHash, settings_sha256: settingsHash, settings, subtitle_settings: subtitleSettings, owner_id: ownerId, provider_request_key: "narration:" + recordId, pricing: { provider_model_id: selected.provider_model_id, pricing_version: model!.pricingVersion, price_micros_per_10k_characters: price?.unpriced !== true && typeof price?.price_micros_per_10k_characters === "string" ? price.price_micros_per_10k_characters : null } });
    const result = await createOrRestoreGenerationRun(app.db, source.project as ProjectRecord, actorId, { operation: "script.narration.generate", idempotencyKey: request.idempotency_key, narrationExpectedConfigurationRevision: request.expected_configuration_revision, narration: { source_script_record_id: source.script.id, source_text_sha256: sourceHash, source_project_tts_settings_sha256: projectionHash, settings_override: request.settings_override ?? {}, projection_version: "narration-tts-projection/v1" }, dispatchPayload: payload }, { repository: app.generationRunRepository, prismaClient: app.prismaClient });
    if (!result.ok)
        throw new Error(result.error.code === "generation_run_resolution_failed" && ["project_scope_denied", "narration_source_conflict", "narration_configuration_conflict", "narration_execution_incompatible"].includes(result.error.message) ? result.error.message : result.error.code);
    const frozen = NarrationDispatchPayload.parse(result.value.run.dispatchPayloadJson);
    const actual = ResolvedGenerationConfigurationV1Schema.parse(result.value.snapshot.resolvedConfigurationJson);
    if (canonicalStringify(settingsFromResolvedNarration(actual, frozen.settings.voice)) !== canonicalStringify(frozen.settings))
        throw new Error("narration_snapshot_conflict");
    const record = await ensureNarrationCandidate(app, result.value.run);
    return { ...result.value, record };
}
export async function ensureNarrationCandidate(app: Pick<AppInstance, "db" | "generationRunRepository">, run: GenerationRunRecord) {
    const payload = NarrationDispatchPayload.parse(run.dispatchPayloadJson), repo = new NarrationRepository(app.db);
    const existing = await repo.findForRunForOwner(run.projectId, payload.owner_id, payload.source_script_record_id, run.id);
    if (existing)
        return existing;
    const now = run.createdAt.toISOString();
    const record = NarrationRecord.parse({ schemaVersion: "narration_record_v1", id: payload.narration_record_id, projectId: run.projectId, scriptRecordId: payload.source_script_record_id, generationRunId: run.id, configurationSnapshotId: run.runConfigurationSnapshotId, sourceTextSha256: payload.source_text_sha256, spokenTextSha256: null, settingsSha256: payload.settings_sha256, sourceProjectTtsSettingsSha256: payload.source_project_tts_settings_sha256, textMappingVersion: "narration-native-spans/v1", settings: payload.settings, timingSource: "provider_native", providerTaskId: null, providerRequestId: null, status: "generating", errorCode: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null, output: null, createdAt: now, updatedAt: now });
    try {
        return await repo.createCandidate(payload.owner_id, record);
    }
    catch (error) {
        const found = await repo.findForRunForOwner(run.projectId, payload.owner_id, payload.source_script_record_id, run.id);
        if (found)
            return found;
        throw error;
    }
}
export async function confirmNarration(app: AppInstance, projectId: string, ownerId: string, actorId: string, id: string, request: ConfirmNarrationRequest) {
    const repo = new NarrationRepository(app.db), record = await repo.findByIdForOwner(projectId, ownerId, id);
    if (!record)
        throw new Error("narration_not_found");
    const source = await repo.sourceContext(projectId, ownerId);
    const recovered = await narrationStorage(app, source.project).recoverInitial({ record });
    if (recovered.status !== "complete")
        throw new Error("narration_timing_invalid");
    return repo.confirm(ownerId, actorId, projectId, record, request);
}
