// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TopicPanel from "../../frontend/src/components/topic/TopicPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import {
  TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY,
  topicStoreKey,
  type TopicRecommendationFilterDraft,
} from "../../frontend/src/stores/topic";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";

const storedDraft: TopicRecommendationFilterDraft = {
  era_band: "medieval",
  period_start_id: "tang",
  period_end_id: "song_liao_xia_jin",
  event_domain: "diplomacy_relations",
  central_actor_type: "civil_official",
  storytelling_lens: "relationship_dynamics",
  exclude_terms: ["演义", "神话"],
};

function createProjectStore() {
  return {
    state: reactive({
      projectId: "project-filter-draft",
      currentStatus: "topic_candidates_ready",
      projects: [],
    }),
    loadProject: vi.fn(async () => undefined),
    ensureProject: vi.fn(async () => "project-filter-draft"),
    createProject: vi.fn(),
    loadProjects: vi.fn(async () => []),
    deleteProject: vi.fn(),
    resolveProjectWorkspacePath: vi.fn(() => "/projects/project-filter-draft/topic"),
    syncProject: vi.fn(),
  };
}

async function mountTopicPanel(mode: "ready" | "error") {
  const router = createAppRouter();
  await router.push("/projects/project-filter-draft/topic");
  await router.isReady();
  const candidate = {
    candidate_id: "candidate-1",
    title: "唐宋之间的外交事件",
    one_line_angle: "关系博弈",
    family_label: "外交",
    scope_label: "单事件",
    strong_scene: "朝堂",
    risk_hints: [],
  };
  const state = reactive({
    activeTab: "system" as const,
    candidates: mode === "ready" ? [candidate] : [],
    currentRound: mode === "ready" ? { round_id: "round-1", candidates: [candidate] } : null,
    historyRounds: [],
    selectedCandidate: mode === "ready" ? candidate : null,
    selectedRoundId: mode === "ready" ? "round-1" : null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
    loadError: mode === "error" ? "generation_failed" : null,
    snapshot: { current_status: mode === "ready" ? "topic_candidates_ready" : "topic_failed" },
    generationSource: "system" as const,
  });
  const generateSystemRecommendations = vi.fn(async () => undefined);
  const topicStore = {
    state,
    selectTab: vi.fn(),
    generateSystemRecommendations,
    openCandidate: vi.fn(),
    closeCandidate: vi.fn(),
    confirmSelectedCandidate: vi.fn(async () => undefined),
    loadExistingTopic: vi.fn(async () => undefined),
    loadSnapshot: vi.fn(async () => ({
      active_topic_package: null,
      current_status: "topic_candidates_ready",
      topic_candidates: null,
    })),
  };
  const wrapper = mount(TopicPanel, {
    global: {
      plugins: [router, ElementPlus],
      provide: {
        [projectStoreKey as symbol]: createProjectStore() as never,
        [workspaceStoreKey as symbol]: {
          state: reactive({ currentStep: 0 }),
          setCurrentStep: vi.fn(),
        } as never,
        [topicStoreKey as symbol]: topicStore as never,
      },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  return { wrapper, generateSystemRecommendations };
}

describe("TopicPanel recommendation filter restoration", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("forwards the complete stored draft for refresh and regeneration", async () => {
    sessionStorage.setItem(TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY, JSON.stringify(storedDraft));

    const ready = await mountTopicPanel("ready");
    await ready.wrapper.get(".action-btn").trigger("click");
    await Promise.resolve();
    expect(ready.generateSystemRecommendations).toHaveBeenCalledWith(storedDraft);
    ready.wrapper.unmount();

    const failed = await mountTopicPanel("error");
    const regenerate = failed.wrapper.findAll("button").find((button) => button.text() === "重新生成");
    expect(regenerate).toBeTruthy();
    await regenerate!.trigger("click");
    await Promise.resolve();
    expect(failed.generateSystemRecommendations).toHaveBeenCalledWith(storedDraft);
    failed.wrapper.unmount();
  });

  it("uses the accepted default draft when stored JSON is corrupt", async () => {
    sessionStorage.setItem(TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY, "{broken");
    const failed = await mountTopicPanel("error");
    const regenerate = failed.wrapper.findAll("button").find((button) => button.text() === "重新生成");
    await regenerate!.trigger("click");
    await Promise.resolve();

    expect(failed.generateSystemRecommendations).toHaveBeenCalledWith({
      era_band: "medieval",
      period_start_id: "three_kingdoms",
      period_end_id: "song_liao_xia_jin",
      event_domain: "unlimited",
      central_actor_type: "unlimited",
      storytelling_lens: "auto",
      exclude_terms: [],
    });
    failed.wrapper.unmount();
  });
});
