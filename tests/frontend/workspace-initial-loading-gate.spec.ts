// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { reactive } from "vue";
import { describe, expect, it } from "vitest";

import AssetPanel from "../../frontend/src/components/asset/AssetPanel.vue";
import StoryboardPanel from "../../frontend/src/components/storyboard/StoryboardPanel.vue";
import { createAppRouter } from "../../frontend/src/router/index.js";
import { assetPlanningStoreKey } from "../../frontend/src/stores/asset-planning";
import { assetsStoreKey } from "../../frontend/src/stores/assets";
import { projectStoreKey } from "../../frontend/src/stores/project";
import { scriptStoreKey } from "../../frontend/src/stores/script";
import { storyboardStoreKey } from "../../frontend/src/stores/storyboard";
import { workspaceStoreKey } from "../../frontend/src/stores/workspace";

function pendingPromise() {
  return new Promise<void>(() => {});
}

function createProjectStoreStub() {
  const state = reactive({
    projectId: "project-loading-gate",
    currentStatus: "storyboard_ready",
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
      return "/projects/project-loading-gate/storyboard";
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

describe("workspace initial loading gates", () => {
  it("does not render stale storyboard preview before the first snapshot resolves", async () => {
    const router = await createRouterAt("/projects/project-loading-gate/storyboard");
    const storyboardState = reactive({
      snapshot: {
        current_status: "storyboard_ready",
        active_storyboard: {
          plan: {
            segments: [
              {
                segment_id: "old-segment",
                start_hint_sec: 0,
                end_hint_sec: 5,
                narrative_role: "old",
                script_excerpt: "OLD_STORYBOARD_PREVIEW_TEXT",
                visual_intent: "old visual",
                framing_hint: null,
                motion_hint: null,
              },
            ],
          },
          validation_result: {
            decision: "pass",
            errors: [],
            warnings: [],
          },
          execution_state: { generating: false },
        },
      },
      isLoading: true,
      isGenerating: false,
      loadError: null,
    });

    const wrapper = mount(StoryboardPanel, {
      global: {
        plugins: [router, ElementPlus],
        provide: {
          [projectStoreKey as symbol]: createProjectStoreStub() as never,
          [workspaceStoreKey as symbol]: createWorkspaceStoreStub() as never,
          [storyboardStoreKey as symbol]: {
            state: storyboardState,
            loadActiveStoryboardSnapshot: pendingPromise,
            retryLoad: pendingPromise,
            generateStoryboard: pendingPromise,
          } as never,
        },
      },
    });

    expect(wrapper.find(".storyboard-skeleton").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("OLD_STORYBOARD_PREVIEW_TEXT");
    wrapper.unmount();
  });

  it("does not render stale asset preview before the first asset snapshots resolve", async () => {
    const router = await createRouterAt("/projects/project-loading-gate/asset");
    const assetPlanningState = reactive({
      snapshot: {
        current_status: "assets_ready",
        active_asset_plan: {
          plan: {
            plan_version: "test",
            art_bible: {},
            visual_budget: {},
            downgrade_policy: {},
            global_audio_strategy: {},
            tts_plan: {},
            tasks: [],
            dependencies: [],
            cost_summary: {},
            global_production_notes: [],
          },
          validation_result: { decision: "pass", errors: [], warnings: [] },
          execution_state: { generating: false },
          graph_trace_summary: null,
          runtime_diagnostics: null,
        },
        active_asset_plan_record_id: "old-plan",
      },
      isLoading: true,
      isGenerating: false,
      loadError: null,
    });
    const assetsState = reactive({
      snapshot: {
        current_status: "assets_ready",
        active_assets: {
          asset_manifest_record_id: "old-manifest",
          source_asset_plan_record_id: "old-plan",
          manifest: {
            manifest_version: "test",
            source_asset_plan_id: "old-plan",
            source_storyboard_record_id: "old-storyboard",
            source_script_record_id: "old-script",
            execution_options: {
              execution_mode: "manual",
              voice_profile_id: null,
              enabled_provider_types: [],
              allow_manual_placeholders: true,
            },
            executions: [],
            artifacts: [],
            audio_summary: {},
            segment_routes: [],
            readiness: "ready_for_compose",
            notes: [],
          },
          local_validation: { decision: "pass", errors: [], warnings: [] },
          execution_state: { generating: false },
          graph_trace_summary: null,
          runtime_diagnostics: null,
        },
      },
      isLoading: true,
      isGenerating: false,
      isUploading: null,
      generatingTaskId: null,
      loadError: null,
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
            loadActiveStoryboardSnapshot: pendingPromise,
          } as never,
          [assetPlanningStoreKey as symbol]: {
            state: assetPlanningState,
            loadActiveAssetPlanSnapshot: pendingPromise,
            retryLoad: pendingPromise,
            generateAssetPlan: pendingPromise,
          } as never,
          [assetsStoreKey as symbol]: {
            state: assetsState,
            loadProject: pendingPromise,
            generateAssets: pendingPromise,
            generateSingleTask: pendingPromise,
            upgradeSegmentToVideo: pendingPromise,
            uploadArtifact: pendingPromise,
            acceptArtifact: pendingPromise,
            artifactFileUrl: () => "",
          } as never,
        },
      },
    });

    expect(wrapper.find(".asset-skeleton").exists()).toBe(true);
    expect(wrapper.find(".asset-overview-card").exists()).toBe(false);
    wrapper.unmount();
  });
});
