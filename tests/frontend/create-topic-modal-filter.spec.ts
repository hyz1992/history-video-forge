// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CreateTopicModal from "../../frontend/src/components/topic/CreateTopicModal.vue";
import { projectStoreKey } from "../../frontend/src/stores/project";
import {
  TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY,
  topicStoreKey,
  type TopicRecommendationFilterDraft,
} from "../../frontend/src/stores/topic";

function createStores(createProject = vi.fn(async () => "project-1")) {
  const generateSystemRecommendations = vi.fn(async () => undefined);
  return {
    projectStore: {
      state: reactive({ projectId: null, currentStatus: "topic_pending", projects: [] }),
      createProject,
      ensureProject: vi.fn(async () => "project-1"),
      loadProjects: vi.fn(async () => []),
      resolveProjectWorkspacePath: vi.fn(() => "/projects/project-1/topic"),
      syncProject: vi.fn(),
    },
    topicStore: {
      state: reactive({ activeTab: "system" }),
      selectTab: vi.fn(),
      generateSystemRecommendations,
    },
    generateSystemRecommendations,
  };
}

function mountModal(createProject?: ReturnType<typeof vi.fn>) {
  const stores = createStores(createProject);
  const wrapper = mount(CreateTopicModal, {
    attachTo: document.body,
    props: { visible: true },
    global: {
      provide: {
        [projectStoreKey as symbol]: stores.projectStore,
        [topicStoreKey as symbol]: stores.topicStore,
      },
      stubs: {
        Teleport: true,
        EventLibraryBrowser: true,
        CustomTopicInput: true,
      },
    },
  });
  return { wrapper, ...stores };
}

async function clickByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text() === text);
  expect(button, `button ${text}`).toBeTruthy();
  await button!.trigger("click");
}

