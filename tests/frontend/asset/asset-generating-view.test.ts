import { describe, expect, it } from "vitest";

import {
  getAssetGeneratingView,
  shouldShowAssetGeneratingView,
} from "../../../frontend/src/utils/asset-generating-view.js";

describe("getAssetGeneratingView", () => {
  it("shows asset plan generation before a plan or manifest exists", () => {
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
      blockPage: true,
    });
  });

  it("keeps showing asset plan generation for placeholder asset plan records", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: true,
        hasManifest: false,
        isPlanGenerating: true,
        isAssetsGenerating: false,
        isPolling: true,
      }),
    ).toMatchObject({
      kind: "asset_plan",
      title: "正在生成资产规划",
      blockPage: true,
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

  it("does not block the asset page while basic assets are starting after the plan is ready", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: true,
        hasManifest: false,
        isPlanGenerating: false,
        isAssetsGenerating: false,
        isPolling: true,
      }),
    ).toBeNull();
  });

  it("keeps the asset page visible for a ready plan without a manifest", () => {
    expect(
      getAssetGeneratingView({
        hasAssetPlan: true,
        hasManifest: false,
        isPlanGenerating: false,
        isAssetsGenerating: false,
        isPolling: false,
      }),
    ).toBeNull();
  });

  it("keeps basic-assets loading visible during transient asset snapshot errors", () => {
    expect(
      shouldShowAssetGeneratingView({
        hasGeneratingView: true,
        hasAssetPlan: true,
        hasManifest: false,
        hasAssetPlanError: false,
        hasAssetsError: true,
        hasBasicAssetsGenerationFailed: false,
      }),
    ).toBe(true);
  });

  it("shows the error after basic asset generation itself fails", () => {
    expect(
      shouldShowAssetGeneratingView({
        hasGeneratingView: true,
        hasAssetPlan: true,
        hasManifest: false,
        hasAssetPlanError: false,
        hasAssetsError: true,
        hasBasicAssetsGenerationFailed: true,
      }),
    ).toBe(false);
  });
});
