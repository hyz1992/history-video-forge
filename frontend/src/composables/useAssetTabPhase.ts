import { computed, type ComputedRef } from "vue";

import { isAssetPlanSnapshotGenerating, type AssetPlanningStore } from "../stores/asset-planning";
import type { AssetsStore } from "../stores/assets";

export type AssetTabPhase =
  | { kind: "loading" }
  | { kind: "no_plan" }
  | { kind: "error"; message: string }
  | { kind: "plan_generating" }
  | { kind: "plan_ready_no_manifest" }
  | { kind: "basic_assets_generating" }
  | { kind: "basic_assets_failed"; error: string }
  | { kind: "ready" };

export interface UseAssetTabPhaseInput {
  assetPlanningStore: AssetPlanningStore;
  assetsStore: AssetsStore;
  initialLoadDone: ComputedRef<boolean>;
}

export interface UseAssetTabPhaseReturn {
  phase: ComputedRef<AssetTabPhase>;
}

export function useAssetTabPhase(input: UseAssetTabPhaseInput): UseAssetTabPhaseReturn {
  const phase = computed<AssetTabPhase>(() => {
    const planSnap = input.assetPlanningStore.state.snapshot;
    const assetsSnap = input.assetsStore.state.snapshot;
    const planError = input.assetPlanningStore.state.loadError;
    const assetsError = input.assetsStore.state.loadError;

    const activePlan = planSnap?.active_asset_plan ?? null;
    const manifest = assetsSnap?.active_assets?.manifest ?? null;

    const isPlanGen =
      input.assetPlanningStore.state.isGenerating || isAssetPlanSnapshotGenerating(planSnap);
    const isAssetsGen =
      input.assetsStore.state.isGenerating ||
      assetsSnap?.active_assets?.execution_state?.generating === true;

    // 资产生成中优先于规划生成态：基础资产生成不阻塞页面，直接进入资产
    // 预览页（顶部横幅提示生成进度）——用户要求：资产规划完成后立即切换
    // 到资产预览页，口播等基础资产在页面内后台生成。
    // 2026-08-24 修复：此前 plan_generating 优先，规划标志短暂残留时会与
    // 资产生成态叠加，渲染成全屏阻塞的"正在生成基础资源"。
    if (isAssetsGen) {
      return { kind: "basic_assets_generating" };
    }

    // 规划生成中：优先于初始查询 loading，避免已知生成态被误显示成普通查询
    if (isPlanGen) {
      return { kind: "plan_generating" };
    }

    if (!input.initialLoadDone.value) {
      return { kind: "loading" };
    }

    // 致命错误（不在生成态且 loadError 非空）
    if (!isPlanGen && !isAssetsGen && (planError || assetsError)) {
      const msg = planError ?? assetsError ?? "未知错误";
      // 基础资产生成失败（有 plan 但无 manifest 且有 error）
      if (activePlan && !manifest && !isAssetsGen) {
        return { kind: "basic_assets_failed", error: msg };
      }
      return { kind: "error", message: msg };
    }

    // 无规划
    if (!activePlan || !activePlan.plan) {
      return { kind: "no_plan" };
    }

    // 规划就绪但无 manifest
    if (!manifest) {
      if (isAssetsGen) {
        return { kind: "basic_assets_generating" };
      }
      return { kind: "plan_ready_no_manifest" };
    }

    return { kind: "ready" };
  });

  return { phase };
}
