// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus, { ElMessage, ElMessageBox } from "element-plus";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import AssetPanel from "../../../frontend/src/components/asset/AssetPanel.vue";
import { generationCostStoreKey } from "../../../frontend/src/stores/generation-cost";
import { createAppRouter } from "../../../frontend/src/router/index.js";
import { assetPlanningStoreKey } from "../../../frontend/src/stores/asset-planning";
import { assetsStoreKey } from "../../../frontend/src/stores/assets";
import { projectStoreKey } from "../../../frontend/src/stores/project";
import { scriptStoreKey } from "../../../frontend/src/stores/script";
import { storyboardStoreKey } from "../../../frontend/src/stores/storyboard";
import { workspaceStoreKey } from "../../../frontend/src/stores/workspace";

/**
 * S2-2A 外部审查 B1 整改测试：付费路径下"成功反馈必须在用户确认报价提交
 * 之后触发"——打开报价对话框/取消时不得提前弹"完成"提示。
 */

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function pendingPromise() {
  return new Promise<void>(() => {});
}

function createProjectStoreStub() {
  const state = reactive({
    projectId: "project-quote-timing",
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
      tasks: [
        { task_id: "tts_001", task_type: "tts_audio", segment_id: "global" },
      ],
      tts_plan: {},
    },
    validation_result: { decision: "pass", errors: [], warnings: [] },
  };
}

/** 失败 tts 任务：产生 blockedItems（缺失项生成入口可见）。 */
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

describe("asset panel quote success timing (外部审查 B1 整改)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function mountPanel(overrides: {
    createQuote: ReturnType<typeof vi.fn>;
    generateAssets: ReturnType<typeof vi.fn>;
    costStoreState: {
      lastQuote: unknown;
      costSummary: unknown;
      costRecords: unknown;
    };
  }) {
    const router = await createRouterAt("/projects/project-quote-timing/asset");
    const assetsState = reactive({
      snapshot: {
        current_status: "assets_blocked",
        active_assets: activeAssetsWithFailedTts("WAV chunk extends past buffer end"),
      },
      isLoading: false,
      isGenerating: false,
      isUploading: null,
      generatingTaskId: null,
      generatingTaskIds: new Set<string>(),
      loadError: null,
    });
    return mount(AssetPanel, {
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
            generateAssets: overrides.generateAssets,
            generateSingleTask: pendingPromise,
            upgradeSegmentToVideo: pendingPromise,
            uploadArtifact: pendingPromise,
            acceptArtifact: pendingPromise,
            artifactFileUrl: () => "",
          } as never,
          [generationCostStoreKey as symbol]: {
            state: overrides.costStoreState,
            createQuote: overrides.createQuote,
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
          } as never,
        },
      },
    });
  }

  function quoteValue(quoteId: string) {
    return {
      quote: {
        quote_id: quoteId,
        operation: "assets.generate",
        expires_at: "2099-01-01T00:00:00.000Z",
        configuration_hash: "fnv1a64:test",
        pricing_versions: ["test"],
        items: [],
        estimated_cost_cny: "0.000000",
        authorization_cost_cny: "0.000000",
        contains_unbounded_item: false,
        budget_limit_cny: null,
        over_budget: false,
        requires_budget_override: false,
      },
      idempotencyKey: `key_${quoteId}`,
    };
  }

  it("付费路径：确认前/取消后不弹\"剩余资产生成完成\"，确认提交成功后才触发", async () => {
    const successSpy = vi.spyOn(ElMessage, "success").mockImplementation(() => undefined as never);
    vi.spyOn(ElMessage, "error").mockImplementation(() => undefined as never);
    vi.spyOn(ElMessage, "warning").mockImplementation(() => undefined as never);
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);

    const costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
    });
    const createQuote = vi.fn(async () => {
      const value = quoteValue("quote_timing_1");
      costStoreState.lastQuote = value;
      return { ok: true, value };
    });
    const generateAssets = vi.fn(async () => {
      costStoreState.lastQuote = null;
    });
    const wrapper = await mountPanel({ costStoreState, createQuote, generateAssets });
    await flushPromises();

    // 点击"批量生成剩余"→ 确认框 → quote 对话框打开
    await wrapper.find(".asset-overview-toggle-actions .el-button").trigger("click");
    await flushPromises();
    const confirmBtn = wrapper.find('[data-testid="quote-confirm"]');
    expect(confirmBtn.exists()).toBe(true);
    // 红灯语义（旧实现）：对话框刚打开就弹"剩余资产生成完成"
    expect(successSpy).not.toHaveBeenCalled();

    // 取消：仍不得弹成功提示
    await wrapper.find('[data-testid="quote-cancel"]').trigger("click");
    await flushPromises();
    expect(successSpy).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-confirm"]').exists()).toBe(false);

    // 再次发起 → 确认提交 → 提交成功后才弹"剩余资产生成完成"
    await wrapper.find(".asset-overview-toggle-actions .el-button").trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();
    expect(generateAssets).toHaveBeenCalledTimes(1);
    expect(generateAssets).toHaveBeenCalledWith({
      mode: "missing_only",
      quoteId: "quote_timing_1",
      idempotencyKey: "key_quote_timing_1",
      authorizeBudgetOverride: false,
    });
    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(successSpy).toHaveBeenCalledWith("剩余资产生成完成");

    wrapper.unmount();
  });
});
