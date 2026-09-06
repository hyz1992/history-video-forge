// @vitest-environment jsdom
import { mount, flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../shared/src/index.js";
import ProjectGenerationSettings from "../../frontend/src/components/settings/ProjectGenerationSettings.vue";
import CapabilitySlotSettings from "../../frontend/src/components/settings/CapabilitySlotSettings.vue";
import CreativeVoiceSettings from "../../frontend/src/components/settings/CreativeVoiceSettings.vue";
import { createGenerationConfigStore, createFetchGenerationConfigApi, generationConfigStoreKey } from "../../frontend/src/stores/generation-config";
import { createCreativePresetsStore, createFetchCreativePresetsApi, creativePresetsStoreKey } from "../../frontend/src/stores/creative-presets";

const entry = (id: string) => ({ id, capability: "tts.synthesize", provider_key: "dashscope", model_id: id, display_name: id, availability: "enabled", parameter_capabilities: {} } as any);
const voice = (id: string) => ({ voice_profile_id: id, name: id, kind: "system", provider_status: "ready", voice_traits: [], avoid_traits: [] } as any);
function stores() {
  const modelList = vi.fn(async (id?: string) => ({ capabilities: [entry(id ?? "global-ws")] }));
  const voiceList = vi.fn(async (id?: string) => ({ profiles: [voice(id ?? "global-ws")] }));
  const configs = createGenerationConfigStore({
    getProjectConfig: async () => ({ source: "stored", revision: 1, configuration: structuredClone(DEFAULT_GENERATION_CONFIGURATION), updated_at: new Date().toISOString(), source_user_preference_revision: null, diff_from_user_default: {} }),
    listCapabilities: modelList,
  } as any);
  const creative = createCreativePresetsStore({ listCreativePresets: async () => ({ art_style: [], subtitle: [] }), listVoiceProfiles: voiceList } as any);
  return { configs, creative, modelList, voiceList };
}
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.unstubAllGlobals());

describe("项目候选展示接线", () => {
  it("fetch API为项目编码query，全局请求保持原路径", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ capabilities: [], profiles: [] }) }));
    vi.stubGlobal("fetch", request);
    await (createFetchGenerationConfigApi().listCapabilities as any)("项目 / A");
    await (createFetchCreativePresetsApi().listVoiceProfiles as any)("项目 / A");
    await createFetchGenerationConfigApi().listCapabilities();
    expect(request.mock.calls.map(c => c[0])).toEqual(["/api/generation-capabilities?project_id=" + encodeURIComponent("项目 / A"), "/api/me/voice-profiles?project_id=" + encodeURIComponent("项目 / A"), "/api/generation-capabilities"]);
  });
  it("upgraded/switched：项目组件请求当前项目模型和音色，切换项目同步切换候选", async () => {
    const s = stores();
    await s.configs.loadCapabilities(); await s.creative.loadVoiceProfiles();
    const wrapper = mount(ProjectGenerationSettings, { props: { projectId: "legacy", open: true }, global: { plugins: [ElementPlus], provide: { [generationConfigStoreKey as symbol]: s.configs, [creativePresetsStoreKey as symbol]: s.creative } } });
    await flushPromises();
    expect(s.modelList).toHaveBeenCalledWith("legacy"); expect(s.voiceList).toHaveBeenCalledWith("legacy");
    expect(wrapper.findComponent(CapabilitySlotSettings).props("entries").map((x: any) => x.id)).toEqual(["legacy"]);
    expect(wrapper.findComponent(CreativeVoiceSettings).props("profiles").map((x: any) => x.voice_profile_id)).toEqual(["legacy"]);
    await wrapper.setProps({ projectId: "narration" }); await flushPromises();
    expect(wrapper.findComponent(CapabilitySlotSettings).props("entries").map((x: any) => x.id)).toEqual(["narration"]);
    expect(wrapper.findComponent(CreativeVoiceSettings).props("profiles").map((x: any) => x.voice_profile_id)).toEqual(["narration"]);
    expect(s.configs.state.capabilities.map(x => x.id)).toEqual(["global-ws"]);
    expect(s.creative.state.voiceProfiles.map(x => x.voice_profile_id)).toEqual(["global-ws"]);
    wrapper.unmount();
  });
  it.each(["models", "voices"])("duplicated/reordered：%s的迟到同项目响应与全局响应不能覆盖当前项目", async kind => {
    const s = stores(); const first = deferred(); const second = deferred(); const global = deferred();
    const list = kind === "models" ? s.modelList : s.voiceList;
    list.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise).mockImplementationOnce(() => global.promise);
    const store: any = kind === "models" ? s.configs : s.creative;
    const load = kind === "models" ? store.loadCapabilities : store.loadVoiceProfiles;
    const data = (id: string) => kind === "models" ? { capabilities: [entry(id)] } : { profiles: [voice(id)] };
    const a = load("project"); const b = load("project"); const c = load();
    second.resolve(data("current")); await b; global.resolve(data("global-ws")); await c; first.resolve(data("stale")); await a;
    const scoped = kind === "models" ? store.state.projectCapabilities?.project : store.state.projectVoiceProfiles?.project;
    expect(scoped?.map((x: any) => x.id ?? x.voice_profile_id)).toEqual(["current"]);
    const globalRows = kind === "models" ? store.state.capabilities : store.state.voiceProfiles;
    expect(globalRows.map((x: any) => x.id ?? x.voice_profile_id)).toEqual(["global-ws"]);
  });
});
