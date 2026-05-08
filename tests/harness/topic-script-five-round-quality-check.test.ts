import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(plan.required_artifacts).toContain("topic-candidate-preview-trace.json");
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

  it("reports sample readiness separately from local validation and semantic shadow results", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-five-round-quality-stats-"));

    const result = await runTopicScriptFiveRoundQualityCheck(
      { outputDir },
      {
        requireRealEnv: false,
        sampleRunner: async ({ samplePath, outputDir: sampleOutputDir }) => {
          mkdirSync(sampleOutputDir, { recursive: true });
          const localValidationDecision = samplePath.includes("hongmenyan")
            ? "regen_once"
            : "pass";
          const semanticReviewDecision = samplePath.includes("hongmenyan")
            ? "skipped"
            : "pass";

          writeFileSync(
            join(sampleOutputDir, "validation-result.json"),
            JSON.stringify(
              {
                stage: "script_local_validation",
                decision: localValidationDecision,
              },
              null,
              2,
            ),
            "utf8",
          );
          writeFileSync(
            join(sampleOutputDir, "semantic-review-result.json"),
            JSON.stringify(
              {
                stage: "script_semantic_review",
                decision: semanticReviewDecision,
              },
              null,
              2,
            ),
            "utf8",
          );
          const repeatedAngle =
            "A banquet assassination decides the first turn in Wu power.";
          const topicPackage = samplePath.includes("hongmenyan")
            ? {
                topic_id: "topic_attention",
                title: "Attention Sample",
                selected_angle: repeatedAngle,
                family_label: "assassination pressure",
                scope_label: "single event",
                core_conflict: "There is only one chance to strike.",
                stakes: `There is only one chance to strike. ${repeatedAngle}`,
                strong_scene: "The sword is hidden inside the fish.",
                packaging_seed: repeatedAngle,
                must_include_beats: [
                  "There is only one chance to strike.",
                  "The sword is hidden inside the fish.",
                  repeatedAngle,
                ],
                forbidden_expansions: [],
                risk_hints: [],
                source_anchor_refs: ["Shiji"],
                canonical_quotes: [],
                ambiguity_notes: [],
                duration_band: "medium",
                narrative_tension_map: {
                  hook_claim: repeatedAngle,
                  pressure_escalation: "There is only one chance to strike.",
                  mid_reveal: repeatedAngle,
                  peak_payoff: "The sword is hidden inside the fish.",
                  ending_residue: repeatedAngle,
                },
              }
            : {
                topic_id: "topic_ok",
                title: "Ok Sample",
                selected_angle:
                  "A banquet starts with one quiet move toward danger.",
                family_label: "assassination pressure",
                scope_label: "single event",
                core_conflict: "There is only one chance to strike.",
                stakes:
                  "If the strike fails, the whole faction is exposed at once.",
                strong_scene: "The sword is hidden inside the fish.",
                packaging_seed:
                  "A banquet starts with one quiet move toward danger.",
                must_include_beats: [
                  "The cook carries the fish into the inner banquet.",
                  "The blade comes out from the fish at the serving table.",
                  "The guards close in as the assassin pays the price.",
                ],
                forbidden_expansions: [],
                risk_hints: [],
                source_anchor_refs: ["Shiji"],
                canonical_quotes: [],
                ambiguity_notes: [],
                duration_band: "medium",
                narrative_tension_map: {
                  hook_claim:
                    "A banquet starts with one quiet move toward danger.",
                  pressure_escalation: "There is only one chance to strike.",
                  mid_reveal:
                    "The blade comes out from the fish at the serving table.",
                  peak_payoff: "The sword is hidden inside the fish.",
                  ending_residue:
                    "The guards close in as the assassin pays the price.",
                },
              };
          writeFileSync(
            join(sampleOutputDir, "topic-package.json"),
            JSON.stringify(topicPackage, null, 2),
            "utf8",
          );

          return {
            outputDir: sampleOutputDir,
            sample: {
              sample_id: samplePath.includes("hongmenyan")
                ? "hongmenyan"
                : "sample-pass",
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
                    node_name: "semantic-review",
                    input_ref: "script-local-validation:current",
                    output_ref:
                      semanticReviewDecision === "skipped"
                        ? null
                        : "script-semantic-review:current",
                    failure_reason:
                      semanticReviewDecision === "skipped"
                        ? "本地硬校验未通过，未进入语义审校。"
                        : null,
                  },
                ],
              },
            },
          } satisfies RunTopicScriptSmokeResult;
        },
      },
    );

    expect(result).toMatchObject({
      sample_ready_samples: 5,
      local_validation_passed_samples: 4,
      local_validation_failed_samples: 1,
      semantic_shadow_passed_samples: 4,
      semantic_shadow_skipped_samples: 1,
    });

    const summary = JSON.parse(
      readFileSync(join(outputDir, "live-check-summary.json"), "utf8"),
    ) as {
      sample_ready_samples: number;
      local_validation_passed_samples: number;
      local_validation_failed_samples: number;
      semantic_shadow_passed_samples: number;
      semantic_shadow_skipped_samples: number;
      topic_package_sufficiency_ok_samples: number;
      topic_package_sufficiency_observe_samples: number;
      topic_package_sufficiency_needs_attention_samples: number;
      topic_package_sufficiency_unknown_samples: number;
      samples: Array<{
        sample_id: string;
        local_validation_decision: string | null;
        semantic_review_decision: string | null;
        topic_package_sufficiency: {
          status: string;
          warnings: string[];
        } | null;
      }>;
    };

    expect(summary).toMatchObject({
      sample_ready_samples: 5,
      local_validation_passed_samples: 4,
      local_validation_failed_samples: 1,
      semantic_shadow_passed_samples: 4,
      semantic_shadow_skipped_samples: 1,
      topic_package_sufficiency_ok_samples: 4,
      topic_package_sufficiency_observe_samples: 0,
      topic_package_sufficiency_needs_attention_samples: 1,
      topic_package_sufficiency_unknown_samples: 0,
    });
    expect(summary.samples.find((sample) => sample.sample_id === "hongmenyan")).toMatchObject({
      local_validation_decision: "regen_once",
      semantic_review_decision: "skipped",
      topic_package_sufficiency: {
        status: "needs_attention",
        warnings: expect.arrayContaining([
          "tension_map_repetition_risk",
          "selected_angle_repetition_risk",
        ]),
      },
    });
  });
});
