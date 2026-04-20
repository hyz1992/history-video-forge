import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTopicScriptLiveCheckPlan,
  writeTopicScriptLiveCheckPlan,
} from "../../harness/scripts/runtime/topic-script-live-check";

describe("topic script live check", () => {
  it("keeps the live check as an explicit manual gate with real env requirements and output obligations", () => {
    const samplePaths = [
      "harness/samples/topic-script/yanzi-shichu.sample.json",
      "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
    ];

    const plan = buildTopicScriptLiveCheckPlan({
      samplePaths,
      outputDir: "harness/scripts/runtime/output/topic-script-live-check",
    });

    expect(plan).toMatchObject({
      mode: "real_runtime_live_check",
      automated_gate: false,
      requires_real_env: true,
      total_samples: 2,
      sample_paths: samplePaths,
      output_dir: "harness/scripts/runtime/output/topic-script-live-check",
    });
    expect(plan.required_artifacts).toEqual(
      expect.arrayContaining([
        "graph-trace-summary.json",
        "runtime-diagnostics.json",
        "script-draft.json",
      ]),
    );
    expect(plan.required_checks).toEqual(
      expect.arrayContaining([
        expect.stringContaining(".env"),
        expect.stringContaining("graph trace"),
        expect.stringContaining("diagnostics"),
      ]),
    );
  });

  it("writes a reusable live-check plan and documents the release gate entry points", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-topic-script-live-check-"));
    const samplePaths = [
      "harness/samples/topic-script/yanzi-shichu.sample.json",
    ];

    const plan = writeTopicScriptLiveCheckPlan({
      samplePaths,
      outputDir,
    });

    expect(plan.total_samples).toBe(1);
    expect(existsSync(join(outputDir, "live-check-plan.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "harness:topic-script-live-check":
        "tsx harness/scripts/runtime/topic-script-live-check.ts",
    });

    const readme = readFileSync(join(process.cwd(), "harness/README.md"), "utf8");
    expect(readme).toContain("topic-script-live-check.ts");
    expect(readme).toContain("真实巡检");

    const checklist = readFileSync(
      join(process.cwd(), "docs/records/2026-04-19-topic-script-live-checklist.md"),
      "utf8",
    );
    expect(checklist).toContain("自动化回归通过");
    expect(checklist).toContain("真实巡检通过");
    expect(checklist).toContain("手工 spot check 通过");
  });
});
