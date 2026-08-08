// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CreateTopicModal from "../../frontend/src/components/topic/CreateTopicModal.vue";
import { projectStoreKey } from "../../frontend/src/stores/project";
import {
  TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY,
  topicStoreKey,
  type TopicRecommendationFilterDraft,
} from "../../frontend/src/stores/topic";

function createStores() {
  const generateSystemRecommendations = vi.fn(async () => undefined);
  return {
    projectStore: {
      state: reactive({ projectId: null, currentStatus: "topic_pending", projects: [] }),
      createProject: vi.fn(async () => "project-1"),
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

function mountModal() {
  const stores = createStores();
  const wrapper = mount(CreateTopicModal, {
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
    expect(sessionStorage.getItem("topic-era-filter")).toBeNull();
    expect(sessionStorage.getItem("topic-tension-filter")).toBeNull();
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
});
