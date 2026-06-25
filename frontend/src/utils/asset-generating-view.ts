export type AssetGeneratingViewKind = "asset_plan" | "assets";

export interface AssetGeneratingViewInput {
  hasAssetPlan: boolean;
  hasManifest: boolean;
  isPlanGenerating: boolean;
  isAssetsGenerating: boolean;
  isPolling?: boolean;
  planProgress?: AssetGenerationProgress | null;
}

export interface AssetGenerationProgress {
  phase: string;
  completed_chunks: number;
  total_chunks: number;
  total_segments: number;
}

export interface AssetGeneratingView {
  kind: AssetGeneratingViewKind;
  title: string;
  hint: string;
  blockPage: boolean;
  progress?: AssetGenerationProgress;
}

export interface AssetGeneratingVisibilityInput {
  hasGeneratingView: boolean;
  hasAssetPlan: boolean;
  hasManifest: boolean;
  hasAssetPlanError: boolean;
  hasAssetsError: boolean;
  hasBasicAssetsGenerationFailed: boolean;
}

export function shouldShowAssetGeneratingView(
  input: AssetGeneratingVisibilityInput,
): boolean {
  if (!input.hasGeneratingView) return false;
  if (input.hasAssetPlanError) return false;
  if (!input.hasAssetsError) return true;

  if (
    input.hasAssetPlan &&
    !input.hasManifest &&
    !input.hasBasicAssetsGenerationFailed
  ) {
    return true;
  }

  return false;
}

export function getAssetGeneratingView(
  input: AssetGeneratingViewInput,
): AssetGeneratingView | null {
  if (input.hasAssetPlan && !input.hasManifest && !input.isAssetsGenerating) {
    return {
      kind: "asset_plan",
      title: "正在生成资产规划",
      hint: "正在调用大模型分析分镜并规划素材，可能需要 1-5 分钟。",
      blockPage: true,
      progress: input.planProgress ?? undefined,
    };
  }

  if (input.isAssetsGenerating) {
    return {
      kind: "assets",
      title: input.hasAssetPlan && !input.hasManifest
        ? "正在生成基础资源"
        : "正在生成资产",
      hint: "正在生成或补齐素材，已有内容会保留在页面中，完成后状态会自动更新。",
      blockPage: !input.hasManifest,
    };
  }

  return null;
}
