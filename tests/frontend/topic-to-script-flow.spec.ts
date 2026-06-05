// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { h, reactive } from "vue";
import { RouterView } from "vue-router";
import { describe, expect, it } from "vitest";
import ElementPlus from "element-plus";

import { createAppRouter } from "../../frontend/src/router/index.js";
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

  const calls = {
    createProject: 0,
  };

  return {
    calls,
    store: {
      state,
      syncProject(snapshot: { project_id: string; current_status: string }) {
        state.projectId = snapshot.project_id;
        state.currentStatus = snapshot.current_status;
      },
      async loadProjects() {
        return state.projects;
      },
      async loadProject() {},
      async createProject() {
        calls.createProject += 1;
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
    },
  };
}

function createTopicStoreStub() {
  const state = reactive({
    activeTab: "system",
    candidates: [],
    currentRound: null,
    historyRounds: [],
    selectedCandidate: null,
    selectedRoundId: null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
  });

  return {
    state,
    selectTab() {},
    async generateSystemRecommendations() {},
    openCandidate() {},
    closeCandidate() {
      state.selectedCandidate = null;
      state.selectedRoundId = null;
    },
    async confirmSelectedCandidate() {},
    async loadExistingTopic() {},
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
  const projectStore = createProjectStoreStub();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(
    {
      render: () => h(RouterView),
    },
    {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: projectStore.store as never,
          [topicStoreKey as symbol]: createTopicStoreStub() as never,
          [scriptStoreKey as symbol]: createScriptStoreStub() as never,
        },
      },
    },
  );

  await flushPromises();
  return { router, wrapper, calls: projectStore.calls };
}

