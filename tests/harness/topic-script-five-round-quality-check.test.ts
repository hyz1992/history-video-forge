import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTopicScriptFiveRoundQualityCheckPlan,
  runTopicScriptFiveRoundQualityCheck,
} from "../../harness/scripts/runtime/topic-script-five-round-quality-check";
import type { RunTopicScriptSmokeResult } from "../../harness/scripts/runtime/topic-script-smoke";

describe("topic script five round quality check", () => {
  it("defines a discoverable five-round real quality check plan outside the default gate", () => {
    const plan = buildTopicScriptFiveRoundQualityCheckPlan({
      outputDir: "harness/scripts/runtime/output/topic-script-five-round-quality-check",
    });

    expect(plan).toMatchObject({
      mode: "real_runtime_live_check",
      automated_gate: false,
      requires_real_env: true,
      total_samples: 5,
      output_dir: "harness/scripts/runtime/output/topic-script-five-round-quality-check",
    });
    expect(plan.sample_paths).toEqual([
      "harness/samples/topic-script/yanzi-shichu.sample.json",
      "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
      "harness/samples/topic-script/julu-zhizhan.sample.json",
      "harness/samples/topic-script/hongmenyan.sample.json",
      "harness/samples/topic-script/yanzi-shichu.sample.json",
    ]);
  });

  it("runs through the live check runner and keeps npm documentation discoverable", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-five-round-quality-check-"));

    const result = await runTopicScriptFiveRoundQualityCheck(
      { outputDir },
      {
        requireRealEnv: false,
        sampleRunner: async ({ samplePath, outputDir: sampleOutputDir }) => {
          return {
            outputDir: sampleOutputDir,
            sample: {
              sample_id: samplePath.includes("julu")
                ? "julu-zhizhan"
                : samplePath.includes("hongmenyan")
                  ? "hongmenyan"
                  : samplePath.includes("zhuanzhu")
                    ? "zhuanzhu-ciwangliao"
                    : "yanzi-shichu",
              project_name: "five-round-quality-check",
              topic_request: {
                canonical_name: "test",
                summary: "test",
                core_conflict: "test",
                strong_scene: "test",
                source_hint: "test",
                recent_usage_hint: "test",
                tags: ["test"],
              },
            },
            status: {
              generatedAt: "2026-05-06T00:00:00.000Z",
              status: "sample-ready",
              stage: "topic-to-script",
              sampleId: "sample",
              projectId: `project-${samplePath}`,
              outputDir: sampleOutputDir,
              graphTraceSummary: {
                nodes: [
                  {
                    node_name: "script-generate",
                    input_ref: "script-input-bundle:test",
                    output_ref: "script-draft:test",
                    failure_reason: null,
                  },
                ],
              },
            },
          } satisfies RunTopicScriptSmokeResult;
        },
      },
    );

    expect(result).toMatchObject({
      automated_gate: false,
      requires_real_env: true,
      total_samples: 5,
      passed_samples: 5,
      failed_samples: 0,
    });

    const summary = JSON.parse(
      readFileSync(join(outputDir, "live-check-summary.json"), "utf8"),
    ) as {
      total_samples: number;
      samples: Array<{ sample_path: string; output_dir: string }>;
    };
    expect(summary.total_samples).toBe(5);
    expect(summary.samples.filter((sample) => sample.sample_path.includes("yanzi"))).toHaveLength(2);
    expect(new Set(summary.samples.map((sample) => sample.output_dir)).size).toBe(5);
    expect(summary.samples.map((sample) => sample.output_dir)).toEqual([
      join(outputDir, "yanzi-shichu"),
      join(outputDir, "zhuanzhu-ciwangliao"),
      join(outputDir, "julu-zhizhan"),
      join(outputDir, "hongmenyan"),
      join(outputDir, "yanzi-shichu-repeat-2"),
    ]);

    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "harness:topic-script-five-round-quality-check":
        "tsx harness/scripts/runtime/topic-script-five-round-quality-check.ts",
    });

    const readme = readFileSync("harness/README.md", "utf8");
    expect(readme).toContain("harness:topic-script-five-round-quality-check");
    expect(readme).toContain("5 轮");
    expect(readme).toContain("shadow-only");
  });

  it("accepts a positional output directory when npm strips the --output-dir flag", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-five-round-cli-output-"));

    const { parseFiveRoundQualityCheckCliArgs } = await import(
      "../../harness/scripts/runtime/topic-script-five-round-quality-check"
    );

    expect(parseFiveRoundQualityCheckCliArgs([outputDir])).toEqual({
      outputDir,
    });
  });
});
