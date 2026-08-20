// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
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
  let costStoreState: { lastQuote: unknown; costSummary: unknown; costRecords: unknown };

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
          [generationCostStoreKey as symbol]: {
            state: (() => {
              costStoreState = reactive({
                lastQuote: null,
                costSummary: { data: null, loading: false, error: null },
                costRecords: { data: null, loading: false, error: null },
              });
              return costStoreState;
            })(),
            createQuote: vi.fn(async () => {
              const value = {
                quote: {
                  quote_id: "quote_retry_1",
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
                idempotencyKey: "key_retry_1",
              };
              (costStoreState as { lastQuote: unknown }).lastQuote = value;
              return { ok: true, value };
            }),
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
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

    // 点击重试：先取后端 quote，弹出费用确认对话框（任务 11）
    await retryBtn.trigger("click");
    await flushPromises();

    // quote 确认对话框出现并展示报价
    const confirmBtn = wrapper.find('[data-testid="quote-confirm"]');
    expect(confirmBtn.exists()).toBe(true);
    expect(wrapper.find('[data-testid="quote-estimated"]').exists()).toBe(true);

    // 确认后以 quote 提交单任务生成
    await confirmBtn.trigger("click");
    await flushPromises();
    expect(generateSingleTask).toHaveBeenCalledTimes(1);
    expect(generateSingleTask).toHaveBeenCalledWith("tts_001", {
      quoteId: "quote_retry_1",
      idempotencyKey: "key_retry_1",
      authorizeBudgetOverride: false,
    });

    wrapper.unmount();
  });

  it("does not show retry button for non-failed tasks", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
    });
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

  it("本地部署 quote 不可报价时回退无 quote 本地路径（付费部署由后端 409 兜底）", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const failureNote = "provider call failed";
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
    costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
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
              snapshot: { current_status: "storyboard_ready", active_storyboard: { plan: { segments: [] } } },
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
          [generationCostStoreKey as symbol]: {
            state: costStoreState,
            createQuote: vi.fn(async () => ({
              ok: false,
              error: { code: "generation_quote_resolution_failed" },
            })),
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
          } as never,
        },
      },
    });

    await flushPromises();

    const retryBtn = wrapper.find(".asset-blocked-chip-retry");
    await retryBtn.trigger("click");
    await flushPromises();

    // 回退路径：直接无 quote 提交单任务（quoteId 为空串表示无 quote 提交）
    expect(generateSingleTask).toHaveBeenCalledTimes(1);
    expect(generateSingleTask).toHaveBeenCalledWith("tts_001", {
      quoteId: "",
      idempotencyKey: "",
      authorizeBudgetOverride: false,
    });

    wrapper.unmount();
  });

  it("非本地错误码（网络/服务故障）不回退，展示错误提示", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const failureNote = "provider call failed";
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
      await pendingPromise();
    });
    costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
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
              snapshot: { current_status: "storyboard_ready", active_storyboard: { plan: { segments: [] } } },
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
          [generationCostStoreKey as symbol]: {
            state: costStoreState,
            createQuote: vi.fn(async () => ({
              ok: false,
              error: { code: "http_500" },
            })),
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
          } as never,
        },
      },
    });

    await flushPromises();

    const retryBtn = wrapper.find(".asset-blocked-chip-retry");
    await retryBtn.trigger("click");
    await flushPromises();

    // 非本地错误码：不提交、不回退，且不弹空对话框
    expect(generateSingleTask).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="quote-confirm"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("轮3 M-3：提交返回 409 业务冲突时不重开对话框复用旧 quote，提示重新报价", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const failureNote = "provider call failed";
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
      // 409 业务冲突（如 quote 已消费）
      const err = new Error("generation_quote_consumed") as Error & { status?: number };
      err.status = 409;
      throw err;
    });
    costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
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
              snapshot: { current_status: "storyboard_ready", active_storyboard: { plan: { segments: [] } } },
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
          [generationCostStoreKey as symbol]: {
            state: costStoreState,
            createQuote: vi.fn(async () => {
              const value = {
                quote: {
                  quote_id: "quote_conflict_1",
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
                idempotencyKey: "key_conflict_1",
              };
              costStoreState.lastQuote = value;
              return { ok: true, value };
            }),
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
          } as never,
        },
      },
    });

    await flushPromises();

    // 取 quote → 确认 → 提交被 409 拒绝
    await wrapper.find(".asset-blocked-chip-retry").trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();

    // 业务冲突：对话框关闭（不重开复用旧 quote），等待用户重新报价
    expect(generateSingleTask).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-testid="quote-confirm"]').exists()).toBe(false);

    wrapper.unmount();
  });

  it("F-1a：提交失败后重开对话框，重试复用同一 quote 与同一 idempotency key", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const failureNote = "provider call failed";
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
    let submitCount = 0;
    const generateSingleTask = vi.fn(async () => {
      submitCount++;
      if (submitCount === 1) {
        throw new Error("network_error");
      }
      await pendingPromise();
    });
    const createQuoteMock = vi.fn(async () => {
      const value = {
        quote: {
          quote_id: "quote_retry_1",
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
        idempotencyKey: "key_retry_1",
      };
      costStoreState.lastQuote = value;
      return { ok: true, value };
    });
    costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
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
              snapshot: { current_status: "storyboard_ready", active_storyboard: { plan: { segments: [] } } },
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
          [generationCostStoreKey as symbol]: {
            state: costStoreState,
            createQuote: createQuoteMock,
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
          } as never,
        },
      },
    });

    await flushPromises();

    // 第一次：取 quote → 确认 → 提交失败（网络）
    await wrapper.find(".asset-blocked-chip-retry").trigger("click");
    await flushPromises();
    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();

    // 失败后对话框重开（同一 quote，未重新报价），再次确认 → 同一 quote 同一 key 重提交
    expect(generateSingleTask).toHaveBeenCalledTimes(1);
    const confirmAgain = wrapper.find('[data-testid="quote-confirm"]');
    expect(confirmAgain.exists()).toBe(true);
    await confirmAgain.trigger("click");
    await flushPromises();

    expect(generateSingleTask).toHaveBeenCalledTimes(2);
    expect(generateSingleTask).toHaveBeenNthCalledWith(2, "tts_001", {
      quoteId: "quote_retry_1",
      idempotencyKey: "key_retry_1",
      authorizeBudgetOverride: false,
    });
    // 重试路径未重新报价（createQuote 只调一次）
    expect(createQuoteMock).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("F-1b：quote 过期后确认不提交旧 quote，重新报价（新 quote 新 key）", async () => {
    const router = await createRouterAt("/projects/project-retry-failed/asset");
    const failureNote = "provider call failed";
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
      await pendingPromise();
    });
    costStoreState = reactive({
      lastQuote: null,
      costSummary: { data: null, loading: false, error: null },
      costRecords: { data: null, loading: false, error: null },
    });
    const createQuote = vi.fn(async () => {
      const isFirst = costStoreState.lastQuote === null;
      const value = {
        quote: {
          quote_id: isFirst ? "quote_expired_1" : "quote_fresh_2",
          operation: "assets.generate",
          expires_at: isFirst ? "2020-01-01T00:00:00.000Z" : "2099-01-01T00:00:00.000Z",
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
        idempotencyKey: isFirst ? "key_expired_1" : "key_fresh_2",
      };
      costStoreState.lastQuote = value;
      return { ok: true, value };
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
              snapshot: { current_status: "storyboard_ready", active_storyboard: { plan: { segments: [] } } },
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
          [generationCostStoreKey as symbol]: {
            state: costStoreState,
            createQuote,
            loadCostSummary: vi.fn(async () => undefined),
            loadCostRecords: vi.fn(async () => undefined),
          } as never,
        },
      },
    });

    await flushPromises();

    // 触发单任务生成 → 取到过期 quote → 对话框显示
    await wrapper.find(".asset-blocked-chip-retry").trigger("click");
    await flushPromises();
    expect(createQuote).toHaveBeenCalledTimes(1);

    // 确认过期 quote：不提交，自动重新报价（第二次 createQuote）
    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();
    expect(createQuote).toHaveBeenCalledTimes(2);
    // 旧 quote 未被提交
    expect(generateSingleTask).not.toHaveBeenCalled();

    // 新 quote 对话框出现，确认后以新 quote 新 key 提交
    expect(costStoreState.lastQuote?.quote.quote_id).toBe("quote_fresh_2");
    await wrapper.find('[data-testid="quote-confirm"]').trigger("click");
    await flushPromises();
    expect(generateSingleTask).toHaveBeenCalledTimes(1);
    expect(generateSingleTask).toHaveBeenCalledWith("tts_001", {
      quoteId: "quote_fresh_2",
      idempotencyKey: "key_fresh_2",
      authorizeBudgetOverride: false,
    });

    wrapper.unmount();
  });
});
