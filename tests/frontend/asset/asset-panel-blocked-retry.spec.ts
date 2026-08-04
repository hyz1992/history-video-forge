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
    projectId: "project-retry-failed",
    currentStatus: "assets_blocked",
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
  const state = reactive({ currentStep: 0 });
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

function activeAssetPlanWithTts() {
  return {
    plan: {
      plan_version: "test",
      art_bible: {},
      visual_budget: {},
      downgrade_policy: {},
      global_audio_strategy: {},
      tts_plan: {},
      tasks: [
        { task_id: "tts_001", task_type: "tts_audio", segment_id: "global" },
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

function activeAssetsWithFailedTts(failureNote: string) {
  return {
    asset_manifest_record_id: "manifest-failed",
    source_asset_plan_record_id: "plan-ready",
    manifest: {
      manifest_version: "test",
      source_asset_plan_id: "plan-ready",
      source_storyboard_record_id: "storyboard-ready",
      source_script_record_id: "script-ready",
      execution_options: {
        execution_mode: "auto_available",
        voice_profile_id: "voice-1",
        enabled_provider_types: ["tts"],
        allow_manual_placeholders: true,
      },
      executions: [
        {
          task_id: "tts_001",
          task_type: "tts_audio",
          status: "failed",
          output_artifact_ids: [],
          notes: [failureNote],
        },
      ],
      artifacts: [],
      audio_summary: {},
      segment_routes: [],
      readiness: "blocked",
      notes: [],
    },
    local_validation: { decision: "blocked", errors: ["assets_execution_incomplete"], warnings: [] },
    execution_state: { generating: false },
    graph_trace_summary: null,
    runtime_diagnostics: null,
  };
}

describe("asset panel blocked retry", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows failure note and retry button for failed tts_audio in blocked chips", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const failureNote = "WAV chunk \"data\" extends past buffer end";
    const assetsState = reactive({
      snapshot: {
        current_status: "assets_blocked",
        active_assets: activeAssetsWithFailedTts(failureNote),
      },
      isLoading: false,
      isGenerating: false,
      isUploading: null,
      generatingTaskId: null,
      generatingTaskIds: new Set<string>(),
      loadError: null,
    });
    const generateSingleTask = vi.fn(async () => {
      assetsState.isGenerating = true;
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
            state: reactive({
              snapshot: {
                current_status: "asset_plan_ready",
                active_asset_plan: activeAssetPlanWithTts(),
                active_asset_plan_record_id: "plan-ready",
              },
              isLoading: false,
              isGenerating: false,
              loadError: null,
            }),
            async loadActiveAssetPlanSnapshot() {},
            async retryLoad() {},
            generateAssetPlan: pendingPromise,
          } as never,
          [assetsStoreKey as symbol]: {
            state: assetsState,
            async loadProject() {},
            generateAssets: pendingPromise,
            generateSingleTask,
            upgradeSegmentToVideo: pendingPromise,
            uploadArtifact: pendingPromise,
            acceptArtifact: pendingPromise,
            artifactFileUrl: () => "",
          } as never,
        },
      },
    });

    await flushPromises();

    // 失败原因展示在 chip 上
    const chipNote = wrapper.find(".asset-blocked-chip-note");
    expect(chipNote.exists()).toBe(true);
    expect(chipNote.text()).toContain(failureNote);

    // failed chip 有重试按钮
    const retryBtn = wrapper.find(".asset-blocked-chip-retry");
    expect(retryBtn.exists()).toBe(true);

    // 点击重试触发 generateSingleTask
    await retryBtn.trigger("click");
    await flushPromises();
    expect(generateSingleTask).toHaveBeenCalledTimes(1);
    expect(generateSingleTask).toHaveBeenCalledWith("tts_001");

    wrapper.unmount();
  });

  it("does not show retry button for non-failed tasks", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const assetsState = reactive({
      snapshot: {
        current_status: "assets_blocked",
        active_assets: {
          asset_manifest_record_id: "manifest-waiting",
          source_asset_plan_record_id: "plan-ready",
          manifest: {
            manifest_version: "test",
            source_asset_plan_id: "plan-ready",
            source_storyboard_record_id: "storyboard-ready",
            source_script_record_id: "script-ready",
            execution_options: {
              execution_mode: "auto_available",
              voice_profile_id: null,
              enabled_provider_types: ["tts"],
              allow_manual_placeholders: true,
            },
            executions: [
              {
                task_id: "tts_001",
                task_type: "tts_audio",
                status: "waiting_manual_upload",
                output_artifact_ids: [],
              },
            ],
            artifacts: [],
            audio_summary: {},
            segment_routes: [],
            readiness: "blocked",
            notes: [],
          },
          local_validation: { decision: "blocked", errors: [], warnings: [] },
          execution_state: { generating: false },
          graph_trace_summary: null,
          runtime_diagnostics: null,
        },
      },
      isLoading: false,
      isGenerating: false,
      isUploading: null,
      generatingTaskId: null,
      generatingTaskIds: new Set<string>(),
      loadError: null,
    });

    const wrapper = mount(AssetPanel, {
      global: {
        plugins: [router, ElementPlus],
        stubs: { SegmentAssetCard: true },
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
            state: reactive({
              snapshot: {
                current_status: "asset_plan_ready",
                active_asset_plan: activeAssetPlanWithTts(),
                active_asset_plan_record_id: "plan-ready",
              },
              isLoading: false,
              isGenerating: false,
              loadError: null,
            }),
            async loadActiveAssetPlanSnapshot() {},
            async retryLoad() {},
            generateAssetPlan: pendingPromise,
          } as never,
          [assetsStoreKey as symbol]: {
            state: assetsState,
            async loadProject() {},
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

    await flushPromises();

    // waiting_manual_upload（非 failed）不应显示重试按钮
    expect(wrapper.find(".asset-blocked-chip-retry").exists()).toBe(false);
    wrapper.unmount();
  });
});
