import { describe, expect, it } from "vitest";

import { getAssetGeneratingView } from "../../../frontend/src/utils/asset-generating-view.js";

describe("getAssetGeneratingView", () => {
  it("shows asset plan generation only before a plan or manifest exists", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: false,
        hasManifest: false,
        isPlanGenerating: true,
        isAssetsGenerating: false,
      }),
    ).toMatchObject({
      kind: "asset_plan",
      title: "正在生成资产规划",
    });
  });

  it("does not mislabel asset generation as asset plan generation after a manifest exists", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: true,
        hasManifest: true,
        isPlanGenerating: true,
        isAssetsGenerating: true,
      }),
    ).toMatchObject({
      kind: "assets",
      title: "正在生成资产",
    });
  });

  it("keeps the normal asset page visible when a manifest exists", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: true,
        hasManifest: true,
        isPlanGenerating: false,
        isAssetsGenerating: true,
        isPolling: false,
      })?.blockPage,
    ).toBe(false);
  });

  it("shows a visible basic-assets loading state while polling after the plan is ready", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: true,
        hasManifest: false,
        isPlanGenerating: false,
        isAssetsGenerating: false,
        isPolling: true,
      }),
    ).toMatchObject({
      kind: "assets",
      title: "正在生成基础资源",
      blockPage: true,
    });
  });
});
