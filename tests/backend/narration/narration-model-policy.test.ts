import { describe, expect, it, vi } from "vitest";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { NarrationRecord } from "../../../shared/src/index.js";
import { NarrationRepository } from "../../../backend/src/modules/narration/narration.repository.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { upsertProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { bootstrapGenerationCostCatalog } from "../../../backend/src/modules/generation-cost/generation-cost-bootstrap.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy, resolveNarrationModelPolicy } from "../../../backend/src/modules/narration/narration-model-policy.js";
const modelId = "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus";
const voiceId = "voice_narration_qwen_longyimuling";
async function fixture() {
    const db = createDbClient();
    for (const m of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }))
        db.providerModelCatalog.set(m.id, m);
    await seedGlobalVoiceProfiles(db);
    return db;
}
describe("任务2B项目口播固定策略", () => {
    it("注册合格WS为非默认项，旧默认不变", async () => {
        const db = await fixture();
        expect(db.providerModelCatalog.get(modelId)).toMatchObject({ isDefault: false, status: "active", parameterCapabilitiesJson: { execution_protocol: "dashscope_ws", narration_only: true } });
        expect([...db.providerModelCatalog.values()].filter(m => m.capability === "tts.synthesize" && m.isDefault).map(m => m.modelId)).toEqual(["qwen3-tts-instruct-flash"]);
        expect(db.voiceProfiles.get(voiceId)?.target_model).toBe("qwen-audio-3.0-tts-plus");
    });
    it("新模式auto物化fixed模型和音色，用户偏好零写入", async () => {
        const db = await fixture();
        const project = await createProject(db, { name: "口播", ownerId: "u" });
        const cfg = [...db.projectGenerationConfigurations.values()][0];
        expect(project.narrationTimingMode).toBe("narration_first_v1");
        expect(cfg.configurationJson.capabilities["tts.synthesize"]).toEqual({ mode: "fixed", provider_model_id: modelId });
        expect(cfg.configurationJson.creative.voice_profile_id).toBe(voiceId);
        expect(cfg.configurationJson.narration_policy).toMatchObject({ selection_reason: "recommended_auto" });
        expect(db.userGenerationPreferences.size).toBe(0);
    });
});
describe("配置保存与策略生命周期", () => {
    it("新模式保存auto一次物化fixed并保留其它偏好", async () => {
        const db = await fixture();
        const project = await createProject(db, { name: "保存", ownerId: "u" });
        const input = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
        input.video.strategy = "prefer_api_video";
        const result = await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: 1, configuration: input }, "u");
        expect(result.ok).toBe(true);
        expect([...db.projectGenerationConfigurations.values()][0]).toMatchObject({ revision: 2, configurationJson: { capabilities: { "tts.synthesize": { mode: "fixed", provider_model_id: modelId } }, creative: { voice_profile_id: voiceId }, narration_policy: { policy_version: policy.policy_version, selection_reason: "recommended_auto" } } });
        expect(input.capabilities["tts.synthesize"]).toEqual({ mode: "auto" });
        expect(db.userGenerationPreferences.size).toBe(0);
    });
    it("fixed保留；不兼容保存及过期revision均保持旧配置", async () => {
        const db = await fixture();
        const project = await createProject(db, { name: "固定", ownerId: "u" });
        const current = [...db.projectGenerationConfigurations.values()][0];
        const fixed = structuredClone(current.configurationJson);
        const ok = await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: 1, configuration: fixed }, "u");
        expect(ok.ok).toBe(true);
        const before = structuredClone([...db.projectGenerationConfigurations.values()][0]);
        fixed.creative.voice_profile_id = "voice_system_ethan";
        expect(await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: 2, configuration: fixed }, "u")).toMatchObject({ ok: false, error: { code: "narration_selection_required" } });
        expect([...db.projectGenerationConfigurations.values()][0]).toEqual(before);
        expect(await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: 1, configuration: before.configurationJson }, "u")).toMatchObject({ ok: false, error: { code: "project_generation_configuration_revision_conflict" } });
        expect([...db.projectGenerationConfigurations.values()][0]).toEqual(before);
    });
    it("策略更新只影响显式解析，既有配置与历史音频引用不追改", async () => {
        const db = await fixture();
        const project = await createProject(db, { name: "历史", ownerId: "u" });
        const hash = "a".repeat(64), now = "2026-09-06T10:00:00.000Z";
        const ref = (file: string) => ({ uri: "narration-runs/history-run/" + file, sha256: hash });
        const history = NarrationRecord.parse({
            schemaVersion: "narration_record_v1", id: "history-audio", projectId: project.id, scriptRecordId: "script",
            generationRunId: "history-run", configurationSnapshotId: "snapshot", createdAt: now, updatedAt: now,
            sourceTextSha256: hash, spokenTextSha256: hash, settingsSha256: hash, sourceProjectTtsSettingsSha256: hash,
            textMappingVersion: "narration-native-spans/v1", timingSource: "provider_native", providerTaskId: "task", providerRequestId: "request",
            status: "ready", errorCode: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null,
            settings: { model: "qwen-audio-3.0-tts-plus", voice: "qwen-audio-3.0-tts-plus-longyimuling", region: "cn-beijing", protocol: "dashscope_ws", parametersVersion: "neutral-pcm24k-v1", tone: "neutral", rate: 1, pitch: 1, volume: 50, sampleRate: 24000, format: "pcm", textType: "PlainText", wordTimestampEnabled: true, enableSsml: false, seed: 0, inputMode: "natural_paragraphs_single_task" },
            output: { audio: { ...ref("audio.wav"), sampleRate: 24000, channels: 1, bitDepth: 16, sampleCount: 24000 }, durationMs: 1000, nativeEvents: ref("native.json"), timingMap: ref("timing.json"), initialSubtitleRevisionId: "subtitle", validationReport: { status: "pass", validatorVersion: "v1", checkedAt: now, nativeTextCoverageComplete: true, nativeTimingValid: true, audioProbeValid: true, issues: [] } },
        });
        db.narrationRecords.set(history.id, history);
        project.activeNarrationRecordId = history.id;
        const before = structuredClone([...db.projectGenerationConfigurations.values()][0]);
        const next = resolveNarrationModelPolicy({ configuration: DEFAULT_GENERATION_CONFIGURATION, catalog: db.providerModelCatalog.values(), voices: db.voiceProfiles.values(), policy: { ...policy, policy_version: "future-v2" } });
        expect(next.narration_policy?.policy_version).toBe("future-v2");
        expect([...db.projectGenerationConfigurations.values()][0]).toEqual(before);
        db.providerModelCatalog.get(modelId)!.status = "disabled";
        expect(() => resolveNarrationModelPolicy({ configuration: before.configurationJson, catalog: db.providerModelCatalog.values(), voices: db.voiceProfiles.values() })).toThrow("narration_selection_required");
        expect((await new NarrationRepository(db).findByIdForOwner(project.id, "u", history.id))?.output?.audio).toEqual(history.output!.audio);
        expect(project.activeNarrationRecordId).toBe("history-audio");
        expect([...db.projectGenerationConfigurations.values()][0]).toEqual(before);
    });
    it.each(["removed", "deleted", "missing", "identity_changed"])("音色生命周期%s不换音色", async (state) => {
        const db = await fixture();
        const original = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
        if (state === "removed")
            db.voiceProfiles.delete(voiceId);
        else if (state === "identity_changed")
            db.voiceProfiles.get(voiceId)!.provider_voice_id = "another";
        else
            db.voiceProfiles.get(voiceId)!.provider_status = state as "deleted" | "missing";
        expect(() => resolveNarrationModelPolicy({ configuration: original, catalog: db.providerModelCatalog.values(), voices: db.voiceProfiles.values() })).toThrow("narration_selection_required");
        expect(original).toEqual(DEFAULT_GENERATION_CONFIGURATION);
    });
});
function bootInput(scope: "cn-beijing" | "singapore" | "unknown", credentialConfigured = true) { return { llm: { mode: "stub" as const }, media: { deploymentScope: scope, credentialConfigured, registeredModels: [{ capability: "tts.synthesize" as const, providerKey: "dashscope", modelId: "qwen3-tts-instruct-flash" }] }, environment: { testEnv: false } }; }
describe("真实bootstrap独立WS目录", () => {
    it("北京保留合格非默认WS，但旧HTTP readiness仍拒绝派发", async () => {
        const db = createDbClient();
        const result = await bootstrapGenerationCostCatalog(db, bootInput("cn-beijing"));
        expect(db.providerModelCatalog.get(modelId)?.status).toBe("active");
        expect(result.readiness.items[modelId]).toMatchObject({ realDispatchAllowed: false });
        expect(result.disabledProviderModelIds).not.toContain(modelId);
    });
    it("区域切换/缺凭据禁用，返回北京恢复，重排不改变结果", async () => {
        const db = createDbClient();
        await bootstrapGenerationCostCatalog(db, bootInput("cn-beijing"));
        for (const scope of ["singapore", "unknown"] as const) {
            await bootstrapGenerationCostCatalog(db, bootInput(scope));
            expect(db.providerModelCatalog.get(modelId)?.status).toBe("disabled");
        }
        await bootstrapGenerationCostCatalog(db, bootInput("cn-beijing", false));
        expect(db.providerModelCatalog.get(modelId)?.status).toBe("disabled");
        db.providerModelCatalog = new Map([...db.providerModelCatalog].reverse());
        await bootstrapGenerationCostCatalog(db, bootInput("cn-beijing"));
        expect(db.providerModelCatalog.get(modelId)?.status).toBe("active");
    });
});
it("未合格narration_only条目不能因标记而获得bootstrap豁免", async () => {
    const db = await fixture();
    const model = db.providerModelCatalog.get(modelId)!;
    const rogue = { ...model, id: "unqualified-ws", modelId: "unqualified-model" };
    db.providerModelCatalog.set(rogue.id, rogue);
    await bootstrapGenerationCostCatalog(db, bootInput("cn-beijing"));
    expect(db.providerModelCatalog.get(rogue.id)?.status).toBe("disabled");
    expect(db.providerModelCatalog.get(modelId)?.status).toBe("active");
});
it.each([false, true])("重复与重排目录不能替代正式fixed身份：reverse=%s", async (reverse) => {
    const db = await fixture();
    const official = db.providerModelCatalog.get(modelId)!;
    db.providerModelCatalog.set("duplicate", { ...official, id: "duplicate", status: "active" });
    official.status = "disabled";
    if (reverse)
        db.providerModelCatalog = new Map([...db.providerModelCatalog].reverse());
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    expect(() => resolveNarrationModelPolicy({ configuration, catalog: db.providerModelCatalog.values(), voices: db.voiceProfiles.values() })).toThrow("narration_selection_required");
    configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: "duplicate" };
    expect(() => resolveNarrationModelPolicy({ configuration, catalog: db.providerModelCatalog.values(), voices: db.voiceProfiles.values() })).toThrow("narration_selection_required");
});
it("移除再重建模型沿用冻结配置身份，不追改项目", async () => {
    const db = await fixture();
    const project = await createProject(db, { name: "移除", ownerId: "u" });
    const config = structuredClone([...db.projectGenerationConfigurations.values()][0]);
    const original = db.providerModelCatalog.get(modelId)!;
    db.providerModelCatalog.delete(modelId);
    await expect(createProject(db, { name: "不可创建", ownerId: "u" })).rejects.toThrow("narration_selection_required");
    db.providerModelCatalog.set(modelId, { ...original });
    const next = await createProject(db, { name: "恢复创建", ownerId: "u" });
    expect(next.narrationTimingMode).toBe("narration_first_v1");
    expect(db.projects.get(project.id)?.narrationTimingMode).toBe("narration_first_v1");
    expect(db.projectGenerationConfigurations.get(config.id)).toEqual(config);
});
it.each(["model_disabled", "model_missing", "voice_missing"])("错误选项排除当前不可用%s", async (state) => {
    const db = await fixture();
    if (state === "model_disabled")
        db.providerModelCatalog.get(modelId)!.status = "disabled";
    if (state === "model_missing")
        db.providerModelCatalog.delete(modelId);
    if (state === "voice_missing")
        db.voiceProfiles.delete(voiceId);
    let error: unknown;
    try {
        resolveNarrationModelPolicy({ configuration: DEFAULT_GENERATION_CONFIGURATION, catalog: db.providerModelCatalog.values(), voices: db.voiceProfiles.values() });
    }
    catch (e) {
        error = e;
    }
    expect(error).toMatchObject({ body: { error: "narration_selection_required", options: [] } });
});
it("owner不可见的正式私有档案不出现在创建错误选项", async () => {
    const db = await fixture();
    const voice = db.voiceProfiles.get(voiceId)!;
    Object.assign(voice, { kind: "generated", visibility: "private", owner_id: "other" });
    await expect(createProject(db, { name: "不可见", ownerId: "u" })).rejects.toMatchObject({ body: { options: [] } });
    expect(db.projects.size).toBe(0);
});