describe("CreateTopicModal recommendation filters", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses the accepted medieval full range by default and changes era to its full child range", async () => {
    const { wrapper } = mountModal();
    expect(wrapper.get('[data-testid="period-summary"]').text()).toContain(
      "三国、两晋、南北朝、隋、唐、五代十国、宋辽夏金",
    );

    await clickByText(wrapper, "元明清");
    expect(wrapper.get('[data-testid="period-summary"]').text()).toContain("元、明、清");
    expect((wrapper.get('[data-testid="period-start"]').element as HTMLInputElement).value).toBe("0");
    expect((wrapper.get('[data-testid="period-end"]').element as HTMLInputElement).value).toBe("2");
  });

  it("keeps range selection continuous and submits the complete intermediate period list", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { wrapper, generateSystemRecommendations } = mountModal();
    await wrapper.get('[data-testid="period-start"]').setValue("4");
    await wrapper.get('[data-testid="period-end"]').setValue("6");
    expect(wrapper.get('[data-testid="period-summary"]').text()).toContain(
      "唐、五代十国、宋辽夏金",
    );

    await clickByText(wrapper, "开始生成选题");
    const draft = generateSystemRecommendations.mock.calls[0]?.[0] as TopicRecommendationFilterDraft;
    expect(draft).toMatchObject({
      era_band: "medieval",
      period_start_id: "tang",
      period_end_id: "song_liao_xia_jin",
    });
    expect(sessionStorage.getItem(TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY)).toBe(
      JSON.stringify(draft),
    );
    expect(getItem.mock.calls.every(([key]) => key === TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY)).toBe(true);
    expect(setItem.mock.calls.every(([key]) => key === TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY)).toBe(true);
  });

  it("raises the recoverable handle when the range collapses at either endpoint", async () => {
    const { wrapper } = mountModal();
    const start = wrapper.get('[data-testid="period-start"]');
    const end = wrapper.get('[data-testid="period-end"]');

    await start.setValue("6");
    await nextTick();
    expect(wrapper.get('[data-testid="period-start"]').classes()).toContain("period-slider--front");
    expect(wrapper.get('[data-testid="period-end"]').classes()).not.toContain("period-slider--front");
    await start.setValue("4");
    expect(wrapper.get('[data-testid="period-summary"]').text()).toContain(
      "唐、五代十国、宋辽夏金",
    );

    await start.setValue("0");
    await end.setValue("0");
    await nextTick();
    expect(wrapper.get('[data-testid="period-end"]').classes()).toContain("period-slider--front");
    expect(wrapper.get('[data-testid="period-start"]').classes()).not.toContain("period-slider--front");
    await end.setValue("2");
    expect(wrapper.get('[data-testid="period-summary"]').text()).toContain(
      "三国、两晋、南北朝",
    );

    await start.setValue("6");
    expect(wrapper.get('[data-testid="period-summary"]').text()).toBe("已选：南北朝");
  });

  it("supports unlimited and fixed single-select filters with explicit clearing", async () => {
    const { wrapper, generateSystemRecommendations } = mountModal();
    await clickByText(wrapper, "不限");
    expect(wrapper.find('[data-testid="period-range"]').exists()).toBe(false);

    await clickByText(wrapper, "关键决策");
    await clickByText(wrapper, "展开筛选");
    expect(wrapper.text()).toContain("收起筛选");
    await clickByText(wrapper, "军事战争");
    await clickByText(wrapper, "军事人物");
    await wrapper.get('[data-testid="event-unlimited"]').trigger("click");
    await wrapper.get('[data-testid="actor-unlimited"]').trigger("click");
    await clickByText(wrapper, "系统判断");
    await clickByText(wrapper, "开始生成选题");

    expect(generateSystemRecommendations.mock.calls[0]?.[0]).toMatchObject({
      era_band: "unlimited",
      period_start_id: null,
      period_end_id: null,
      event_domain: "unlimited",
      central_actor_type: "unlimited",
      storytelling_lens: "auto",
    });
  });

  it("restores one complete draft and falls back safely from corrupt storage", async () => {
    const stored: TopicRecommendationFilterDraft = {
      era_band: "late_imperial",
      period_start_id: "ming",
      period_end_id: "qing",
      event_domain: "law_justice",
      central_actor_type: "civil_official",
      storytelling_lens: "aftermath",
      exclude_terms: ["演义"],
    };
    sessionStorage.setItem(TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY, JSON.stringify(stored));
    let mounted = mountModal();
    expect(mounted.wrapper.get('[data-testid="period-summary"]').text()).toContain("明、清");
    expect(mounted.wrapper.text()).toContain("演义");
    mounted.wrapper.unmount();

    sessionStorage.setItem(TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY, "{broken");
    mounted = mountModal();
    expect(mounted.wrapper.get('[data-testid="period-summary"]').text()).toContain(
      "三国、两晋、南北朝、隋、唐、五代十国、宋辽夏金",
    );
  });

  it("trims, deduplicates, removes and limits exclusion terms to eight", async () => {
    const { wrapper, generateSystemRecommendations } = mountModal();
    await clickByText(wrapper, "展开筛选");
    const input = wrapper.get('[data-testid="exclude-input"]');
    for (const term of [" 演义 ", "演义", "神话", "戏说", "穿越", "架空", "传奇", "秘闻", "野史", "第九项"]) {
      await input.setValue(term);
      await input.trigger("keydown", { key: "Enter" });
    }
    expect(wrapper.findAll('[data-testid="exclude-tag"]')).toHaveLength(8);
    await wrapper.findAll('[data-testid="remove-exclude"]')[0]!.trigger("click");
    expect(wrapper.findAll('[data-testid="exclude-tag"]')).toHaveLength(7);

    await clickByText(wrapper, "开始生成选题");
    const draft = generateSystemRecommendations.mock.calls[0]?.[0] as TopicRecommendationFilterDraft;
    expect(draft.exclude_terms).toHaveLength(7);
    expect(draft.exclude_terms).not.toContain(" 演义 ");
  });

  it("locks every control while project creation is pending and unlocks after completion", async () => {
    let resolveProject!: (projectId: string) => void;
    const createProject = vi.fn(() => new Promise<string>((resolve) => {
      resolveProject = resolve;
    }));
    const { wrapper } = mountModal(createProject);
    await clickByText(wrapper, "展开筛选");
    const exclude = wrapper.get('[data-testid="exclude-input"]');
    await exclude.setValue("演义");
    await exclude.trigger("keydown", { key: "Enter" });
    const initialSummary = wrapper.get('[data-testid="period-summary"]').text();

    const generation = wrapper.get('[data-testid="generate-topic"]').trigger("click");
    await nextTick();
    const controls = wrapper.findAll("button, input");
    expect(controls.length).toBeGreaterThan(10);
    expect(controls.every((control) => control.attributes("disabled") !== undefined)).toBe(true);
    expect(controls.every((control) => control.attributes("aria-disabled") === "true")).toBe(true);

    await wrapper.get('[data-testid="period-start"]').setValue("4");
    await wrapper.get('[data-testid="advanced-toggle"]').trigger("click");
    await wrapper.get('[data-testid="remove-exclude"]').trigger("click");
    await wrapper.get('[data-testid="modal-close"]').trigger("click");
    await wrapper.get('[data-testid="topic-dialog"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.get('[data-testid="period-summary"]').text()).toBe(initialSummary);
    expect(wrapper.findAll('[data-testid="exclude-tag"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("收起筛选");
    expect(wrapper.emitted("update:visible")).toBeUndefined();

    resolveProject("project-1");
    await generation;
    await flushPromises();
    await nextTick();
    expect(wrapper.get('[data-testid="modal-close"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get('[data-testid="advanced-toggle"]').attributes("disabled")).toBeUndefined();
  });

  it("does not submit an exclusion term while a Chinese IME composition is active", async () => {
    const { wrapper } = mountModal();
    await clickByText(wrapper, "展开筛选");
    const input = wrapper.get('[data-testid="exclude-input"]');
    await input.setValue("南北朝");
    await input.trigger("compositionstart");
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    input.element.dispatchEvent(composingEnter);
    await nextTick();
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(wrapper.findAll('[data-testid="exclude-tag"]')).toHaveLength(0);
    expect((input.element as HTMLInputElement).value).toBe("南北朝");

    await input.trigger("compositionend");
    const committedEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.element.dispatchEvent(committedEnter);
    await nextTick();
    expect(committedEnter.defaultPrevented).toBe(true);
    expect(wrapper.findAll('[data-testid="exclude-tag"]')).toHaveLength(1);
    expect((wrapper.get('[data-testid="exclude-input"]').element as HTMLInputElement).value).toBe("");
  });

  it("keeps a forty-character exclusion tag bounded while preserving its full label", async () => {
    const term = "史".repeat(40);
    const { wrapper } = mountModal();
    await clickByText(wrapper, "展开筛选");
    const input = wrapper.get('[data-testid="exclude-input"]');
    await input.setValue(term);
    await input.trigger("keydown", { key: "Enter" });

    const tag = wrapper.get('[data-testid="exclude-tag"]');
    const text = wrapper.get('[data-testid="exclude-tag-text"]');
    expect(tag.classes()).toContain("tag--bounded");
    expect(text.classes()).toContain("tag-text");
    expect(text.attributes("title")).toBe(term);
    expect(wrapper.get('[data-testid="remove-exclude"]').attributes("aria-label")).toContain(term);
  });

  it("exposes a labelled dialog, traps focus, handles Escape, and marks chips as pressed", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { wrapper } = mountModal();
    await nextTick();

    const dialog = wrapper.get('[data-testid="topic-dialog"]');
    expect(dialog.attributes()).toMatchObject({
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "create-topic-title",
    });
    expect(wrapper.get("#create-topic-title").element.tagName).toBe("H2");
    expect(document.activeElement).toBe(wrapper.get('[data-testid="modal-close"]').element);
    expect(wrapper.findAll(".chip").every((chip) => chip.attributes("aria-pressed") !== undefined)).toBe(true);
    expect(wrapper.get('[data-testid="period-start"]').attributes("aria-valuetext")).toContain("三国");

    const focusable = wrapper.findAll("button:not(:disabled), input:not(:disabled)");
    focusable[focusable.length - 1]!.element.focus();
    await dialog.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]!.element);
    focusable[0]!.element.focus();
    await dialog.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]!.element);

    await dialog.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("update:visible")?.at(-1)).toEqual([false]);
    await wrapper.setProps({ visible: false });
    await nextTick();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
