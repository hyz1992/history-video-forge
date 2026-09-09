// @vitest-environment jsdom
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../frontend/src/utils/api";
import { createFetchProjectApi, createProjectStore, NarrationCreationError, projectStoreKey, type ProjectStore } from "../../frontend/src/stores/project";
import { topicStoreKey, type TopicStore } from "../../frontend/src/stores/topic";
import { useNarrationProjectCreation, NarrationCreationCancelled } from "../../frontend/src/composables/useNarrationProjectCreation";
import NarrationCreationSelection from "../../frontend/src/components/topic/NarrationCreationSelection.vue";
import CreateTopicModal from "../../frontend/src/components/topic/CreateTopicModal.vue";
import EventLibraryBrowser from "../../frontend/src/components/event-library/EventLibraryBrowser.vue";
import CustomTopicInput from "../../frontend/src/components/event-library/CustomTopicInput.vue";
import CreativeVoiceSettings from "../../frontend/src/components/settings/CreativeVoiceSettings.vue";
import CapabilitySlotSettings from "../../frontend/src/components/settings/CapabilitySlotSettings.vue";

const apiFetchMock = vi.fn();
vi.mock("../../frontend/src/utils/api", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

beforeEach(() => {
  apiFetchMock.mockReset();
});

const OPTION = { provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus", voice_profile_id: "voice_narration_qwen_longyimuling", model: "qwen-audio-3.0-tts-plus", voice: "qwen-audio-3.0-tts-plus-longyimuling", region: "cn-beijing", protocol: "dashscope_ws", parameters_version: "neutral-pcm24k-v1" };

function selectionError(code = "narration_selection_required", options = [OPTION]): NarrationCreationError {
  return new NarrationCreationError(422, code, "旧音色不合格，请重新选择合格组合", "narration-first-qwen-neutral-20260906-v1", options);
}

describe("project store 创建错误类型化", () => {
  it("422/409 narration 错误映射为结构化 NarrationCreationError", async () => {
    const api = createFetchProjectApi();
    apiFetchMock.mockRejectedValue(new ApiError(422, "narration_selection_required", "narration_selection_required", { error: "narration_selection_required", reason: "旧音色不合格", policy_version: "v1", options: [OPTION] }));
    await expect(api.createProject({})).rejects.toMatchObject({ code: "narration_selection_required" });
    const store: ProjectStore = createProjectStore({
      listProjects: async () => [],
      getProject: async () => null,
      deleteProject: async () => undefined,
      createProject: async () => {
        await api.createProject({});
        return { project_id: "p", owner_id: "u", current_status: "topic_ready" } as never;
      },
    } as never);
    await expect(store.createProject()).rejects.toBeInstanceOf(NarrationCreationError);
  });
  it("成功创建时请求体携带 narration_selection", async () => {
    let captured: unknown = null;
    apiFetchMock.mockImplementation(async (_url: string, init?: { body?: unknown }) => {
      captured = init?.body;
      return { project_id: "p", owner_id: "u", current_status: "topic_ready" };
    });
    const api = createFetchProjectApi();
    await api.createProject({ name: "历史项目", narrationSelection: { provider_model_id: "m", voice_profile_id: "v", policy_version: "v1" } });
    expect(captured).toMatchObject({ name: "历史项目", narration_selection: { provider_model_id: "m", voice_profile_id: "v", policy_version: "v1" } });
  });
});

describe("创建协调 composable", () => {
  it("422 后等待选择，确认后带 selection 重试成功", async () => {
    const create = vi.fn().mockRejectedValueOnce(selectionError()).mockResolvedValueOnce({ project_id: "p" });
    const creation = useNarrationProjectCreation(create);
    const pending = creation.createOrAwait({ name: "n" });
    await flushPromises();
    expect(creation.pendingSelection.value?.reason).toContain("不合格");
    expect(create).toHaveBeenCalledTimes(1);
    creation.confirmSelection({ provider_model_id: "m", voice_profile_id: "v", policy_version: "v1" });
    const project = await pending;
    expect(project).toMatchObject({ project_id: "p" });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0]).toMatchObject({ name: "n", narrationSelection: { provider_model_id: "m" } });
    expect(creation.pendingSelection.value).toBeNull();
  });
  it("409 策略/偏好变化更新选项并继续等待，不向调用者抛错", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(selectionError())
      .mockRejectedValueOnce(new NarrationCreationError(409, "narration_creation_context_changed", "偏好已变化", "v2", [{ ...OPTION, voice_profile_id: "v2" }]))
      .mockResolvedValueOnce({ project_id: "p" });
    const creation = useNarrationProjectCreation(create);
    const pending = creation.createOrAwait();
    await flushPromises();
    creation.confirmSelection({ provider_model_id: "m", voice_profile_id: "v", policy_version: "v1" });
    await flushPromises();
    expect(creation.pendingSelection.value?.options[0]?.voice_profile_id).toBe("v2");
    expect(creation.waiting.value).toBe(true);
    creation.confirmSelection({ provider_model_id: "m", voice_profile_id: "v2", policy_version: "v2" });
    await pending;
    expect(create).toHaveBeenCalledTimes(3);
  });
  it("取消后抛 Cancelled，恢复后调用者不再触发生成", async () => {
    const create = vi.fn().mockRejectedValueOnce(selectionError());
    const creation = useNarrationProjectCreation(create);
    const pending = creation.createOrAwait();
    await flushPromises();
    creation.cancelSelection();
    await expect(pending).rejects.toBeInstanceOf(NarrationCreationCancelled);
    expect(create).toHaveBeenCalledTimes(1);
    expect(creation.pendingSelection.value).toBeNull();
  });
  it("开关关闭 narration_mode_unavailable 直接抛出，不等待选择", async () => {
    const create = vi.fn().mockRejectedValue(new NarrationCreationError(409, "narration_mode_unavailable", "口播前置模式尚未开放", "v1", [OPTION]));
    const creation = useNarrationProjectCreation(create);
    await expect(creation.createOrAwait()).rejects.toMatchObject({ code: "narration_mode_unavailable" });
    expect(creation.pendingSelection.value).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("确认双击只触发一次重试", async () => {
    const create = vi.fn().mockRejectedValueOnce(selectionError()).mockResolvedValueOnce({ project_id: "p" });
    const creation = useNarrationProjectCreation(create);
    const pending = creation.createOrAwait();
    await flushPromises();
    const selection = { provider_model_id: "m", voice_profile_id: "v", policy_version: "v1" };
    creation.confirmSelection(selection);
    creation.confirmSelection(selection);
    await pending;
    expect(create).toHaveBeenCalledTimes(2);
  });
});

function mountSelection(pending = { reason: "旧音色不合格", policyVersion: "v1", options: [OPTION] }) {
  return mount(NarrationCreationSelection, {
    props: { pending },
    global: { plugins: [ElementPlus] },
  });
}

describe("选择组件", () => {
  it("展示原因与合格组合并外传确认/取消", async () => {
    const w = mountSelection();
    expect(w.text()).toContain("旧音色不合格");
    expect(w.text()).toContain("qwen-audio-3.0-tts-plus");
    await w.get("[data-testid=narration-creation-option]").setValue("0");
    await w.get("[data-testid=narration-creation-confirm]").trigger("click");
    expect(w.emitted("confirm")![0][0]).toMatchObject({ provider_model_id: OPTION.provider_model_id, policy_version: "v1" });
    await w.get("[data-testid=narration-creation-cancel]").trigger("click");
    expect(w.emitted("cancel")).toHaveLength(1);
    w.unmount();
  });
});

const SEGMENT_STORES = () => {
  const projectStore = {
    state: reactive({ projectId: null as string | null, projects: [], currentStatus: "draft", publishIsReady: false, projectOwnerId: null as string | null }),
    createProject: vi.fn(),
    ensureProject: vi.fn(async () => "p1"),
    resolveProjectWorkspacePath: () => "/projects/p1/topic",
    loadProject: async () => undefined,
    loadProjects: async () => undefined,
  } as never as ProjectStore;
  const topicStore = {
    state: reactive({ loadError: null, isGenerating: false, candidates: [], snapshot: null }),
    selectTab: vi.fn(),
    generateSystemRecommendations: vi.fn(async () => undefined),
    generateFromLibrary: vi.fn(async () => undefined),
    loadExistingTopic: vi.fn(async () => undefined),
  } as never as TopicStore;
  return { projectStore, topicStore };
};

function mountModal(stores: { projectStore: ProjectStore; topicStore: TopicStore }) {
  return mount(CreateTopicModal, {
    props: { visible: true },
    global: {
      provide: {
        [projectStoreKey as symbol]: stores.projectStore,
        [topicStoreKey as symbol]: stores.topicStore,
      },
      stubs: { Teleport: true, EventLibraryBrowser: true, CustomTopicInput: true },
    },
  });
}

describe("系统推荐入口协调", () => {
  it("422 后原地展示选择，确认后重试并只生成一次", async () => {
    const stores = SEGMENT_STORES();
    const err = selectionError();
    stores.projectStore.createProject = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce({ project_id: "p1" });
    const w = mountModal(stores);
    await flushPromises();
    await w.get("[data-testid=generate-topic]").trigger("click");
    await flushPromises();
    expect(w.find("[data-testid=narration-creation-option]").exists()).toBe(true);
    await w.get("[data-testid=narration-creation-option]").setValue("0");
    await w.get("[data-testid=narration-creation-confirm]").trigger("click");
    await flushPromises();
    expect(stores.projectStore.createProject).toHaveBeenCalledTimes(2);
    expect(stores.topicStore.generateSystemRecommendations).toHaveBeenCalledTimes(1);
    expect(w.emitted("confirmed")).toHaveLength(1);
    w.unmount();
  });
  it("取消后不触发生成", async () => {
    const stores = SEGMENT_STORES();
    stores.projectStore.createProject = vi.fn().mockRejectedValueOnce(selectionError());
    const w = mountModal(stores);
    await flushPromises();
    await w.get("[data-testid=generate-topic]").trigger("click");
    await flushPromises();
    await w.get("[data-testid=narration-creation-cancel]").trigger("click");
    await flushPromises();
    expect(stores.topicStore.generateSystemRecommendations).not.toHaveBeenCalled();
    expect(w.emitted("confirmed")).toBeUndefined();
    w.unmount();
  });
});

describe("事件库入口协调", () => {
  const DETAIL = { id: "ev1", canonical_title: "晏子使楚", summary: "s", credibility_level: "high", dynasty: "春秋", era: "春秋", event_type_tags: [], angles: [{ id: "a1", title: "主线", angle_label: "主线", family_label: "使楚" }] };
  function mountLibrary(create: ReturnType<typeof vi.fn>) {
    apiFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/event-library/entries/ev1")) return DETAIL;
      if (String(url).includes("/api/event-library/entries")) return { entries: [{ id: "ev1", canonical_title: "晏子使楚" }], total: 1 };
      return {};
    });
    const projectStore = { state: reactive({ projectId: null as string | null }), createProject: create, ensureProject: vi.fn(async () => "p1") } as never;
    const topicStore = { state: reactive({ loadError: null }), selectTab: vi.fn(), generateFromLibrary: vi.fn(async () => undefined) } as never;
    const w = mount(EventLibraryBrowser, {
      props: { createProject: create as unknown },
      global: {
        plugins: [ElementPlus],
        stubs: { Teleport: true },
        provide: {
          [projectStoreKey as symbol]: projectStore,
          [topicStoreKey as symbol]: topicStore,
        },
      },
    });
    return { w, topicStore };
  }
  async function openDetailAndPick(w: ReturnType<typeof mount>) {
    await flushPromises();
    await w.get(".entry-card").trigger("click");
    await flushPromises();
    const angleRadio = w.findAll(".detail-angles input[type=radio]")[0]!;
    await angleRadio.setValue();
    expect((w.vm as unknown as { selectedAngleId: string }).selectedAngleId).toBe("a1");
  }
  it("创建取消时静默：不生成、无错误、事件与角度保留", async () => {
    const create = vi.fn().mockRejectedValue(new NarrationCreationCancelled());
    const { w, topicStore } = mountLibrary(create);
    await openDetailAndPick(w);
    await w.get("[data-testid=library-generate]").trigger("click");
    await flushPromises();
    expect(topicStore.generateFromLibrary).not.toHaveBeenCalled();
    expect(w.text()).not.toContain("narration_selection_required");
    expect((w.vm as unknown as { selectedEntry: { id: string } }).selectedEntry?.id).toBe("ev1");
    expect((w.vm as unknown as { selectedAngleId: string }).selectedAngleId).toBe("a1");
    w.unmount();
  });
  it("422 不被子组件吞掉：错误冒泡展示且不生成", async () => {
    const create = vi.fn().mockRejectedValue(selectionError());
    const { w, topicStore } = mountLibrary(create);
    await openDetailAndPick(w);
    await w.get("[data-testid=library-generate]").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("narration_selection_required");
    expect(topicStore.generateFromLibrary).not.toHaveBeenCalled();
    expect((w.vm as unknown as { selectedAngleId: string }).selectedAngleId).toBe("a1");
    w.unmount();
  });
});

