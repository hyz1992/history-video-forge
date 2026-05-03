import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildTopicScriptLiveCheckPlan,
  runTopicScriptLiveCheck,
  writeTopicScriptLiveCheckPlan,
} from "../../harness/scripts/runtime/topic-script-live-check";
import type { RunTopicScriptSmokeResult } from "../../harness/scripts/runtime/topic-script-smoke";

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

  it("runs the live check, writes summary artifacts, and keeps the release gate discoverable", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-topic-script-live-check-"));
    const samplePaths = [
      "harness/samples/topic-script/yanzi-shichu.sample.json",
      "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
    ];

    const result = await runTopicScriptLiveCheck(
      {
        samplePaths,
        outputDir,
      },
      {
        requireRealEnv: false,
        sampleRunner: async ({ samplePath, outputDir: sampleOutputDir }) => {
          mkdirSync(sampleOutputDir, { recursive: true });
          writeFileSync(
            join(sampleOutputDir, "graph-trace-summary.json"),
            JSON.stringify({
              nodes: [
                {
                  node_name: "script-generate",
                  input_ref: "script-input-bundle:test",
                  output_ref: "script-draft:test",
                  failure_reason: null,
                },
              ],
            }),
            "utf8",
          );
          writeFileSync(
            join(sampleOutputDir, "runtime-diagnostics.json"),
            JSON.stringify({
              checks: [
                {
                  code: "live_check_passed",
                  level: "info",
                },
              ],
            }),
            "utf8",
          );

          return {
            outputDir: sampleOutputDir,
            sample: {
              sample_id: samplePath.includes("yanzi") ? "yanzi-shichu" : "zhuanzhu-ciwangliao",
              project_name: "live-check",
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
              generatedAt: "2026-04-20T00:00:00.000Z",
              status: "sample-ready",
              stage: "topic-to-script",
              sampleId: samplePath.includes("yanzi") ? "yanzi-shichu" : "zhuanzhu-ciwangliao",
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
      mode: "real_runtime_live_check",
      automated_gate: false,
      total_samples: 2,
      passed_samples: 2,
      failed_samples: 0,
    });
    expect(result.results).toHaveLength(2);
    expect(existsSync(join(outputDir, "live-check-plan.json"))).toBe(true);
    expect(existsSync(join(outputDir, "live-check-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const summary = JSON.parse(
      readFileSync(join(outputDir, "live-check-summary.json"), "utf8"),
    ) as {
      mode: string;
      total_samples: number;
      passed_samples: number;
      failed_samples: number;
      samples: Array<{
        sample_id: string;
        status: string;
        output_dir: string;
        graph_nodes: Array<{
          node_name: string;
        }>;
      }>;
    };

    expect(summary).toMatchObject({
      mode: "real_runtime_live_check",
      total_samples: 2,
      passed_samples: 2,
      failed_samples: 0,
    });
    expect(summary.samples[0]?.graph_nodes).toMatchObject([
      {
        node_name: "script-generate",
      },
    ]);

    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "harness:topic-script-live-check":
        "tsx harness/scripts/runtime/topic-script-live-check.ts",
    });

    const readme = readFileSync(resolve(process.cwd(), "harness/README.md"), "utf8");
    expect(readme).toContain("执行真实 live check");
    expect(readme).toContain(
      "npm run harness:topic-script-live-check -- harness/samples/topic-script/family-set.md",
    );
    expect(readme).toContain("Topic Candidate Library Observability");
    expect(readme).toContain("storage/topic-candidate-library/<seed-family>/<seed-profile>/");
    expect(readme).toContain("raw_generated / unused / fallback_ready / expired");

    const checklist = readFileSync(
      join(process.cwd(), "docs/records/2026-04-19-topic-script-live-checklist.md"),
      "utf8",
    );
    expect(checklist).toContain("自动化回归通过");
    expect(checklist).toContain("真实巡检通过");
    expect(checklist).toContain("手工 spot check 通过");
  });
});
