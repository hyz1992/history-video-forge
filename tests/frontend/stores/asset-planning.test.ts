import { describe, expect, it } from "vitest";

import {
  hasReadyAssetPlanSnapshot,
  isAssetPlanSnapshotGenerating,
  type AssetPlanSnapshot,
} from "../../../frontend/src/stores/asset-planning.js";

function makeSnapshot(input: {
  currentStatus: string;
  generating?: boolean;
  validationDecision?: string;
}): AssetPlanSnapshot {
  return {
    current_status: input.currentStatus,
    active_asset_plan: {
      plan: null,
      validation_result: input.validationDecision
        ? {
            stage: "asset_planning_local_validation",
            decision: input.validationDecision,
          }
        : null,
      execution_state: input.generating === undefined
        ? {}
        : { generating: input.generating },
      graph_trace_summary: null,
      runtime_diagnostics: null,
    },
    active_asset_plan_record_id: "asset_plan_placeholder",
  };
}

describe("asset planning snapshot readiness", () => {
  it("treats placeholder asset plan records as still generating", () => {
    const snapshot = makeSnapshot({
      currentStatus: "asset_plan_generating",
      generating: true,
      validationDecision: "generating",
    });

    expect(isAssetPlanSnapshotGenerating(snapshot)).toBe(true);
    expect(hasReadyAssetPlanSnapshot(snapshot)).toBe(false);
  });

  it("treats a finished active asset plan as ready", () => {
    const snapshot = makeSnapshot({
      currentStatus: "asset_plan_ready",
      generating: false,
      validationDecision: "pass",
    });

    expect(isAssetPlanSnapshotGenerating(snapshot)).toBe(false);
    expect(hasReadyAssetPlanSnapshot(snapshot)).toBe(true);
  });
});
