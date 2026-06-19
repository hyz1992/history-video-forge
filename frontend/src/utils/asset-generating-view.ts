export type AssetGeneratingViewKind = "asset_plan" | "assets";

export interface AssetGeneratingViewInput {
  hasAssetPlan: boolean;
  hasManifest: boolean;
  isPlanGenerating: boolean;
  isAssetsGenerating: boolean;
  isPolling?: boolean;
}

export interface AssetGeneratingView {
  kind: AssetGeneratingViewKind;
  title: string;
  hint: string;
  blockPage: boolean;
}

export function getAssetGeneratingView(
  input: AssetGeneratingViewInput,
): AssetGeneratingView | null {
  if (input.isPolling && input.hasAssetPlan && !input.hasManifest) {
    return {
      kind: "assets",
      title: "正在生成基础资源",
      hint: "正在生成口播音频、字幕、运镜、音效和配乐，完成后会自动进入资产预览。",
      blockPage: true,
    };
  }

  if (input.hasAssetPlan && !input.hasManifest && !input.isPlanGenerating) {
    return {
      kind: "assets",
      title: "正在生成基础资源",
      hint: "正在启动口播音频、字幕、运镜、音效和配乐生成，完成后会自动进入资产预览。",
      blockPage: true,
    };
  }

  if (input.isPolling && !input.hasAssetPlan && !input.hasManifest) {
    return {
      kind: "asset_plan",
      title: "正在生成资产规划",
      hint: "正在调用大模型分析分镜并规划素材，可能需要 1-5 分钟。",
      blockPage: true,
    };
  }

  if (input.isAssetsGenerating) {
    return {
      kind: "assets",
      title: input.hasAssetPlan && !input.hasManifest ? "正在生成基础资源" : "正在生成资产",
      hint: "正在生成或补齐素材，已有内容会保留在页面中，完成后状态会自动更新。",
      blockPage: !input.hasManifest,
    };
  }

  if (input.isPlanGenerating && !input.hasAssetPlan && !input.hasManifest) {
    return {
      kind: "asset_plan",
      title: "正在生成资产规划",
      hint: "正在调用大模型分析分镜并规划素材，可能需要 1-5 分钟。",
      blockPage: true,
    };
  }

  return null;
}