describe("自定义选题入口协调", () => {
  function mountCustom(create: ReturnType<typeof vi.fn>) {
    const projectStore = { state: reactive({ projectId: null as string | null }), createProject: create, ensureProject: vi.fn(async () => "p1") } as never;
    const topicStore = { state: reactive({ loadError: null }), selectTab: vi.fn() } as never;
    return mount(CustomTopicInput, {
      props: { createProject: create as unknown },
      global: { plugins: [ElementPlus], provide: { [projectStoreKey as symbol]: projectStore, [topicStoreKey as symbol]: topicStore } },
    });
  }
  it("创建取消时静默：输入保留、不发 from-custom、无错误", async () => {
    const create = vi.fn().mockRejectedValue(new NarrationCreationCancelled());
    const w = mountCustom(create);
    await w.get("textarea").setValue("晏子使楚");
    await w.get("[data-testid=custom-generate]").trigger("click");
    await flushPromises();
    expect((w.get("textarea").element as HTMLTextAreaElement).value).toBe("晏子使楚");
    expect(apiFetchMock.mock.calls.some(([url]) => String(url).includes("/topic/from-custom"))).toBe(false);
    expect(w.text()).not.toContain("narration_selection_required");
    w.unmount();
  });
  it("422 不被吞掉：错误冒泡展示且不发 from-custom", async () => {
    const create = vi.fn().mockRejectedValue(selectionError());
    const w = mountCustom(create);
    await w.get("textarea").setValue("晏子使楚");
    await w.get("[data-testid=custom-generate]").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("narration_selection_required");
    expect(apiFetchMock.mock.calls.some(([url]) => String(url).includes("/topic/from-custom"))).toBe(false);
    expect((w.get("textarea").element as HTMLTextAreaElement).value).toBe("晏子使楚");
    w.unmount();
  });
});

