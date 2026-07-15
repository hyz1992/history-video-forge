import { describe, expect, it } from "vitest";

const { buildExecutionMatrix, parseArgs, validateLiveOptions } = await import("./llm-s2-baseline.js");

describe("llm-s2-baseline", () => {
  it("parses an explicit candidate-only diagnostic matrix", () => {
    const args = parseArgs([
      "--live",
      "--candidate-model", "glm-5.2",
      "--profile-scope", "candidate-only",
      "--candidate-thinking", "disabled",
      "--force-target-tool",
      "--enable-probe",
      "--max-requests", "4",
      "--max-cost-cny", "10",
    ]);

    expect(args.profileScope).toBe("candidate-only");
    expect(args.candidateThinking).toBe("disabled");
    expect(args.forceTargetTool).toBe(true);
    expect(args.enableCapabilityProbe).toBe(true);

    expect(buildExecutionMatrix(args, 3)).toEqual({
      profiles: ["candidate"],
      probeRequests: 1,
      sampleRequests: 3,
      requiredRequests: 4,
      candidateOptions: {
        thinking: "disabled",
        forceTargetTool: true,
      },
    });
  });

  it("rejects invalid diagnostic scope, thinking value, and a candidate-only budget above 6", () => {
    const invalidScope = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 4,
      maxCostCny: 10,
      profileScope: "candidate",
    });
    const invalidThinking = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 4,
      maxCostCny: 10,
      profileScope: "candidate-only",
      candidateThinking: "fast",
    });
    const excessiveBudget = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 7,
      maxCostCny: 10,
      profileScope: "candidate-only",
    });

    expect(invalidScope).toContain("--profile-scope 仅支持 both 或 candidate-only");
    expect(invalidThinking).toContain("--candidate-thinking 仅支持 enabled 或 disabled");
    expect(excessiveBudget).toContain("candidate-only 诊断的 --max-requests 不得超过 6");
  });

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
