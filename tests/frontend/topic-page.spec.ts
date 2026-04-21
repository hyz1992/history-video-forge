// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { h, reactive } from "vue";
import { RouterView } from "vue-router";
import { describe, expect, it } from "vitest";

import { createAppRouter } from "../../frontend/src/router/index.js";
import TopicPage from "../../frontend/src/views/TopicPage.vue";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { scriptStoreKey } from "../../frontend/src/stores/script";
import { topicStoreKey } from "../../frontend/src/stores/topic";

function flushPromises() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createProjectStoreStub() {
  const state = reactive({
    projectId: null as string | null,
    currentStatus: "topic_pending",
    projects: [
      {
        project_id: "project-formal",
        display_name: "晏子使楚",
        current_status: "script_ready",
        is_draft: false,
        updated_at: "2026-04-21T09:00:00.000Z",
      },
      {
        project_id: "project-draft",
        display_name: "未命名项目",
        current_status: "topic_pending",
        is_draft: true,
        updated_at: "2026-04-21T08:00:00.000Z",
      },
    ],
  });

  return {
    state,
    syncProject(snapshot: { project_id: string; current_status: string }) {
      state.projectId = snapshot.project_id;
      state.currentStatus = snapshot.current_status;
    },
    async loadProjects() {
      return state.projects;
    },
    async createProject() {
      state.projectId = "project-new";
      state.currentStatus = "topic_pending";
      return {
        project_id: "project-new",
        current_status: "topic_pending",
        is_draft: true,
      };
    },
    resolveProjectWorkspacePath(projectId: string, currentStatus: string) {
      return currentStatus === "script_ready"
        ? `/projects/${projectId}/script`
        : `/projects/${projectId}/topic`;
    },
  };
}

function createTopicStoreStub() {
  const state = reactive({
    activeTab: "system",
    candidates: [],
    selectedCandidate: null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
  });

  return {
    state,
    selectTab() {},
    async generateSystemRecommendations() {},
    openCandidate() {},
    closeCandidate() {},
    async confirmSelectedCandidate() {},
  };
}

function createScriptStoreStub() {
  const state = reactive({
    snapshot: null,
    history: [],
    selectedHistoryEntryId: null,
    isLoading: false,
    isRunningAction: false,
    loadError: null,
  });

  return {
    state,
    async loadActiveScriptSnapshot() {},
    async retryLoadActiveScriptSnapshot() {},
    selectHistoryEntry() {},
    async runPatchOnce() {},
    async runRegenOnce() {},
  };
}

async function mountAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(
    {
      render: () => h(RouterView),
    },
    {
      global: {
        plugins: [router],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [topicStoreKey as symbol]: createTopicStoreStub() as never,
          [scriptStoreKey as symbol]: createScriptStoreStub() as never,
        },
      },
    },
  );

  await flushPromises();
  return { router, wrapper };
}

describe("phase 4 app shell", () => {
  it("renders the home page with project entry CTAs", async () => {
    const { router, wrapper } = await mountAt("/");

    expect(router.currentRoute.value.path).toBe("/");
    expect(wrapper.text()).toContain("选题 -> 确认 -> 生成文案");
    expect(wrapper.get("[data-testid='home-heading']").text()).toContain("Story Video Forge");
    expect(wrapper.get("[data-testid='home-primary-cta']").attributes("href")).toBe("/projects");
    expect(wrapper.get("[data-testid='home-secondary-cta']").attributes("href")).toBe(
      "/projects",
    );
  });

  it("renders the projects page with formal and draft project groups", async () => {
    const { router, wrapper } = await mountAt("/projects");

    expect(router.currentRoute.value.path).toBe("/projects");
    expect(wrapper.get("[data-testid='projects-heading']").text()).toContain("我的项目");
    expect(wrapper.get("[data-testid='formal-projects']").text()).toContain("正式项目");
    expect(wrapper.get("[data-testid='draft-projects']").text()).toContain(
      "草稿项目 / 未完成项目",
    );
    expect(wrapper.text()).toContain("晏子使楚");
    expect(wrapper.text()).toContain("未命名项目");
  });
});

describe("topic workspace rounds", () => {
  it("renders the current round separately from candidate history and allows confirming from history", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-1/topic");
    await router.isReady();

    const projectStore = createProjectStoreStub();
    projectStore.syncProject({
      project_id: "project-1",
      current_status: "topic_candidates_ready",
    });

    const calls = {
      confirm: [] as Array<{ roundId: string; candidateId: string }>,
    };

    const topicState = reactive({
        activeTab: "system",
        candidates: [],
        currentRound: {
          round_id: "round-2",
          label: "第 2 轮",
          candidates: [
            {
              candidate_id: "candidate-current",
              title: "当前轮主题",
              one_line_angle: "当前轮角度",
              family_label: "family",
              scope_label: "scope",
              strong_scene: "当前轮场景",
              risk_hints: [],
            },
          ],
        },
        historyRounds: [
          {
            round_id: "round-1",
            label: "第 1 轮",
            candidates: [
              {
                candidate_id: "candidate-history",
                title: "历史轮主题",
                one_line_angle: "历史轮角度",
                family_label: "family",
                scope_label: "scope",
                strong_scene: "历史轮场景",
                risk_hints: [],
              },
            ],
          },
        ],
        selectedCandidate: null as null | {
          candidate_id: string;
          title: string;
          one_line_angle: string;
          family_label: string;
          scope_label: string;
          strong_scene: string;
          risk_hints: string[];
        },
        selectedRoundId: null as string | null,
        isGenerating: false,
        isConfirming: false,
        confirmedTopicPackageId: null,
      });
    const topicStore = {
      state: topicState,
      selectTab() {},
      async generateSystemRecommendations() {},
      openCandidate(candidate: { candidate_id: string }, roundId = "round-2") {
        topicState.selectedCandidate = candidate;
        topicState.selectedRoundId = roundId;
      },
      closeCandidate() {
        topicState.selectedCandidate = null;
        topicState.selectedRoundId = null;
      },
      async confirmSelectedCandidate() {
        if (!topicState.selectedCandidate || !topicState.selectedRoundId) {
          return;
        }

        calls.confirm.push({
          roundId: topicState.selectedRoundId,
          candidateId: topicState.selectedCandidate.candidate_id,
        });
      },
    };

    const wrapper = mount(TopicPage, {
      global: {
        plugins: [router],
        provide: {
          [projectStoreKey as symbol]: projectStore as never,
          [topicStoreKey as symbol]: topicStore as never,
        },
      },
    });

    expect(wrapper.get("[data-testid='current-topic-round']").text()).toContain("当前轮主题");
    expect(wrapper.get("[data-testid='topic-history']").text()).toContain("历史轮主题");

    await wrapper.get("[data-testid='history-candidate-candidate-history']").trigger("click");
    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");

    expect(calls.confirm).toEqual([
      {
        roundId: "round-1",
        candidateId: "candidate-history",
      },
    ]);
  });
});