describe("设置按适用模式禁用", () => {
  it("narration 项目音色不触发付费试听并引导到文案页", async () => {
    const onPreview = vi.fn(async () => undefined);
    const w = mount(CreativeVoiceSettings, {
      props: { modelValue: null, profiles: [{ voice_profile_id: "v1", name: "木灵", provider_voice_id: "qwen-audio-3.0-tts-plus-longyimuling", usage_count: 0 }], disabled: false, projectId: "p1", onPreview, narrationMode: "narration_first_v1" } as never,
      global: { plugins: [ElementPlus] },
    });
    await flushPromises();
    expect(w.find("[data-testid=voice-preview-v1]").exists()).toBe(false);
    expect(w.text()).toContain("文案页");
    expect(onPreview).not.toHaveBeenCalled();
    w.unmount();
  });
  it("非 narration 项目保持试听按钮", async () => {
    const onPreview = vi.fn(async () => undefined);
    const w = mount(CreativeVoiceSettings, {
      props: { modelValue: "v1", profiles: [{ voice_profile_id: "v1", name: "木灵", provider_voice_id: "qwen-audio-3.0-tts-plus-longyimuling", usage_count: 0 }], disabled: false, projectId: "p1", onPreview } as never,
      global: { plugins: [ElementPlus] },
    });
    await flushPromises();
    await w.get("[data-testid=voice-preview-v1]").trigger("click");
    expect(onPreview).toHaveBeenCalledTimes(1);
    w.unmount();
  });
  it("narration 项目 tts 槽位禁用并提示策略固定", () => {
    const entries = [{ id: "old", capability: "tts.synthesize", provider_key: "p", model_id: "old", model_version: null, display_name: "旧模型", quality_tier: null, speed_tier: null, parameter_capabilities: {}, pricing_version: "v1" }];
    const w = mount(CapabilitySlotSettings, {
      props: { entries: entries as never, modelValue: { "tts.synthesize": { mode: "fixed", provider_model_id: "old" } }, disabled: false, narrationLocked: true } as never,
      global: { plugins: [ElementPlus] },
    });
    expect(w.text()).toContain("口播前置");
    const ttsCard = w.get('[data-testid="cap-slot-tts.synthesize"]');
    const radios = ttsCard.findAll("input[type=radio]");
    for (const radio of radios) expect(radio.attributes("disabled")).toBeDefined();
    w.unmount();
  });
});
