import { describe, expect, it } from "vitest";

const { validateLiveOptions } = await import("./llm-s2-baseline.js");

describe("llm-s2-baseline", () => {
  it("validates --candidate-model is required for live mode", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: undefined,
      currentMainModel: "glm-5.1",
      currentStructuredModel: "glm-4",
      maxRequests: 7,
      maxCostCny: 10,
    });

    expect(errors).toContain("--live 需要 --candidate-model <model-id>");
  });

  it("validates --max-requests is required for live mode", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      currentMainModel: "glm-5.1",
      currentStructuredModel: "glm-4",
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
      currentMainModel: "glm-5.1",
      currentStructuredModel: "glm-4",
      maxRequests: 7,
      maxCostCny: undefined,
    });

    expect(errors).toContain("--live 需要 --max-cost-cny <金额>");
  });

  it("rejects --max-requests above 8", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      currentMainModel: "glm-5.1",
      currentStructuredModel: "glm-4",
      maxRequests: 10,
      maxCostCny: 10,
    });

    expect(errors).toContain("--max-requests 不得超过 8");
  });

  it("accepts valid live options with budget covering current+candidate+probe", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      currentMainModel: "glm-5.1",
      currentStructuredModel: "glm-4",
      maxRequests: 7,
      maxCostCny: 10,
      enableCapabilityProbe: true,
    });

    expect(errors).toHaveLength(0);
  });

  it("returns no errors for live without probe when budget covers current+candidate only", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      currentMainModel: "glm-5.1",
      currentStructuredModel: "glm-4",
      maxRequests: 6,
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
