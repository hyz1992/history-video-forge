import { runAssetsGeneration } from "../../../backend/src/modules/assets/assets-run.service.js";
import * as providerVoiceResolution from "../../../backend/src/modules/assets/voice/provider-voice-resolution.service.js";
import { checkNarrationExecutionCompatibility } from "../../../backend/src/modules/narration/narration-execution-compatibility.js";
import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { resolveCreativeVoiceForExecution } from "../../../backend/src/modules/assets/voice/creative-voice-execution.js";
import { evaluateGenerationCapabilityReadiness } from "../../../backend/src/modules/generation-cost/generation-capability-readiness.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbClient, type DbClient } from "../../../backend/src/db/client.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { resolveVoiceProfile } from "../../../backend/src/modules/assets/voice/voice-resolution.service.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { executeVoicePreview } from "../../../backend/src/modules/assets/voice/voice-preview.service.js";
import { checkProviderDispatchGate } from "../../../backend/src/modules/generation-cost/provider-dispatch-gate.js";
import { createDashscopeTtsProvider } from "../../../backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.js";
import { listPublicGenerationCapabilities, upsertProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { DEFAULT_GENERATION_CONFIGURATION, type AssetPlan, type VoiceProfile } from "../../../shared/src/index.js";
const wsModel = "qwen-audio-3.0-tts-plus";
const wsVoice = "qwen-audio-3.0-tts-plus-longyimuling";
const plan = { global_audio_strategy: {}, tts_plan: { chunks: [{
        chunk_id: "one", script_excerpt: "殿中无人敢动。", estimated_duration_sec: 3
      }] } } as AssetPlan;
function catalog(db: DbClient) {
  const old = buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }).find(e => e.capability === "tts.synthesize")!;
  db.providerModelCatalog.set(old.id, old);
  return old;
}
function upgrade(db: DbClient) {
  const old = catalog(db);
  const ws = {
    ...old, id: "simulated-ws", modelId: wsModel, isDefault: false,
    parameterCapabilitiesJson: {
      deployment_scope: "cn-beijing", execution_protocol: "dashscope_ws", narration_only: true
    }
  };
  db.providerModelCatalog.set(ws.id, ws);
  return ws;
}
async function voices(db: DbClient) {
  await seedGlobalVoiceProfiles(db);
  const selected = await resolveVoiceProfile({
    db, requestedVoiceProfileId: "", assetPlan: plan
  });
  const old = db.voiceProfiles.get(selected.voiceProfileId)!;
  const ws: VoiceProfile = {
    ...old, voice_profile_id: "000_ws_simulated", target_model: wsModel, provider_voice_id: wsVoice, provider_status: "ready", usage_count: 0, preview_audio_uri: null
  };
  return { old, ws };
}
const external = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", external.mockReset().mockResolvedValue({
  ok: true, status: 200, json: async () => ({ output: { audio: { url: "https://example.invalid/audio" } } }), arrayBuffer: async () => new ArrayBuffer(8)
})); vi.stubEnv("ALIYUN_DASHSCOPE_API_KEY", "mock-key"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("任务2A legacy协议边界", () => {
  it("upgraded：同traits新增WS音色不得改变legacy auto的选择和评分", async () => {
    const db = createDbClient();
    catalog(db);
    const { old, ws } = await voices(db);
    const before = await resolveVoiceProfile({
      db, requestedVoiceProfileId: "", assetPlan: plan
    });
    upgrade(db);
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    const after = await resolveVoiceProfile({
      db, requestedVoiceProfileId: "", assetPlan: plan
    });
    expect(after).toEqual(before);
    expect(after.voiceProfileId).toBe(old.voice_profile_id);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("legacy fixed WS voice拒绝而不fallback、不记录usage", async () => {
    const db = createDbClient();
    upgrade(db);
    const { ws } = await voices(db);
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    await expect(resolveVoiceProfile({
      db, requestedVoiceProfileId: ws.voice_profile_id, assetPlan: plan
    })).rejects.toThrow("narration_execution_incompatible");
    expect(db.voiceProfiles.get(ws.voice_profile_id)?.usage_count).toBe(0);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it.each(["model", "voice"])("旧试听%s指向WS时在任何设计和合成外呼前拒绝", async (kind) => {
    const db = createDbClient();
    upgrade(db);
    const { old, ws } = await voices(db);
    old.provider_status = "ready";
    old.provider_voice_id = "legacy-provider-voice";
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    await expect(executeVoicePreview({
      db, voiceProfileId: kind === "voice" ? ws.voice_profile_id : old.voice_profile_id, synthesisModel: kind === "model" ? wsModel : "qwen3-tts-instruct-flash"
    })).rejects.toThrow("narration_execution_incompatible");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("recovered：停用WS目录后已有缓存仍可读，清缓存后拒绝而不替换", async () => {
    const db = createDbClient();
    const entry = upgrade(db);
    const { ws } = await voices(db);
    ws.preview_audio_uri = "data:audio/wav;base64,Y2FjaGU=";
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    entry.status = "disabled";
    expect(await executeVoicePreview({
      db, voiceProfileId: ws.voice_profile_id, synthesisModel: wsModel
    })).toMatchObject({
      source: "cached", usedRealProvider: false, preview_audio_uri: ws.preview_audio_uri
    });
    ws.preview_audio_uri = null;
    await expect(executeVoicePreview({
      db, voiceProfileId: ws.voice_profile_id, synthesisModel: wsModel
    })).rejects.toThrow("narration_execution_incompatible");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("过期snapshot旧model + 实际WS voice target不能进入HTTP adapter", async () => {
    const db = createDbClient();
    upgrade(db);
    const { ws } = await voices(db);
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    const adapter = createDashscopeTtsProvider({
      db, apiKey: "mock", model: "qwen3-tts-instruct-flash"
    });
    const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: ws.voice_profile_id } } } as Parameters<typeof adapter.submit>[0];
    const prepared = await adapter.prepare(ctx);
    await expect(adapter.submit(ctx, prepared)).rejects.toThrow("narration_execution_incompatible");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("注册目录不应允许旧dispatch gate派发WS模型", () => {
    const db = createDbClient();
    upgrade(db);
    expect(checkProviderDispatchGate(db, {
      capability: "tts.synthesize", providerKey: "dashscope", modelId: wsModel, deploymentScope: "cn-beijing"
    })).toMatchObject({ allowed: false, reason_code: "catalog_entry_execution_incompatible" });
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("legacy项目配置显式保存WS模型失败，revision与配置不动", async () => {
    const db = createDbClient();
    const ws = upgrade(db);
    const project = await createProject(db, { name: "compat", ownerId: "owner" });
    const config = [...db.projectGenerationConfigurations.values()].find(c => c.projectId === project.id)!;
    const before = structuredClone(config);
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: ws.id };
    expect(await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: config.revision, configuration }, "owner")).toMatchObject({ ok: false, error: { code: "narration_execution_incompatible" } });
    expect(db.projectGenerationConfigurations.get(config.id)).toEqual(before);
    expect(external).toHaveBeenCalledTimes(0);
  });
});
describe("项目和目录入口", () => {
  it("项目目录按DB权威mode过滤，全局目录保留适用范围，越权拒绝", async () => {
    const app = buildApp();
    const ws = upgrade(app.db);
    const project = await createProject(app.db, { name: "mode", ownerId: "owner" });
    const auth = buildTestAuth({ userId: "owner" });
    const global = await app.inject({
      method: "GET", url: "/api/generation-capabilities", auth
    });
    expect(global.statusCode).toBe(200);
    expect(global.json().capabilities.find((e: any) => e.id === ws.id)?.parameter_capabilities).toEqual(ws.parameterCapabilitiesJson);
    const legacy = await app.inject({
      method: "GET", url: "/api/generation-capabilities?project_id=" + project.id, auth
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().capabilities.some((e: any) => e.id === ws.id)).toBe(false);
    app.db.narrationPersistence.prismaClient = { project: { findFirst: vi.fn().mockResolvedValue({ ...project, narrationTimingMode: "narration_first_v1" }) } } as never;
    const current = await app.inject({
      method: "GET", url: "/api/generation-capabilities?project_id=" + project.id, auth
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().capabilities.filter((e: any) => e.capability === "tts.synthesize").map((e: any) => e.id)).toEqual([ws.id]);
    app.db.narrationPersistence.prismaClient = { project: { findFirst: vi.fn().mockResolvedValue(null) } } as never;
    expect((await app.inject({
      method: "GET", url: "/api/generation-capabilities?project_id=" + project.id, auth
    })).statusCode).toBe(404);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("creative入口auto音色也不能忽略显式WS模型", async () => {
    const db = createDbClient();
    const ws = upgrade(db);
    const project = await createProject(db, { name: "mode", ownerId: "owner" });
    const config = [...db.projectGenerationConfigurations.values()].find(c => c.projectId === project.id)!;
    config.configurationJson.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: ws.id };
    await expect(resolveCreativeVoiceForExecution(db, project)).rejects.toThrow("narration_execution_incompatible");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("已删除fixed WS音色禁止静默fallback", async () => {
    const db = createDbClient();
    upgrade(db);
    const { ws } = await voices(db);
    ws.provider_status = "deleted";
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    await expect(resolveVoiceProfile({
      db, requestedVoiceProfileId: ws.voice_profile_id, assetPlan: plan
    })).rejects.toThrow("generation_creative_voice_profile_unavailable");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("readiness：注册同model的旧HTTP能力并不表示支持WS协议", () => {
    const db = createDbClient();
    const ws = upgrade(db);
    const result = evaluateGenerationCapabilityReadiness({
      catalog: [...db.providerModelCatalog.values()], llm: { mode: "stub" }, media: {
        registeredModels: [...db.providerModelCatalog.values()].map(e => ({
          capability: "tts.synthesize", providerKey: e.providerKey, modelId: e.modelId
        })), credentialConfigured: true, deploymentScope: "cn-beijing"
      }, environment: { testEnv: false }
    });
    expect(result.items[ws.id]).toMatchObject({ realDispatchAllowed: false, issues: expect.arrayContaining(["media_execution_protocol_incompatible"]) });
    expect(external).toHaveBeenCalledTimes(0);
  });
});
const settings = {
  model: wsModel, voice: wsVoice, region: "cn-beijing", protocol: "dashscope_ws", parametersVersion: "neutral-pcm24k-v1", tone: "neutral", rate: 1, pitch: 1, volume: 50, sampleRate: 24000, format: "pcm", textType: "PlainText", wordTimestampEnabled: true, enableSsml: false, seed: 0, inputMode: "natural_paragraphs_single_task"
};
describe("完整资格及生命周期", () => {
  it.each(["missing", "creating", "failed"] as const)("未ready WS档案%s必须在设计外呼前拒绝", async (status) => {
    const db = createDbClient();
    upgrade(db);
    const { ws } = await voices(db);
    ws.provider_status = status;
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    await expect(executeVoicePreview({ db, voiceProfileId: ws.voice_profile_id })).rejects.toThrow("narration_execution_incompatible");
    const adapter = createDashscopeTtsProvider({
      db, apiKey: "mock", model: "qwen3-tts-instruct-flash"
    });
    const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: ws.voice_profile_id } } } as Parameters<typeof adapter.submit>[0];
    await expect(adapter.submit(ctx, await adapter.prepare(ctx))).rejects.toThrow("narration_execution_incompatible");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("switched+duplicated+reordered：旧同model有效区域行顺序不改变允许结果", () => {
    const db = createDbClient();
    const old = catalog(db);
    const bj = { ...old, status: "disabled" as const };
    const sg = {
      ...old, id: "sg", parameterCapabilitiesJson: { deployment_scope: "singapore" }
    };
    const check = (scope: string) => checkProviderDispatchGate(db, {
      capability: "tts.synthesize", providerKey: old.providerKey, modelId: old.modelId, deploymentScope: scope
    });
    db.providerModelCatalog.set(old.id, bj);
    db.providerModelCatalog.set(sg.id, sg);
    expect(check("singapore")).toEqual({ allowed: true });
    sg.status = "disabled";
    bj.status = "active" as never;
    expect(check("cn-beijing")).toEqual({ allowed: true });
    db.providerModelCatalog = new Map([...db.providerModelCatalog].reverse());
    expect(check("cn-beijing")).toEqual({ allowed: true });
    expect(check("singapore").allowed).toBe(false);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it.each([false, true])("duplicated/reordered WS声明不能被同model无标记旧行覆盖：reverse=%s", (reverse) => {
    const db = createDbClient();
    const old = catalog(db);
    const ws = upgrade(db);
    ws.modelId = "future-ws-model";
    ws.status = "disabled";
    const stale = {
      ...old, id: "stale-ws", modelId: ws.modelId
    };
    db.providerModelCatalog.set(stale.id, stale);
    if (reverse)
      db.providerModelCatalog = new Map([...db.providerModelCatalog].reverse());
    expect(checkProviderDispatchGate(db, {
      capability: "tts.synthesize", providerKey: "dashscope", modelId: ws.modelId, deploymentScope: "cn-beijing"
    })).toMatchObject({ allowed: false, reason_code: "catalog_entry_execution_incompatible" });
    expect(external).toHaveBeenCalledTimes(0);
  });
  it.each([{ narration_only: "true", execution_protocol: "dashscope_ws" }, { narration_only: true, execution_protocol: null }, { narration_only: "true", execution_protocol: 42 }])("损坏协议声明仍不能按历史无标记放行：%j", (meta) => {
    const db = createDbClient();
    const ws = upgrade(db);
    ws.modelId = "future-ws-model";
    ws.parameterCapabilitiesJson = { deployment_scope: "cn-beijing", ...meta };
    expect(checkProviderDispatchGate(db, {
      capability: "tts.synthesize", providerKey: "dashscope", modelId: ws.modelId, deploymentScope: "cn-beijing"
    }).allowed).toBe(false);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("完整资格仅允许新模式口播操作；旧操作不会因项目升级获得WS权限", async () => {
    const db = createDbClient();
    const model = upgrade(db);
    const { ws: voice } = await voices(db);
    const input = {
      catalog: db.providerModelCatalog.values(), projectMode: "narration_first_v1" as const, operation: "script.narration.generate" as const, model, voice, modelId: wsModel, providerKey: "dashscope", actualVoiceTarget: wsModel, actualProviderVoiceId: wsVoice, deploymentScope: "cn-beijing", settings
    };
    const check = (patch: Record<string, unknown> = {}) => checkNarrationExecutionCompatibility({
      ...input, catalog: db.providerModelCatalog.values(), ...patch
    });
    expect(check()).toEqual({ compatible: true });
    for (const patch of [{ projectMode: "legacy_estimated" }, { operation: "voice.preview" }, { operation: "assets.generate" }, { actualVoiceTarget: "qwen3-tts-instruct-flash" }, { actualProviderVoiceId: "unqualified" }, { actualProviderVoiceId: "" }, { deploymentScope: "singapore" }, { settings: { ...settings, rate: 1.1 } }, { settings: { ...settings, enableSsml: true } }, { voice: { ...voice, provider_voice_id: "unqualified" } }, { model: { ...model, status: "disabled" } }, { model: { ...model, parameterCapabilitiesJson: { deployment_scope: "cn-beijing" } } }])
      expect(check(patch).compatible).toBe(false);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("switched：新模式保存只接受固定合格组合，停用后拒绝且不改原配置", async () => {
    const db = createDbClient();
    // 任务2B固定策略绑定正式目录/profile身份；保留停用与协议拒绝断言。
    catalog(db);
    const model = buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }).find(m => m.modelId === wsModel)!;
    db.providerModelCatalog.set(model.id, model);
    await seedGlobalVoiceProfiles(db);
    const ws = db.voiceProfiles.get("voice_narration_qwen_longyimuling")!;
    db.voiceProfiles.set(ws.voice_profile_id, ws);
    const project = await createProject(db, { name: "new", ownerId: "owner" });
    project.narrationTimingMode = "narration_first_v1";
    let config = [...db.projectGenerationConfigurations.values()].find(c => c.projectId === project.id)!;
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: model.id };
    configuration.creative.voice_profile_id = ws.voice_profile_id;
    expect((await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: config.revision, configuration }, "owner")).ok).toBe(true);
    config = db.projectGenerationConfigurations.get(config.id)!;
    const before = structuredClone(config);
    model.status = "disabled";
    expect((await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: config.revision, configuration }, "owner")).ok).toBe(false);
    expect(db.projectGenerationConfigurations.get(config.id)).toEqual(before);
    configuration.capabilities["tts.synthesize"] = { mode: "auto" };
    expect((await upsertProjectGenerationConfiguration(db, project.id, { expected_revision: config.revision, configuration }, "owner")).ok).toBe(false);
    expect(external).toHaveBeenCalledTimes(0);
  });
  it("无标记历史voice target仍走旧HTTP成功语义，与snapshot model无需相等", async () => {
    const db = createDbClient();
    catalog(db);
    const { old } = await voices(db);
    old.provider_status = "ready";
    old.provider_voice_id = "legacy-provider-voice";
    const result = await executeVoicePreview({
      db, voiceProfileId: old.voice_profile_id, synthesisModel: "qwen3-tts-instruct-flash"
    });
    expect(result.usedRealProvider).toBe(true);
    expect(JSON.parse(external.mock.calls[0][1].body).model).toBe("qwen3-tts-instruct-flash");
    external.mockClear();
    const adapter = createDashscopeTtsProvider({
      db, apiKey: "mock", model: "qwen3-tts-instruct-flash"
    });
    const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: old.voice_profile_id } } } as Parameters<typeof adapter.submit>[0];
    await adapter.submit(ctx, await adapter.prepare(ctx));
    expect(JSON.parse(external.mock.calls[0][1].body).model).toBe(old.target_model);
    expect(external).toHaveBeenCalledTimes(1);
  });
});
it("assets service在创建manifest或provider之前拒绝WS运行快照", async () => {
  const db = createDbClient();
  const ws = upgrade(db);
  const project = await createProject(db, { name: "snapshot", ownerId: "owner" });
  const result = await runAssetsGeneration({
    db, project, voiceProfileId: "", executionMode: "dry_run", resolvedCapabilities: { "tts.synthesize": {
        provider_model_id: ws.id, provider_key: "dashscope", model_id: wsModel
      } } as never
  });
  expect(result).toMatchObject({ statusCode: 422, body: { error: "narration_execution_incompatible" } });
  expect(db.assetManifestRecords.size).toBe(0);
  expect(external).toHaveBeenCalledTimes(0);
});
it.each(["preview", "adapter"])("解析后实际voice target改变时%s仍拒绝HTTP外呼", async (kind) => {
  const db = createDbClient();
  upgrade(db);
  const { old } = await voices(db);
  const resolve = vi.spyOn(providerVoiceResolution, "resolveProviderVoice").mockResolvedValue({
    localVoiceProfileId: old.voice_profile_id, providerVoiceId: wsVoice, targetModel: wsModel, matchScore: null, matchReasons: []
  });
  if (kind === "preview")
    await expect(executeVoicePreview({ db, voiceProfileId: old.voice_profile_id })).rejects.toThrow("narration_execution_incompatible");
  else {
    const adapter = createDashscopeTtsProvider({
      db, apiKey: "mock", model: "qwen3-tts-instruct-flash"
    });
    const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: old.voice_profile_id } } } as Parameters<typeof adapter.submit>[0];
    await expect(adapter.submit(ctx, await adapter.prepare(ctx))).rejects.toThrow("narration_execution_incompatible");
  }
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(external).toHaveBeenCalledTimes(0);
});

it("WS供应商音色ID不能借错误的legacy target伪装旧音色", async () => {
 const db = createDbClient(); upgrade(db); const {ws} = await voices(db);
 ws.target_model = "qwen3-tts-instruct-flash"; db.voiceProfiles.set(ws.voice_profile_id, ws);
 await expect(executeVoicePreview({db, voiceProfileId:ws.voice_profile_id})).rejects.toThrow("narration_execution_incompatible");
 expect(external).toHaveBeenCalledTimes(0);
});

// F1：最终发送身份必须参与兼容检查，不能只信任上次读取的档案。
describe("F1 实际HTTP发送身份", () => {
  it("无db时WS供应商音色不能借legacy model进入HTTP", async () => {
    const adapter = createDashscopeTtsProvider({ apiKey: "mock", model: "qwen3-tts-instruct-flash" });
    const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: wsVoice } } } as Parameters<typeof adapter.submit>[0];
    await expect(adapter.submit(ctx, await adapter.prepare(ctx))).rejects.toThrow("narration_execution_incompatible");
    expect(external).toHaveBeenCalledTimes(0);
  });
  it.each(["preview", "adapter"])("resolver返回WS音色ID但legacy target时%s拒绝", async (kind) => {
    const db = createDbClient(); catalog(db); const { old } = await voices(db);
    const resolve = vi.spyOn(providerVoiceResolution, "resolveProviderVoice").mockResolvedValue({
      localVoiceProfileId: old.voice_profile_id,
      providerVoiceId: wsVoice,
      targetModel: old.target_model,
      matchScore: null,
      matchReasons: [],
    });
    if (kind === "preview") {
      await expect(executeVoicePreview({ db, voiceProfileId: old.voice_profile_id })).rejects.toThrow("narration_execution_incompatible");
    } else {
      const adapter = createDashscopeTtsProvider({ db, apiKey: "mock", model: "qwen3-tts-instruct-flash" });
      const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: old.voice_profile_id } } } as Parameters<typeof adapter.submit>[0];
      await expect(adapter.submit(ctx, await adapter.prepare(ctx))).rejects.toThrow("narration_execution_incompatible");
    }
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(external).toHaveBeenCalledTimes(0);
  });
});

