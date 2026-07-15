import { describe, expect, it } from "vitest";
import { validateLiveOptions } from "./llm-s2-baseline.js";

describe("llm-s2-baseline", () => {
  it("validates --candidate-model is required for live mode", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: undefined,
      maxRequests: 3,
      maxCostCny: 10,
    });

    expect(errors).toContain("--live 需要 --candidate-model <model-id>");
  });

  it("validates --max-requests is required for live mode", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: undefined,
      maxCostCny: 10,
    });

    expect(errors).toContain("--live 需要 --max-requests <N>");
  });

  it("validates --max-cost-cny is required for live mode", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 3,
      maxCostCny: undefined,
    });

    expect(errors).toContain("--live 需要 --max-cost-cny <金额>");
  });

  it("rejects --max-requests above 8", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 10,
      maxCostCny: 10,
    });

    expect(errors).toContain("--max-requests 不得超过 8");
  });

  it("accepts valid live options without errors", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 4,
      maxCostCny: 10,
    });

    expect(errors).toHaveLength(0);
  });

  it("returns no errors for dry-run mode (no validation needed)", () => {
    const errors = validateLiveOptions({
      live: false,
      dryRun: true,
    });

    expect(errors).toHaveLength(0);
  });
});
