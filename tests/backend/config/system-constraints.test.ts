import { describe, expect, it } from "vitest";

import {
  resolveSystemGenerationConstraints,
  unavailableReasonFromRoute,
} from "../../../backend/src/modules/generation-config/system-constraints.js";

/**
 * S2-2A 任务 4 第三轮整改：系统约束单一来源 + reason_code → 不可用原因映射。
 */
describe("system constraints", () => {
  it("demo mode disables real video provider", () => {
    expect(resolveSystemGenerationConstraints(true).apiVideoProviderEnabled).toBe(false);
    expect(resolveSystemGenerationConstraints(false).apiVideoProviderEnabled).toBe(true);
  });

  it("maps provider-disabled downgrade to a visible unavailable reason", () => {
    const reason = unavailableReasonFromRoute("api_video_provider_disabled");
    expect(reason).not.toBeNull();
    expect(reason).toContain("禁用真实视频 API");
  });

  it("normal strategy or override selections have no unavailable reason", () => {
    expect(unavailableReasonFromRoute("strategy_matrix_remotion")).toBeNull();
    expect(unavailableReasonFromRoute("strategy_matrix_api_video")).toBeNull();
    expect(unavailableReasonFromRoute("segment_override_remotion")).toBeNull();
    expect(unavailableReasonFromRoute("segment_override_api_video")).toBeNull();
  });

  it("unknown reason codes get a neutral fallback hint", () => {
    expect(unavailableReasonFromRoute("route_resolution_failed")).toBe("路线解析受限，暂按 Remotion 预览");
  });
});