describe("phase 4 project routing", () => {
  it("creates a project from /projects and lands in the topic workspace", async () => {
    const { router, wrapper, calls } = await mountAt("/projects");

    await wrapper.get("[data-testid='create-project']").trigger("click");
    await flushPromises();

    expect(calls.createProject).toBe(1);
    expect(router.currentRoute.value.path).toBe("/projects/project-new/topic");
  });

  it("opens draft and formal projects at different workspace routes", async () => {
    const { router, wrapper } = await mountAt("/projects");

    await wrapper.get("[data-testid='open-project-project-draft']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/projects/project-draft/topic");

    await router.push("/projects");
    await flushPromises();

    await wrapper.get("[data-testid='open-project-project-formal']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/projects/project-formal/script");
  });

  it("navigates to the project script workspace and auto-starts script generation after topic confirmation", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-1/topic");
    await router.isReady();

    const projectStore = createProjectStoreStub();
    projectStore.store.syncProject({
      project_id: "project-1",
      current_status: "topic_candidates_ready",
    });

    const topicState = reactive({
      activeTab: "system",
      candidates: [],
      currentRound: {
        round_id: "round-1",
        candidates: [
          {
            candidate_id: "candidate-1",
            title: "晏子使楚",
            one_line_angle: "确认主题后自动进入文案工作区。",
            family_label: "court_showdown",
            scope_label: "single_turning_point",
            strong_scene: "楚王压场，晏子顶回。",
            risk_hints: [],
          },
        ],
      },
      historyRounds: [],
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
      confirmedTopicPackageId: null as string | null,
    });

    const calls = {
      generateInitialScript: 0,
      loadSnapshot: 0,
    };

    const topicStore = {
      state: topicState,
      selectTab() {},
      async generateSystemRecommendations() {},
      async loadExistingTopic() {},
      openCandidate(candidate: typeof topicState.currentRound.candidates[number], roundId?: string | null) {
        topicState.selectedCandidate = candidate;
        topicState.selectedRoundId = roundId ?? topicState.currentRound?.round_id ?? null;
      },
      closeCandidate() {
        topicState.selectedCandidate = null;
        topicState.selectedRoundId = null;
      },
      async confirmSelectedCandidate() {
        projectStore.store.syncProject({
          project_id: "project-1",
          current_status: "script_ready",
        });
        topicState.confirmedTopicPackageId = "topic-package-1";
      },
    };

    const scriptState = reactive({
      snapshot: null,
      history: [],
      selectedHistoryEntryId: null,
      isLoading: false,
      isRunningAction: false,
      loadError: null,
    });
    const scriptStore = {
      state: scriptState,
      async loadActiveScriptSnapshot() {
        calls.loadSnapshot += 1;
        scriptState.snapshot = {
          project_id: "project-1",
          current_status: "script_pending",
          active_script: null,
        };
      },
      async retryLoadActiveScriptSnapshot() {},
      selectHistoryEntry() {},
      async runPatchOnce() {},
      async runRegenOnce() {},
      async generateInitialScript() {
        calls.generateInitialScript += 1;
      },
    };

    const wrapper = mount(
      {
        render: () => h(RouterView),
      },
      {
        global: {
          plugins: [router, ElementPlus],
          provide: {
            [projectStoreKey as symbol]: projectStore.store as never,
            [topicStoreKey as symbol]: topicStore as never,
            [scriptStoreKey as symbol]: scriptStore as never,
          },
        },
      },
    );

    await wrapper.get("[data-testid='candidate-item-candidate-1']").trigger("click");
    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/projects/project-1/script");
    expect(calls.loadSnapshot).toBe(1);
    expect(calls.generateInitialScript).toBe(1);
    expect(wrapper.get("[data-testid='script-page-header']").text()).toContain("文案工作区");
    expect(wrapper.get("[data-testid='script-trace-entry']").text()).toContain("查看运行详情");
  });

  it("returns to the script workspace and restarts initial generation after confirming a new topic from topic again", async () => {
    const router = createAppRouter();
    await router.push("/projects/project-2/topic");
    await router.isReady();

    const projectStore = createProjectStoreStub();
    projectStore.store.syncProject({
      project_id: "project-2",
      current_status: "topic_candidates_ready",
    });

    const topicState = reactive({
      activeTab: "system",
      candidates: [],
      currentRound: {
        round_id: "round-2",
        candidates: [
          {
            candidate_id: "candidate-current",
            title: "当前轮主题",
            one_line_angle: "当前轮主题角度",
            family_label: "court_showdown",
            scope_label: "single_turning_point",
            strong_scene: "当前轮强场面",
            risk_hints: [],
          },
        ],
      },
      historyRounds: [
        {
          round_id: "round-1",
          candidates: [
            {
              candidate_id: "candidate-history",
              title: "历史轮主题",
              one_line_angle: "历史轮主题角度",
              family_label: "court_showdown",
              scope_label: "single_turning_point",
              strong_scene: "历史轮强场面",
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
      confirmedTopicPackageId: null as string | null,
    });

    const calls = {
      loadSnapshot: 0,
      generateInitialScript: 0,
    };

    const topicStore = {
      state: topicState,
      selectTab() {},
      async generateSystemRecommendations() {},
      async loadExistingTopic() {},
      openCandidate(candidate: typeof topicState.currentRound.candidates[number], roundId?: string | null) {
        topicState.selectedCandidate = candidate;
        topicState.selectedRoundId = roundId ?? topicState.currentRound?.round_id ?? null;
      },
      closeCandidate() {
        topicState.selectedCandidate = null;
        topicState.selectedRoundId = null;
      },
      async confirmSelectedCandidate() {
        projectStore.store.syncProject({
          project_id: "project-2",
          current_status: "script_ready",
        });
        topicState.confirmedTopicPackageId = `topic-package-${Date.now()}`;
      },
    };

    const scriptState = reactive({
      snapshot: null as null | {
        project_id: string;
        current_status: string;
        active_script: null;
      },
      history: [],
      selectedHistoryEntryId: null,
      isLoading: false,
      isRunningAction: false,
      loadError: null,
    });
    const scriptStore = {
      state: scriptState,
      async loadActiveScriptSnapshot() {
        calls.loadSnapshot += 1;
        scriptState.snapshot = {
          project_id: "project-2",
          current_status: "script_pending",
          active_script: null,
        };
      },
      async retryLoadActiveScriptSnapshot() {},
      selectHistoryEntry() {},
      async runPatchOnce() {},
      async runRegenOnce() {},
      async generateInitialScript() {
        calls.generateInitialScript += 1;
      },
    };

    const wrapper = mount(
      {
        render: () => h(RouterView),
      },
      {
        global: {
          plugins: [router, ElementPlus],
          provide: {
            [projectStoreKey as symbol]: projectStore.store as never,
            [topicStoreKey as symbol]: topicStore as never,
            [scriptStoreKey as symbol]: scriptStore as never,
          },
        },
      },
    );

    await wrapper.get("[data-testid='candidate-item-candidate-history']").trigger("click");
    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/projects/project-2/script");
    expect(calls.generateInitialScript).toBe(1);

    await router.push("/projects/project-2/topic");
    await flushPromises();

    await wrapper.get("[data-testid='candidate-item-candidate-current']").trigger("click");
    await wrapper.get("[data-testid='confirm-candidate']").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/projects/project-2/script");
    expect(calls.loadSnapshot).toBe(2);
    expect(calls.generateInitialScript).toBe(2);
  });
});
