// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it } from "vitest";

import PublishPanel from "../../frontend/src/components/publish/PublishPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { publishStoreKey } from "../../frontend/src/stores/publish";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";

function pendingPromise() {
  return new Promise<void>(() => {});
}

function createProjectStoreStub(status = "render_ready") {
  const state = reactive({
    projectId: "project-publish-loading-ui",
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
      return `/projects/${state.projectId}/publish`;
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

describe("publish loading UI", () => {
  it("hides publish empty state while a publish package is being generated", async () => {
    const router = await createRouterAt("/projects/project-publish-loading-ui/publish");
    const publishState = reactive({
      isLoading: false,
      isGenerating: true,
      isOptimizingCover: false,
      isUploadingCover: false,
      isGeneratingCover: false,
      isLoadingTitleCandidates: false,
      isExporting: false,
      exportManifest: null,
      loadError: null,
      snapshot: {
        current_status: "render_ready",
        active_publish_package: null,
        active_render: null,
      },
    });

    const wrapper = mount(PublishPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub("render_ready") as never,
          [workspaceStoreKey as symbol]: createWorkspaceStoreStub() as never,
          [publishStoreKey as symbol]: {
            state: publishState,
            loadProject: pendingPromise,
            generatePackage: pendingPromise,
            async updatePackage() {},
            async optimizeCoverPrompt() {
              return { optimized_prompt: "" };
            },
            async uploadCover() {},
            async generateCover() {},
            async loadTitleCandidates() {
              return { candidates: [] };
            },
            async exportPackage() {
              return {};
            },
          } as never,
        },
      },
    });

    expect(wrapper.find(".stage-generating").exists()).toBe(true);
    expect(wrapper.find(".publish-empty").exists()).toBe(false);
    wrapper.unmount();
  });
});
