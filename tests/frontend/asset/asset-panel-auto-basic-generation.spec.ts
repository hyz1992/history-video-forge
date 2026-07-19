// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import AssetPanel from "../../../frontend/src/components/asset/AssetPanel.vue";
import { createAppRouter } from "../../../frontend/src/router/index.js";
import { assetPlanningStoreKey } from "../../../frontend/src/stores/asset-planning";
import { assetsStoreKey } from "../../../frontend/src/stores/assets";
import { projectStoreKey } from "../../../frontend/src/stores/project";
import { scriptStoreKey } from "../../../frontend/src/stores/script";
import { storyboardStoreKey } from "../../../frontend/src/stores/storyboard";
import { workspaceStoreKey } from "../../../frontend/src/stores/workspace";

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function pendingPromise() {
  return new Promise<void>(() => {});
}

function createProjectStoreStub() {
  const state = reactive({
    projectId: "project-auto-basic-assets",
    currentStatus: "asset_plan_ready",
    projects: [],
  });

  return {
    state,
    syncProject(snapshot: { project_id: string; current_status: string }) {
      state.projectId = snapshot.project_id;
      state.currentStatus = snapshot.current_status;
    },
    async loadProjects() {
      return [];
    },
    async loadProject() {},
    async createProject() {
      return null;
    },
    async deleteProject() {},
    resolveProjectWorkspacePath() {
      return `/projects/${state.projectId}/asset`;
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

function createScriptStoreStub() {
  return {
    state: reactive({
      snapshot: null,
      history: [],
      selectedHistoryEntryId: null,
      isLoading: false,
      isRunningAction: false,
      loadError: null,
    }),
    async loadActiveScriptSnapshot() {},
    async retryLoadActiveScriptSnapshot() {},
    selectHistoryEntry() {},
    async runPatchOnce() {},
    async runRegenOnce() {},
  };
}

async function createRouterAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  return router;
}

function activeAssetPlan() {
  return {
    plan: {
      plan_version: "test",
      art_bible: {},
      visual_budget: {},
      downgrade_policy: {},
      global_audio_strategy: {},
      tts_plan: {},
      tasks: [
        { task_id: "tts", task_type: "tts_audio", segment_id: "global" },
        { task_id: "subtitle", task_type: "subtitle", segment_id: "global" },
      ],
      dependencies: [],
      cost_summary: {},
      global_production_notes: [],
    },
    validation_result: { decision: "pass", errors: [], warnings: [] },
    execution_state: { generating: false },
    graph_trace_summary: null,
    runtime_diagnostics: null,
  };
}

function activeAssetsGenerating() {
  return {
    asset_manifest_record_id: "manifest-starting",
    source_asset_plan_record_id: "plan-ready",
    manifest: {
      manifest_version: "test",
      source_asset_plan_id: "plan-ready",
      source_storyboard_record_id: "storyboard-ready",
      source_script_record_id: "script-ready",
      execution_options: {
        execution_mode: "manual",
        voice_profile_id: null,
        enabled_provider_types: ["tts", "sfx", "bgm"],
        allow_manual_placeholders: true,
      },
      executions: [],
      artifacts: [],
      audio_summary: {},
      segment_routes: [],
      readiness: "blocked",
      notes: [],
    },
    local_validation: { decision: "blocked", errors: [], warnings: [] },
    execution_state: { generating: true },
    graph_trace_summary: null,
    runtime_diagnostics: null,
  };
}

describe("asset panel basic generation gate", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not auto-start basic asset generation when a ready asset plan has no manifest", async () => {
    const router = await createRouterAt("/projects/project-auto-basic-assets/asset");
    const assetPlanningState = reactive({
      snapshot: {
        current_status: "asset_plan_ready",
        active_asset_plan: activeAssetPlan(),
        active_asset_plan_record_id: "plan-ready",
      },
      isLoading: false,
      isGenerating: false,
      loadError: null,
    });
    const assetsState = reactive({
      snapshot: {
        current_status: "asset_plan_ready",
        active_assets: null,
      },
      isLoading: false,
      isGenerating: false,
      isUploading: null,
      generatingTaskId: null,
      generatingTaskIds: new Set<string>(),
      loadError: null,
    });
    const generateAssets = vi.fn(async () => {
      assetsState.isGenerating = true;
      assetsState.snapshot = {
        current_status: "assets_generating",
        active_assets: activeAssetsGenerating(),
      };
      await pendingPromise();
    });

    const wrapper = mount(AssetPanel, {
      global: {
        plugins: [router, ElementPlus],
        stubs: {
          SegmentAssetCard: true,
        },
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [workspaceStoreKey as symbol]: createWorkspaceStoreStub() as never,
          [scriptStoreKey as symbol]: createScriptStoreStub() as never,
          [storyboardStoreKey as symbol]: {
            state: reactive({
              snapshot: {
                current_status: "storyboard_ready",
                active_storyboard: { plan: { segments: [] } },
              },
              isLoading: false,
              isGenerating: false,
              loadError: null,
            }),
            async loadActiveStoryboardSnapshot() {},
          } as never,
          [assetPlanningStoreKey as symbol]: {
            state: assetPlanningState,
            async loadActiveAssetPlanSnapshot() {},
            async retryLoad() {},
            generateAssetPlan: pendingPromise,
          } as never,
          [assetsStoreKey as symbol]: {
            state: assetsState,
            async loadProject() {},
            generateAssets,
            generateSingleTask: pendingPromise,
            upgradeSegmentToVideo: pendingPromise,
            uploadArtifact: pendingPromise,
            acceptArtifact: pendingPromise,
            artifactFileUrl: () => "",
          } as never,
        },
      },
    });

    await flushPromises();

    expect(generateAssets).not.toHaveBeenCalled();
    expect(wrapper.find(".asset-plan-overview-wrapper").exists()).toBe(true);
    expect(document.body.querySelector(".stage-loading-bar")).toBeNull();
    wrapper.unmount();
  });
});
