import { describe, expect, it } from "vitest";
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
