import { describe, expect, it } from "vitest";
import { computed, ref } from "vue";

import { useAssetTabPhase } from "../../../frontend/src/composables/useAssetTabPhase.js";

function mockPlanningStore(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      isLoading: false,
      isGenerating: overrides.isGenerating ?? false,
      loadError: (overrides.loadError as string) ?? null,
      snapshot: (overrides.snapshot as Record<string, unknown>) ?? null,
    },
    loadActiveAssetPlanSnapshot: async () => {},
    generateAssetPlan: async () => {},
    retryLoad: async () => {},
  } as any;
}

function mockAssetsStore(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      isLoading: false,
      isGenerating: overrides.isGenerating ?? false,
      generatingTaskIds: new Set(),
      isUploading: null,
      generatingTaskId: null,
      loadError: (overrides.loadError as string) ?? null,
      snapshot: (overrides.snapshot as Record<string, unknown>) ?? null,
    },
    loadProject: async () => {},
    generateAssets: async () => {},
    generateSingleTask: async () => {},
    upgradeSegmentToVideo: async () => {},
    uploadArtifact: async () => {},
    acceptArtifact: async () => {},
    artifactFileUrl: () => "",
  } as any;
}

function planSnapshot(status: string, overrides?: Record<string, unknown>) {
  return {
    current_status: status,
    active_asset_plan: overrides?.active_asset_plan as Record<string, unknown> ?? null,
    active_asset_plan_record_id: null,
  };
}

function activePlan(overrides?: Record<string, unknown>) {
  return {
    plan: { tasks: [], plan_version: "v1" },
    validation_result: null,
    execution_state: overrides?.execution_state as Record<string, unknown> ?? null,
  };
}

function assetSnapshot(overrides?: Record<string, unknown>) {
  return {
    current_status: (overrides?.current_status as string) ?? null,
    active_assets: overrides?.active_assets as Record<string, unknown> ?? null,
  };
}

function activeAssets(overrides?: Record<string, unknown>) {
  return {
    manifest: overrides?.manifest as Record<string, unknown> ?? null,
    execution_state: overrides?.execution_state as Record<string, unknown> ?? null,
  };
}

describe("useAssetTabPhase", () => {
  it("returns loading when initialLoadDone is false", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore(),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => false),
    });
    expect(phase.value.kind).toBe("loading");
  });

  it("returns no_plan when there is no active plan and not generating", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("storyboard_ready"),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "no_plan" });
  });

  it("returns plan_generating when asset plan is generating", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_generating"),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "plan_generating" });
  });

  it("returns plan_generating when local asset plan generation is running before snapshot refreshes", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        isGenerating: true,
        snapshot: planSnapshot("storyboard_ready"),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "plan_generating" });
  });

  it("prefers plan_generating over initial loading when the snapshot already says generating", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_generating"),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => false),
    });
    expect(phase.value).toMatchObject({ kind: "plan_generating" });
  });

  it("returns plan_generating when execution_state.generating is true", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("storyboard_ready", {
          active_asset_plan: activePlan({ execution_state: { generating: true } }),
        }),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "plan_generating" });
  });

  it("returns plan_ready_no_manifest when plan exists but no manifest", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_ready", {
          active_asset_plan: activePlan(),
        }),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "plan_ready_no_manifest" });
  });

  it("returns basic_assets_generating when plan exists, no manifest, assets generating", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_ready", {
          active_asset_plan: activePlan(),
        }),
      }),
      assetsStore: mockAssetsStore({
        isGenerating: true,
      }),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "basic_assets_generating" });
  });

  it("资产生成态优先于残留的规划生成标志（不渲染全屏阻塞的规划 loading）", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_generating", {
          active_asset_plan: activePlan({ execution_state: { generating: true } }),
        }),
      }),
      assetsStore: mockAssetsStore({
        isGenerating: true,
      }),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "basic_assets_generating" });
  });

  it("returns basic_assets_failed when plan exists, no manifest, loadError and not generating", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_ready", {
          active_asset_plan: activePlan(),
        }),
      }),
      assetsStore: mockAssetsStore({
        loadError: "TTS 合成失败",
      }),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "basic_assets_failed", error: "TTS 合成失败" });
  });

  it("returns ready when manifest exists", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        snapshot: planSnapshot("asset_plan_ready", {
          active_asset_plan: activePlan(),
        }),
      }),
      assetsStore: mockAssetsStore({
        snapshot: assetSnapshot({
          active_assets: activeAssets({ manifest: { manifest_version: "v1" } }),
        }),
      }),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "ready" });
  });

  it("returns error for non-generating loadError without active plan", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        loadError: "网络错误",
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "error", message: "网络错误" });
  });

  it("prefers plan_generating over error when generating", () => {
    const { phase } = useAssetTabPhase({
      assetPlanningStore: mockPlanningStore({
        loadError: "transient error",
        snapshot: planSnapshot("asset_plan_generating"),
      }),
      assetsStore: mockAssetsStore(),
      initialLoadDone: computed(() => true),
    });
    expect(phase.value).toMatchObject({ kind: "plan_generating" });
  });
});
