// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it } from "vitest";

import ScriptPanel from "../../frontend/src/components/script/ScriptPanel.vue";
import StoryboardPanel from "../../frontend/src/components/storyboard/StoryboardPanel.vue";
import TopicPanel from "../../frontend/src/components/topic/TopicPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { scriptStoreKey } from "../../frontend/src/stores/script";
import { storyboardStoreKey } from "../../frontend/src/stores/storyboard";
import { topicStoreKey } from "../../frontend/src/stores/topic";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";

function pendingPromise() {
  return new Promise<void>(() => {});
}

function createProjectStoreStub(status = "topic_generating") {
  const state = reactive({
    projectId: "project-loading-ui",
    currentStatus: status,
    projects: [],
  });

  return {
    state,
    syncProject(snapshot: { project_id: string; current_status: string }) {
      state.projectId = snapshot.project_id;
      state.currentStatus = snapshot.current_status;
    },
    async ensureProject() {
      return state.projectId;
    },
    async createProject() {
      return {
        project_id: state.projectId,
        current_status: state.currentStatus,
      };
    },
    async loadProjects() {
      return [];
    },
    async loadProject() {},
    async deleteProject() {},
    resolveProjectWorkspacePath() {
      return `/projects/${state.projectId}/topic`;
    },
  };
}

function createWorkspaceStoreStub() {
  const state = reactive({
    currentStep: 0,
  });

  return {
    state,
    setCurrentStep(step: number) {
      state.currentStep = step;
    },
  };
}

async function createRouterAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  return router;
}

describe("workspace loading UI", () => {
  it("shows a manual refresh action while topic recommendations are generating", async () => {
    const router = await createRouterAt("/projects/project-loading-ui/topic");
    const topicState = reactive({
      activeTab: "system",
      candidates: [],
      currentRound: null,
      historyRounds: [],
      selectedCandidate: null,
      selectedRoundId: null,
      isGenerating: true,
      isConfirming: false,
      confirmedTopicPackageId: null,
      loadError: null,
      snapshot: { current_status: "topic_generating" },
    });

    const wrapper = mount(TopicPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [workspaceStoreKey as symbol]: createWorkspaceStoreStub() as never,
          [topicStoreKey as symbol]: {
            state: topicState,
            selectTab() {},
            async generateSystemRecommendations() {},
            openCandidate() {},
            closeCandidate() {},
            async confirmSelectedCandidate() {},
            async loadExistingTopic() {},
            async loadSnapshot() {
              return {
                active_topic_package: null,
                current_status: "topic_generating",
                topic_candidates: null,
              };
            },
          } as never,
        },
      },
    });

    const refreshButton = wrapper.get(".stage-generating .el-button");
    expect(wrapper.find(".stage-generating").exists()).toBe(true);
    expect(refreshButton.text()).toContain("刷新状态");
    expect(refreshButton.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("hides script workspace chrome while the script is generating", async () => {
    const router = await createRouterAt("/projects/project-loading-ui/script");
    const scriptState = reactive({
      snapshot: {
        project_id: "project-loading-ui",
        current_status: "script_generating",
        active_script: null,
      },
      history: [],
      selectedHistoryEntryId: null,
      isLoading: false,
      isRunningAction: false,
      loadError: null,
    });

    const wrapper = mount(ScriptPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub("script_generating") as never,
          [workspaceStoreKey as symbol]: createWorkspaceStoreStub() as never,
          [scriptStoreKey as symbol]: {
            state: scriptState,
            loadActiveScriptSnapshot: pendingPromise,
            retryLoadActiveScriptSnapshot: pendingPromise,
            generateInitialScript: pendingPromise,
            selectHistoryEntry() {},
            runPatchOnce: pendingPromise,
            runRegenOnce: pendingPromise,
          } as never,
        },
      },
    });

    expect(wrapper.find(".stage-generating").exists()).toBe(true);
    expect(wrapper.find("[data-testid='script-page-header']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='script-trace-entry']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows loading feedback when refreshing storyboard generation status", async () => {
    const router = await createRouterAt("/projects/project-loading-ui/storyboard");
    let resolveRefresh!: () => void;
    const storyboardState = reactive({
      snapshot: {
        current_status: "storyboard_generating",
        active_storyboard: null,
      },
      isLoading: false,
      isGenerating: false,
      loadError: null,
    });

    const wrapper = mount(StoryboardPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub("storyboard_generating") as never,
          [workspaceStoreKey as symbol]: createWorkspaceStoreStub() as never,
          [storyboardStoreKey as symbol]: {
            state: storyboardState,
            loadActiveStoryboardSnapshot: pendingPromise,
            retryLoad: () =>
              new Promise<void>((resolve) => {
                resolveRefresh = resolve;
              }),
            generateStoryboard: pendingPromise,
          } as never,
        },
      },
    });

    const refreshButton = wrapper.get(".stage-generating .el-button");
    await refreshButton.trigger("click");
    await wrapper.vm.$nextTick();

    expect(refreshButton.attributes("disabled")).toBe("");
    resolveRefresh();
    wrapper.unmount();
  });
});