function persistedVoiceRow(profile: VoiceProfile) {
  const { voice_profile_id, kind, owner_id, visibility, provider_name, provider_voice_id,
    provider_status, target_model, preview_audio_uri, usage_count, last_used_at,
    quality_score, created_at, updated_at, ...metadataJson } = profile;
  return {
    id: voice_profile_id, kind, ownerId: owner_id ?? null, visibility: visibility ?? "public",
    providerName: provider_name, providerVoiceId: provider_voice_id,
    providerStatus: provider_status, targetModel: target_model,
    previewAudioUri: preview_audio_uri, usageCount: usage_count,
    lastUsedAt: last_used_at ? new Date(last_used_at) : null, qualityScore: quality_score,
    createdAt: new Date(created_at), updatedAt: new Date(updated_at), metadataJson,
  };
}

// F2：真正消费DB档案的resolver必须在设计外呼前检查该次读取。
describe("F2 DB档案在两次读取之间升级", () => {
  it.each(["preview", "adapter"])("%s内部二次读到missing WS档案：零设计、零状态写入", async (kind) => {
    const db = createDbClient(); upgrade(db); const { old } = await voices(db);
    const original = persistedVoiceRow({ ...old, provider_status: "missing", provider_voice_id: null });
    const upgraded = { ...original, targetModel: wsModel, providerStatus: "missing", providerVoiceId: null };
    const findUnique = vi.fn().mockResolvedValue(upgraded).mockResolvedValueOnce(original);
    const update = vi.fn().mockResolvedValue({ ...upgraded, providerStatus: "ready", providerVoiceId: "designed-mock" });
    db.voiceProfilePersistence.prismaClient = { voiceProfile: { findUnique, update } } as never;
    external.mockResolvedValue({ ok: true, status: 200, json: async () => ({ output: { voice: "designed-mock" } }) });
    if (kind === "preview") {
      await expect(executeVoicePreview({ db, voiceProfileId: old.voice_profile_id })).rejects.toThrow("narration_execution_incompatible");
    } else {
      const adapter = createDashscopeTtsProvider({ db, apiKey: "mock", model: "qwen3-tts-instruct-flash" });
      const ctx = { assetPlan: plan, manifest: { audio_summary: { voice_profile_id: old.voice_profile_id } } } as Parameters<typeof adapter.submit>[0];
      await expect(adapter.submit(ctx, await adapter.prepare(ctx))).rejects.toThrow("narration_execution_incompatible");
    }
    expect(external).toHaveBeenCalledTimes(0);
    expect(update).toHaveBeenCalledTimes(0);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
  it("无标记历史missing档案仍能完成设计并写ready", async () => {
    const db = createDbClient(); catalog(db); const { old } = await voices(db);
    const original = persistedVoiceRow({ ...old, provider_status: "missing", provider_voice_id: null });
    const findUnique = vi.fn().mockResolvedValue(original);
    const update = vi.fn().mockResolvedValue({ ...original, providerStatus: "ready", providerVoiceId: "designed-mock" });
    db.voiceProfilePersistence.prismaClient = { voiceProfile: { findUnique, update } } as never;
    external.mockResolvedValue({ ok: true, status: 200, json: async () => ({ output: { voice: "designed-mock" } }) });
    const result = await providerVoiceResolution.resolveProviderVoice({ db, localVoiceProfileId: old.voice_profile_id, apiKey: "mock" });
    expect(result).toMatchObject({ providerVoiceId: "designed-mock", targetModel: old.target_model });
    expect(external).toHaveBeenCalledTimes(1);
    expect(JSON.parse(external.mock.calls[0][1].body)).toMatchObject({ model: "qwen-voice-design", input: { target_model: old.target_model } });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data).toMatchObject({ providerStatus: "ready", providerVoiceId: "designed-mock" });
  });
});
