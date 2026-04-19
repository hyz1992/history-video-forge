import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  runTopicScriptRegression,
} from "../../harness/scripts/runtime/topic-script-regression";
import {
  buildTopicScriptRealRegressionPlan,
} from "../../harness/scripts/runtime/topic-script-real-regression";

describe("topic script regression harness", () => {
  it("runs the official topic to script runtime chain for a fixed sample family set", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-topic-script-regression-"));
    const samplePaths = [
      "harness/samples/topic-script/yanzi-shichu.sample.json",
      "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
    ];

    const result = await runTopicScriptRegression({
      samplePaths,
      outputDir,
    });

    expect(result.mode).toBe("automated_regression");
    expect(result.total_samples).toBe(2);
    expect(result.passed_samples).toBe(2);
    expect(result.failed_samples).toBe(0);
    expect(result.results).toHaveLength(2);

    expect(existsSync(join(outputDir, "regression-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const summary = JSON.parse(
      readFileSync(join(outputDir, "regression-summary.json"), "utf8"),
    ) as {
      mode: string;
      total_samples: number;
      passed_samples: number;
      failed_samples: number;
      samples: Array<{
        sample_id: string;
        output_dir: string;
        status: string;
        stage: string;
      }>;
    };

    expect(summary).toMatchObject({
      mode: "automated_regression",
      total_samples: 2,
      passed_samples: 2,
      failed_samples: 0,
    });
    expect(summary.samples).toHaveLength(2);

    for (const sample of summary.samples) {
      expect(sample.status).toBe("sample-ready");
      expect(sample.stage).toBe("topic-to-script");
      expect(existsSync(join(sample.output_dir, "topic-candidates.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "topic-package.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "script-input-bundle.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "script-draft.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "validation-result.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "semantic-review-result.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "status.json"))).toBe(true);
      expect(existsSync(join(sample.output_dir, "trace.md"))).toBe(true);
    }
  });

  it("keeps the real regression layer as an explicit manual inspection plan", () => {
    const samplePaths = [
      "harness/samples/topic-script/yanzi-shichu.sample.json",
      "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
    ];

    const plan = buildTopicScriptRealRegressionPlan({
      samplePaths,
      outputDir: "harness/scripts/runtime/output/topic-script-real-regression",
    });

    expect(plan).toMatchObject({
      mode: "real_runtime_inspection",
      automated_gate: false,
      total_samples: 2,
      sample_paths: samplePaths,
    });
  });
});
