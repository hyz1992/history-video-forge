import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

async function fixture() {
  const app = buildApp();
  const legacy = await createProject(app.db, { name: "旧模式候选", ownerId: "owner" });
  const narration = await createProject(app.db, { name: "新模式候选", ownerId: "owner" });
  narration.narrationTimingMode = "narration_first_v1";
  const old = buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }).find(e => e.capability === "tts.synthesize")!;
  app.db.providerModelCatalog.set(old.id, old);
  const ws = { ...old, id: "ws-model", modelId: "qwen-audio-3.0-tts-plus", isDefault: false,
    parameterCapabilitiesJson: { deployment_scope: "cn-beijing", execution_protocol: "dashscope_ws", narration_only: true } };
  app.db.providerModelCatalog.set(ws.id, ws);
  await seedGlobalVoiceProfiles(app.db);
  const profile = [...app.db.voiceProfiles.values()][0]!;
  app.db.voiceProfiles.set("ws-voice", { ...profile, voice_profile_id: "ws-voice", provider_status: "ready",
    provider_voice_id: "qwen-audio-3.0-tts-plus-longyimuling", target_model: ws.modelId });
  return { app, legacy, narration, auth: buildTestAuth({ userId: "owner" }) };
}

describe("项目音色候选的真实路由", () => {
  it("注册后全局目录保留，旧项目排除WS音色，新项目仅显示合格音色", async () => {
    const { app, legacy, narration, auth } = await fixture();
    const get = async (id?: string) => (await app.inject({ method: "GET", url: "/api/me/voice-profiles" + (id ? "?project_id=" + id : ""), auth })).json().profiles;
    expect((await get()).some((p: any) => p.voice_profile_id === "ws-voice")).toBe(true);
    expect((await get(legacy.id)).some((p: any) => p.voice_profile_id === "ws-voice")).toBe(false);
    expect((await get(narration.id)).map((p: any) => p.voice_profile_id)).toEqual(["ws-voice"]);
    app.db.providerModelCatalog.get("ws-model")!.status = "disabled";
    expect(await get(narration.id)).toEqual([]);
    expect((await get(legacy.id)).some((p: any) => p.voice_profile_id === "ws-voice")).toBe(false);
  });
  it("越权/无效项目参数不能回退全局目录", async () => {
    const { app, legacy } = await fixture();
    expect((await app.inject({ method: "GET", url: "/api/me/voice-profiles?project_id=" + legacy.id, auth: buildTestAuth({ userId: "other" }) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/me/voice-profiles?project_id=", auth: buildTestAuth({ userId: "owner" }) })).statusCode).toBe(400);
  });
});

const external = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", external.mockReset()); });
afterEach(() => { expect(external).toHaveBeenCalledTimes(0); vi.unstubAllGlobals(); });

async function adminFixture() {
  const result = await fixture();
  const profile = [...result.app.db.voiceProfiles.values()][0]!;
  for (const owner of ["owner", "admin"]) {
    result.app.db.voiceProfiles.set(owner + "-private", {
      ...profile, voice_profile_id: owner + "-private", kind: "generated",
      owner_id: owner, visibility: "private",
    });
    result.app.db.voiceProfiles.set(owner + "-private-ws", {
      ...result.app.db.voiceProfiles.get("ws-voice")!, voice_profile_id: owner + "-private-ws",
      kind: "generated", owner_id: owner, visibility: "private",
    });
  }
  return { ...result, admin: buildTestAuth({ userId: "admin", role: "ADMIN" }) };
}

function patchConfiguration(app: ReturnType<typeof buildApp>, projectId: string, auth: ReturnType<typeof buildTestAuth>, configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION)) {
  const record = [...app.db.projectGenerationConfigurations.values()].find(r => r.projectId === projectId)!;
  return app.inject({ method: "PATCH", url: "/api/projects/" + projectId + "/generation-configuration", auth,
    payload: { expected_revision: record.revision, video: configuration.video,
      creative: configuration.creative, capabilities: configuration.capabilities } });
}

describe("F4 既有ADMIN授权与项目owner音色域", () => {
  it("ADMIN可为其他owner保存legacy配置并读取模型候选", async () => {
    const { app, legacy, admin } = await adminFixture();
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    configuration.creative.voice_profile_id = "owner-private";
    expect((await patchConfiguration(app, legacy.id, admin, configuration)).statusCode).toBe(200);
    const models = await app.inject({ method: "GET", url: "/api/generation-capabilities?project_id=" + legacy.id, auth: admin });
    expect(models.statusCode).toBe(200);
    expect(models.json().capabilities.some((p: any) => p.id === "ws-model")).toBe(false);
  });
  it("ADMIN项目音色目录使用项目owner域，全局目录仍使用本人域", async () => {
    const { app, legacy, admin } = await adminFixture();
    const result = await app.inject({ method: "GET", url: "/api/me/voice-profiles?project_id=" + legacy.id, auth: admin });
    expect(result.statusCode).toBe(200);
    const ids = result.json().profiles.map((p: any) => p.voice_profile_id);
    expect(ids).toContain("owner-private"); expect(ids).not.toContain("admin-private"); expect(ids).not.toContain("ws-voice");
    const global = await app.inject({ method: "GET", url: "/api/me/voice-profiles", auth: admin });
    const globalIds = global.json().profiles.map((p: any) => p.voice_profile_id);
    expect(globalIds).toContain("admin-private"); expect(globalIds).not.toContain("owner-private");
  });
  it("USER跨owner不能PATCH或利用query role伪装ADMIN读取目录", async () => {
    const { app, legacy } = await adminFixture(); const other = buildTestAuth({ userId: "other" });
    expect((await patchConfiguration(app, legacy.id, other)).statusCode).toBe(404);
    for (const route of ["/api/generation-capabilities", "/api/me/voice-profiles"]) {
      expect((await app.inject({ method: "GET", url: route + "?project_id=" + legacy.id + "&role=ADMIN", auth: other })).statusCode).toBe(404);
    }
  });
  it("ADMIN管理legacy项目仍拒绝WS组合，且不推进revision", async () => {
    const { app, legacy, admin } = await adminFixture();
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: "ws-model" };
    configuration.creative.voice_profile_id = "owner-private-ws";
    const before = structuredClone([...app.db.projectGenerationConfigurations.values()].find(r => r.projectId === legacy.id)!);
    const result = await patchConfiguration(app, legacy.id, admin, configuration);
    expect(result.statusCode).toBe(422); expect(result.json().error).toBe("narration_execution_incompatible");
    expect(app.db.projectGenerationConfigurations.get(before.id)).toEqual(before);
  });
  it("DB权威新mode/owner覆盖Map：ADMIN可保存owner私有合格音色，不接受管理员私有音色", async () => {
    const { app, legacy, admin } = await adminFixture();
    legacy.ownerId = "stale-owner";
    const findFirst = vi.fn().mockResolvedValue({ ...legacy, ownerId: "owner", narrationTimingMode: "narration_first_v1", archivedAt: null });
    app.db.narrationPersistence.prismaClient = { project: { findFirst } } as never;
    const models = await app.inject({ method: "GET", url: "/api/generation-capabilities?project_id=" + legacy.id, auth: admin });
    expect(models.statusCode).toBe(200); expect(models.json().capabilities.map((p: any) => p.id)).toEqual(["ws-model"]);
    const voices = await app.inject({ method: "GET", url: "/api/me/voice-profiles?project_id=" + legacy.id, auth: admin });
    expect(voices.statusCode).toBe(200);
    expect(voices.json().profiles.map((p: any) => p.voice_profile_id)).toEqual(expect.arrayContaining(["ws-voice", "owner-private-ws"]));
    expect(voices.json().profiles.some((p: any) => p.voice_profile_id === "admin-private-ws")).toBe(false);
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: "ws-model" };
    configuration.creative.voice_profile_id = "owner-private-ws";
    expect((await patchConfiguration(app, legacy.id, admin, configuration)).statusCode).toBe(200);
    configuration.creative.voice_profile_id = "admin-private-ws";
    expect((await patchConfiguration(app, legacy.id, admin, configuration)).statusCode).toBe(422);
    expect(findFirst).toHaveBeenCalled();
    for (const [query] of findFirst.mock.calls) expect(query.where).toMatchObject({ id: legacy.id, archivedAt: null });
  });
  it("DB权威owner撤销普通用户权限，ADMIN也不可访问已归档或不存在项目", async () => {
    const { app, legacy, auth, admin } = await adminFixture();
    const findFirst = vi.fn().mockResolvedValue({ ...legacy, ownerId: "new-owner", archivedAt: null });
    app.db.narrationPersistence.prismaClient = { project: { findFirst } } as never;
    for (const route of ["/api/generation-capabilities", "/api/me/voice-profiles"]) {
      expect((await app.inject({ method: "GET", url: route + "?project_id=" + legacy.id, auth })).statusCode).toBe(404);
    }
    findFirst.mockResolvedValue(null);
    for (const route of ["/api/generation-capabilities", "/api/me/voice-profiles"]) {
      expect((await app.inject({ method: "GET", url: route + "?project_id=" + legacy.id, auth: admin })).statusCode).toBe(404);
    }
  });
});

it("F4 DB权威owner撤销USER时PATCH拒绝", async () => {
  const { app, legacy } = await adminFixture();
  app.db.narrationPersistence.prismaClient = {
    project: { findFirst: vi.fn().mockResolvedValue({ ...legacy, ownerId: "new-owner", archivedAt: null }) },
  } as never;
  expect((await patchConfiguration(app, legacy.id, buildTestAuth({ userId: "owner" }))).statusCode).toBe(404);
});
it("F4 ADMIN不能将自己私有音色保存到其他owner的legacy项目", async () => {
  const { app, legacy, admin } = await adminFixture();
  const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
  configuration.creative.voice_profile_id = "admin-private";
  const result = await patchConfiguration(app, legacy.id, admin, configuration);
  expect(result.statusCode).toBe(422); expect(result.json().error).toBe("narration_execution_incompatible");
});
