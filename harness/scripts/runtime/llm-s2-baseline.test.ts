import { describe, expect, it } from "vitest";
import { validateLiveOptions, buildReport } from "./llm-s2-baseline.js";

const baseArgs = {
  dryRun: true,
  live: false,
};

describe("llm-s2-baseline", () => {
  it("runs in dry-run mode by default with live=false", () => {
    const manifest = [
      { id: "short-structured", operation: "topic.selector", description: "", input: {} },
      { id: "typical-script", operation: "script.writer", description: "", input: {} },
      { id: "long-or-repair", operation: "storyboard.planner", description: "", input: {} },
    ];

    const report = buildReport(manifest, baseArgs);

    expect(report.live).toBe(false);
    expect(report.totalSamples).toBe(3);
    expect(report.totalRequests).toBe(0);
    expect(report.constraints.ttft).toBe("unobservable_non_streaming");
    expect(report.constraints.costEnforcement).toBe("unavailable");

    expect(report.results).toHaveLength(3);
    for (const r of report.results) {
      expect(r.status).toBe("dry_run");
      expect(r.estimatedRequests).toBe(0);
    }
  });

  it("fails live mode when --candidate-model is missing", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: undefined,
      maxRequests: 3,
      maxCostCny: 10,
    });

    expect(errors).toContain("--live 需要 --candidate-model <model-id>");
  });

  it("fails live mode when --max-requests is missing", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: undefined,
      maxCostCny: 10,
    });

    expect(errors).toContain("--live 需要 --max-requests <N>");
  });

  it("fails live mode when --max-cost-cny is missing", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 3,
      maxCostCny: undefined,
    });

    expect(errors).toContain("--live 需要 --max-cost-cny <金额>");
  });

  it("fails live mode when --max-requests exceeds 8", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 10,
      maxCostCny: 10,
    });

    expect(errors).toContain("--max-requests 不得超过 8");
  });

  it("returns no errors for valid live options", () => {
    const errors = validateLiveOptions({
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 3,
      maxCostCny: 10,
    });

    expect(errors).toHaveLength(0);
  });

  it("produces live report with maxAttempts=1 constraint enforced", () => {
    const manifest = [
      { id: "short-structured", operation: "topic.selector", description: "", input: {} },
    ];

    const report = buildReport(manifest, {
      live: true,
      dryRun: false,
      candidateModel: "glm-5.2",
      maxRequests: 3,
      maxCostCny: 10,
    });

    expect(report.live).toBe(true);
    expect(report.candidateModel).toBe("glm-5.2");
    expect(report.totalRequests).toBe(1);
    expect(report.constraints.maxRequests).toBe(3);
    expect(report.constraints.maxCostCny).toBe(10);
    expect(report.results[0].status).toBe("pending");
  });

  it("ttft is always marked as unobservable_non_streaming", () => {
    const manifest = [{ id: "test", operation: "script.writer", description: "", input: {} }];
    const report = buildReport(manifest, baseArgs);

    expect(report.constraints.ttft).toBe("unobservable_non_streaming");
    expect(typeof report.constraints.ttft).toBe("string");
  });

  it("cost enforcement is always marked as unavailable", () => {
    const manifest = [{ id: "test", operation: "script.writer", description: "", input: {} }];
    const report = buildReport(manifest, baseArgs);

    expect(report.constraints.costEnforcement).toBe("unavailable");
  });
});
