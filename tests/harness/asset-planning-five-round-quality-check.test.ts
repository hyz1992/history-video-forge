import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ExternalServiceError } from "../../backend/src/runtime/llm/external-errors.js";
import type { AssetPlan } from "../../shared/src/index.js";
import {
  type AssetPlanningFiveRoundQualityCheckInput,
  type AssetPlanningFiveRoundPlanGeneratorInput,
  buildAssetPlanningFiveRoundQualityCheckPlan,
  computeAssetPlanningRuntimeRevisionSha256,
  parseAssetPlanningFiveRoundQualityCheckCliArgs,
  runAssetPlanningFiveRoundQualityCheck,
} from "../../harness/scripts/runtime/asset-planning-five-round-quality-check";

const scriptText =
  "Opening pressure. The envoy refuses the trap. The court turns silent after the answer.";

const injectedRuntimeFingerprintInputs = {
  provider_id: "test-provider",
  model_id: "test-model",
  prompt_bundle_sha256: "1".repeat(64),
  runtime_revision_sha256: "2".repeat(64),
  runtime_profile_sha256: "3".repeat(64),
};

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function writeTestInteraction(
  writer: AssetPlanningFiveRoundPlanGeneratorInput["interactionLogWriter"],
) {
  writer?.write({
    generatedAt: "2026-05-11T00:00:00.000Z",
    provider: "test-provider",
    model: "test-model",
    operationName: "asset-planning.segment-intent-planner",
    promptId: "asset-planning.segment-intent-planner",
    promptStage: "asset-planning",
    promptLanguage: "zh-CN",
    promptSha256: "test-sha256",
    promptVersion: "test-v1",
    promptFilePath: "prompts/asset-planning/segment-intent-planner.prompt.md",
    systemPrompt: "test prompt",
    input: { planning_mode: "segment_chunk" },
    rawOutput: "{}",
    parsedOutput: { planning_mode: "segment_chunk" },
  });
}

function spawnNpm(args: string[], cwd = process.cwd(), env = process.env) {
  if (process.platform === "win32") {
    return spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "npm.cmd", ...args],
      { cwd, env, encoding: "utf8" },
    );
  }
  return spawnSync("npm", args, { cwd, env, encoding: "utf8" });
}

function expectSuccessfulCleanSpawn(result: {
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: Error;
}) {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe("");
}

function readAllTextFiles(root: string): string {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name);
      return statSync(path).isDirectory() ? readAllTextFiles(path) : readFileSync(path, "utf8");
    })
    .join("\n");
}

function writeFixedStoryboardSource(sourceDir: string, index: number) {
  mkdirSync(sourceDir, { recursive: true });
  const topicId = `topic_${index}`;
  const scriptRecordId = `script_${index}`;
  writeJson(join(sourceDir, "source-script-draft.json"), {
    script_text: scriptText,
    estimated_duration_sec: 45,
    beat_trace: [
      {
        beat: "public answer",
        excerpt: "The envoy refuses the trap.",
        confidence: 0.95,
      },
    ],
    quote_trace: [],
    opening_span: "Opening pressure.",
    ending_span: "The court turns silent after the answer.",
  });
  writeJson(join(sourceDir, "source-topic-package.json"), {
    topic_id: topicId,
    title: `Fixed Topic ${index}`,
    selected_angle: "A public answer reverses pressure.",
    family_label: "diplomacy",
    scope_label: "single_event",
    core_conflict: "The envoy must answer without yielding.",
    stakes: "Backing down would cost the state's face.",
    strong_scene: "The court waits for the answer.",
    packaging_seed: "One answer reverses the room.",
    must_include_beats: ["public answer"],
    forbidden_expansions: [],
    risk_hints: [],
    source_anchor_refs: ["source-a"],
    canonical_quotes: [],
    canonical_quote_intents: [],
    ambiguity_notes: [],
    duration_band: "medium",
    narrative_tension_map: {
      hook_claim: "The trap is public.",
      pressure_escalation: "The insult rises in front of the court.",
      mid_reveal: "The answer guards the state's face.",
      peak_payoff: "The answer reverses pressure.",
      ending_residue: "Silence becomes the cost.",
    },
  });
  writeJson(join(sourceDir, "storyboard-plan.json"), {
    plan_version: "storyboard_v1",
    source_script_record_id: scriptRecordId,
    source_topic_package_id: topicId,
    estimated_total_duration_sec: 45,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: scriptText,
        start_hint_sec: 0,
        end_hint_sec: 45,
        narrative_role: "opening",
        visual_intent: "Show the answer reversing pressure.",
        scene_description: "A tense court watches the envoy answer.",
        visual_elements: ["envoy", "court"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: [],
      },
    ],
    global_visual_notes: [],
  });
}

function makeAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "cold pressure",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient historical vertical video",
      global_negative_prompts: ["modern clothes"],
      consistency_notes: [],
    },
    tts_plan: {
      voice_profile_id: "voice_default",
      estimated_total_duration_sec: 45,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: scriptText,
          estimated_duration_sec: 45,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate narration.",
        recommended_mode: "auto",
        provider_hint: "default_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "subtitle_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate subtitle timing.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create anchor visual.",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: "ancient court, tense envoy, vertical cinematic frame",
        parameters: {},
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png"],
          acceptance_notes: [],
        },
        risk_notes: ["Keep the visual historically grounded and avoid modern elements."],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [
      {
        dependency_id: "dep_subtitle_after_tts",
        task_id: "subtitle_001",
        depends_on_task_id: "tts_001",
        dependency_type: "requires_timing",
      },
    ],
    cost_summary: {
      total_tasks: 3,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
      },
      by_cost_tier: {
        free: 1,
        low: 2,
        medium: 0,
        high: 0,
      },
      estimated_provider_calls: 2,
      notes: [],
    },
    global_production_notes: ["No physical assets generated."],
  };
}

describe("asset planning five round quality check", () => {
  it("defines a discoverable five-round asset planning plan from fixed storyboard artifacts", () => {
    const plan = buildAssetPlanningFiveRoundQualityCheckPlan({
      outputDir: "asset-planning-output",
      live: true,
    });

    expect(plan).toMatchObject({
      mode: "asset_planning_real_runtime_live_check",
      automated_gate: false,
      requires_real_env: true,
      total_rounds: 5,
      output_dir: "asset-planning-output",
    });
    expect(plan.source_storyboard_dirs).toHaveLength(5);
    expect(plan.required_artifacts).toMatchObject({
      all_settled: expect.arrayContaining([
        "source-script-draft.json",
        "source-topic-package.json",
        "source-storyboard-plan.json",
        "runtime-diagnostics.json",
        "review.md",
        "round-result.json",
      ]),
      success_only: expect.arrayContaining([
        "asset-plan.json",
        "asset-planning-validation-result.json",
      ]),
      failure_only: [],
      interaction_evidence: {
        condition: "llm_invocation_attempted",
        marker_paths: "explicit_relative_markdown_paths",
      },
    });
    expect(plan.run_manifest).toMatchObject({
      version: "asset_planning_run_manifest_v1",
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("runs five asset planning rounds and writes reviewable artifacts", async () => {
    const sourceDirs = Array.from({ length: 5 }, (_, index) =>
      mkdtempSync(join(tmpdir(), `svf2-asset-planning-source-${index + 1}-`)),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-five-round-"));
    sourceDirs.forEach((sourceDir, index) => {
      writeFixedStoryboardSource(sourceDir, index + 1);
    });

    const result = await runAssetPlanningFiveRoundQualityCheck(
      { sourceDirs, outputDir, mode: "intent_compiler", live: true },
      {
        requireRealEnv: false,
        planGenerator: async ({
          round,
          sourceStoryboardRecordId,
          sourceScriptRecordId,
          sourceTopicPackageId,
          interactionLogWriter,
          onGlobalStructureEvent,
        }) => {
          if (round === 1) {
            await onGlobalStructureEvent?.({
              type: "normalization_applied",
              actions: [
                { type: "default_inserted", path: "art_bible.props[0].consistency_notes" },
                { type: "default_inserted", path: "tasks[0].risk_notes" },
              ],
            });
            await onGlobalStructureEvent?.({ type: "repair_started", issues: [] });
            await onGlobalStructureEvent?.({ type: "repair_succeeded" });
          } else if (round === 2) {
            await onGlobalStructureEvent?.({ type: "repair_started", issues: [] });
            await onGlobalStructureEvent?.({
              type: "repair_failed",
              initial_issues: [],
              patch_issues: [],
              final_issues: [],
            });
          } else if (round === 3) {
            await onGlobalStructureEvent?.({ type: "repair_started", issues: [] });
            await onGlobalStructureEvent?.({
              type: "repair_provider_failed",
              error_code: "llm_service_unavailable",
            });
          }
          interactionLogWriter?.write({
            generatedAt: "2026-05-11T00:00:00.000Z",
            provider: "test-provider",
            model: "test-model",
            operationName: "asset-planning.planner",
            promptId: "asset-planning.planner",
            promptStage: "asset-planning",
            promptLanguage: "zh-CN",
            promptSha256: "test-sha256",
            promptVersion: "test-v1",
            promptFilePath: "prompts/asset-planning/asset-planner.prompt.md",
            systemPrompt: "test prompt",
            input: {
              planning_mode: "global",
            },
            rawOutput: "{}",
            parsedOutput: {
              planning_mode: "global",
            },
          });
          interactionLogWriter?.write({
            generatedAt: "2026-05-11T00:00:01.000Z",
            provider: "test-provider",
            model: "test-model",
            operationName: "asset-planning.planner",
            promptId: "asset-planning.planner",
            promptStage: "asset-planning",
            promptLanguage: "zh-CN",
            promptSha256: "test-sha256",
            promptVersion: "test-v1",
            promptFilePath: "prompts/asset-planning/asset-planner.prompt.md",
            systemPrompt: "test prompt",
            input: {
              planning_mode: "segment_chunk",
              chunk: {
                chunk_id: "chunk_001",
                segment_ids: ["sb_001"],
              },
            },
            rawOutput: "{}",
            parsedOutput: {
              planning_mode: "segment_chunk",
              chunk_id: "chunk_001",
            },
          });
          interactionLogWriter?.write({
            generatedAt: "2026-05-11T00:00:02.000Z",
            provider: "test-provider",
            model: "test-model",
            operationName: "asset-planning.asset-structural-repair",
            promptId: "asset-planning.asset-structural-repair",
            promptStage: "asset-planning",
            promptLanguage: "zh-CN",
            promptSha256: "test-sha256",
            promptVersion: "test-v1",
            promptFilePath:
              "prompts/asset-planning/asset-structural-repair.prompt.md",
            systemPrompt: "test repair prompt",
            input: {
              repair_mode: "segment_chunk_structural_repair",
            },
            rawOutput: "{}",
            parsedOutput: {
              planning_mode: "segment_chunk",
              chunk_id: "chunk_001",
            },
            timing: {
              startedAt: "2026-05-11T00:00:02.000Z",
              finishedAt: "2026-05-11T00:00:02.025Z",
              durationMs: 25,
            },
          });
          interactionLogWriter?.write({
            generatedAt: "2026-05-11T00:00:03.000Z",
            provider: "test-provider",
            model: "test-model",
            operationName: "asset-planning.planner",
            promptId: "asset-planning.planner",
            promptStage: "asset-planning",
            promptLanguage: "zh-CN",
            promptSha256: "test-sha256",
            promptVersion: "test-v1",
            promptFilePath: "prompts/asset-planning/asset-planner.prompt.md",
            systemPrompt: "test prompt",
            input: {
              planning_mode: "segment_chunk",
              chunk: {
                chunk_id: "chunk_001",
                segment_ids: ["sb_001"],
              },
              safety_retry_context: {
                reason: "provider_content_filter",
              },
            },
            rawOutput: "{}",
            parsedOutput: {
              planning_mode: "segment_chunk",
              chunk_id: "chunk_001",
            },
            timing: {
              startedAt: "2026-05-11T00:00:03.000Z",
              finishedAt: "2026-05-11T00:00:03.035Z",
              durationMs: 35,
            },
          });
          return makeAssetPlan({
            storyboardRecordId: sourceStoryboardRecordId,
            scriptRecordId: sourceScriptRecordId,
            topicPackageId: sourceTopicPackageId,
          });
        },
      },
    );

    expect(result).toMatchObject({
      automated_gate: false,
      requires_real_env: true,
      total_rounds: 5,
      passed_rounds: 5,
      failed_rounds: 0,
      global_structure_normalization_event_count: 1,
      global_structure_normalization_used_rounds: 1,
      global_structure_normalized_path_count: 2,
      global_structural_repair_used_rounds: 3,
      global_structural_repair_succeeded_rounds: 1,
      global_structural_repair_failed_rounds: 1,
      global_structural_repair_provider_failed_rounds: 1,
    });

    const summary = JSON.parse(
      readFileSync(join(outputDir, "live-check-summary.json"), "utf8"),
    ) as {
      total_rounds: number;
      rounds: Array<{
        validation_decision: string;
        source_title: string;
        chunk_structural_repair_used: boolean;
        plan_structural_repair_used: boolean;
        provider_safety_retry_used: boolean;
        full_regen_used: boolean;
        first_pass_wall_time_ms: number;
        repair_wall_time_ms: number;
        regen_wall_time_ms: number;
        llm_call_count: number;
        global_structure_normalization_event_count: number;
        global_structure_normalized_path_count: number;
        global_structural_repair_used: boolean;
        global_structural_repair_succeeded: boolean;
        global_structural_repair_failed: boolean;
        global_structural_repair_provider_failed: boolean;
      }>;
    };
    expect(summary.total_rounds).toBe(5);
    expect(summary.rounds.map((round) => round.validation_decision)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(summary.rounds[0]).toMatchObject({
      chunk_structural_repair_used: true,
      plan_structural_repair_used: false,
      provider_safety_retry_used: true,
      full_regen_used: false,
      repair_wall_time_ms: 25,
      regen_wall_time_ms: 0,
      llm_call_count: 4,
      global_structure_normalization_event_count: 1,
      global_structure_normalized_path_count: 2,
      global_structural_repair_used: true,
      global_structural_repair_succeeded: true,
      global_structural_repair_failed: false,
      global_structural_repair_provider_failed: false,
    });
    expect(summary.rounds[1]).toMatchObject({
      global_structural_repair_used: true,
      global_structural_repair_failed: true,
      global_structural_repair_provider_failed: false,
    });
    expect(summary.rounds[2]).toMatchObject({
      global_structural_repair_used: true,
      global_structural_repair_failed: false,
      global_structural_repair_provider_failed: true,
    });
    expect(summary.rounds[0]?.first_pass_wall_time_ms).toEqual(expect.any(Number));
    expect(existsSync(join(outputDir, "gemini-review-pack.md"))).toBe(true);
    expect(readFileSync(join(outputDir, "gemini-review-pack.md"), "utf8")).toContain(
      "chunk_repair=true",
    );
    expect(existsSync(join(outputDir, "round-1", "source-storyboard-plan.json"))).toBe(true);
    expect(existsSync(join(outputDir, "round-1", "asset-plan.json"))).toBe(true);
    expect(readFileSync(join(outputDir, "round-1", "review.md"), "utf8")).toContain(
      "## Script",
    );
    const runtimeDiagnostics = JSON.parse(
      readFileSync(join(outputDir, "round-1", "runtime-diagnostics.json"), "utf8"),
    ) as {
      global_structure_observation?: {
        global_structure_normalization_event_count: number;
        global_structure_normalized_path_count: number;
        global_structural_repair_used: boolean;
        global_structural_repair_succeeded: boolean;
      };
      llm_calls?: Array<{
        sequence: number;
        prompt_id: string;
        planning_mode: string;
        chunk_id: string | null;
        started_at: string;
        finished_at: string;
        duration_ms: number;
        repair_mode: string | null;
        safety_retry_context_reason: string | null;
      }>;
    };
    expect(runtimeDiagnostics.global_structure_observation).toEqual({
      global_structure_normalization_event_count: 1,
      global_structure_normalized_path_count: 2,
      global_structural_repair_used: true,
      global_structural_repair_succeeded: true,
      global_structural_repair_failed: false,
      global_structural_repair_provider_failed: false,
    });
    expect(runtimeDiagnostics.llm_calls).toHaveLength(4);
    expect(runtimeDiagnostics.llm_calls?.slice(0, 2)).toEqual([
      expect.objectContaining({
        sequence: 1,
        prompt_id: "asset-planning.planner",
        planning_mode: "global",
        chunk_id: null,
      }),
      expect.objectContaining({
        sequence: 2,
        prompt_id: "asset-planning.planner",
        planning_mode: "segment_chunk",
        chunk_id: "chunk_001",
      }),
    ]);
    expect(runtimeDiagnostics.llm_calls?.[2]).toMatchObject({
      prompt_id: "asset-planning.asset-structural-repair",
      repair_mode: "segment_chunk_structural_repair",
      duration_ms: 25,
    });
    expect(runtimeDiagnostics.llm_calls?.[3]).toMatchObject({
      prompt_id: "asset-planning.planner",
      safety_retry_context_reason: "provider_content_filter",
      duration_ms: 35,
    });
    expect(runtimeDiagnostics.llm_calls?.[0]?.started_at).toEqual(
      expect.any(String),
    );
    expect(runtimeDiagnostics.llm_calls?.[0]?.finished_at).toEqual(
      expect.any(String),
    );
    expect(runtimeDiagnostics.llm_calls?.[0]?.duration_ms).toEqual(
      expect.any(Number),
    );

    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "harness:asset-planning-five-round-quality-check":
        "tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts",
    });

    const readme = readFileSync("harness/README.md", "utf8");
    expect(readme).toContain("harness:asset-planning-five-round-quality-check");
    expect(readme).toContain("fixed storyboard");
    expect(readme).toContain("--resume");
  });

  it("accepts inline output directory and explicit source directory", () => {
    expect(
      parseAssetPlanningFiveRoundQualityCheckCliArgs([
        "--source-dir",
        "fixed-storyboard",
        "--chunk-concurrency",
        "4",
        "--output-dir=asset-planning-output",
        "--resume",
      ]),
    ).toEqual({
      sourceDirs: ["fixed-storyboard"],
      chunkConcurrency: 4,
      resume: true,
      outputDir: "asset-planning-output",
      dryRun: true,
      live: false,
    });
  });

  it("rejects unknown flags and positional arguments", () => {
    expect(() =>
      parseAssetPlanningFiveRoundQualityCheckCliArgs(["--unknown-flag"]),
    ).toThrow("asset_planning_quality_check_argument_unknown");
    expect(() =>
      parseAssetPlanningFiveRoundQualityCheckCliArgs(["positional-output"]),
    ).toThrow("asset_planning_quality_check_argument_unknown");
  });

  it("rejects missing option values before unknown flags or help can be consumed", () => {
    const cases = [
      ["--source-dir", "asset_planning_quality_check_source_dir_required"],
      ["--fixture", "asset_planning_quality_check_fixture_required"],
      [
        "--chunk-concurrency",
        "asset_planning_quality_check_chunk_concurrency_required",
      ],
      ["--output-dir", "asset_planning_quality_check_output_dir_required"],
      ["--rounds", "asset_planning_quality_check_rounds_required"],
      [
        "--max-makeup-rounds",
        "asset_planning_quality_check_max_makeup_rounds_required",
      ],
      ["--mode", "asset_planning_quality_check_mode_required"],
    ] as const;
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const script = join(
      process.cwd(),
      "harness",
      "scripts",
      "runtime",
      "asset-planning-five-round-quality-check.ts",
    );
    for (const [flag, errorCode] of cases) {
      expect(() =>
        parseAssetPlanningFiveRoundQualityCheckCliArgs([
          flag,
          "--unknown-flag",
          "--help",
        ]),
      ).toThrow(errorCode);
      const spawned = spawnSync(
        process.execPath,
        [tsxCli, script, flag, "--unknown-flag", "--help"],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(spawned.status).not.toBe(0);
      expect(spawned.stderr).toContain(errorCode);
      expect(spawned.stdout).not.toContain("Usage:");
    }
  });

  it("creates unique default run directories and requires an existing explicit resume directory", async () => {
    const first = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
      mode: "intent_compiler",
      runId: "run-a",
    });
    const second = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
      mode: "intent_compiler",
      runId: "run-b",
    });
    expect(first.output_dir).not.toBe(second.output_dir);
    expect(first.output_dir).toContain("run-a");
    expect(second.output_dir).toContain("run-b");

    await expect(
      runAssetPlanningFiveRoundQualityCheck({
        fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
        mode: "intent_compiler",
        resume: true,
      }),
    ).rejects.toThrow("asset_planning_quality_check_resume_output_dir_required");
    await expect(
      runAssetPlanningFiveRoundQualityCheck({
        fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
        mode: "intent_compiler",
        resume: true,
        outputDir: join(tmpdir(), "definitely-missing-asset-planning-run"),
      }),
    ).rejects.toThrow("asset_planning_quality_check_resume_output_not_found");
  });

  it("defaults every CLI invocation to dry-run unless live is explicit", () => {
    expect(parseAssetPlanningFiveRoundQualityCheckCliArgs([])).toEqual({
      dryRun: true,
      live: false,
    });
    expect(
      parseAssetPlanningFiveRoundQualityCheckCliArgs([
        "--live",
        "--mode=intent_compiler",
      ]),
    ).toEqual({
      mode: "intent_compiler",
      dryRun: false,
      live: true,
    });
  });

  it("parses the explicit fixture dry-run gate without enabling live provider calls", () => {
    expect(
      parseAssetPlanningFiveRoundQualityCheckCliArgs([
        "--fixture=tests/fixtures/asset-planning/long-15-segment-input.json",
        "--mode=intent_compiler",
        "--rounds=5",
        "--max-makeup-rounds=2",
      ]),
    ).toEqual({
      fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
      mode: "intent_compiler",
      rounds: 5,
      maxMakeupRounds: 2,
      dryRun: true,
      live: false,
    });
  });

  it("reports a zero-denominator fixture dry-run and never calls the provider", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-dry-run-"));
    const planGenerator = vi.fn();

    const result = await runAssetPlanningFiveRoundQualityCheck(
      {
        fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
        mode: "intent_compiler",
        rounds: 5,
        maxMakeupRounds: 2,
        dryRun: true,
        outputDir,
      },
      { requireRealEnv: true, planGenerator },
    );

    expect(planGenerator).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      generation_mode: "intent_compiler",
      requires_real_env: false,
      target_rounds: 5,
      total_rounds: 0,
      valid_provider_rounds: 0,
      end_to_end_success_rounds: 0,
      provider_failure_rounds: 0,
      structural_compiler_failure_rounds: 0,
      repair_attempts: 0,
      regeneration_attempts: 0,
      safety_attempts: 0,
      provider_attempts: 0,
      makeup_rounds: 0,
      zero_denominator: true,
      dry_run: true,
      estimated_chunk_count: 8,
      max_total_rounds: 7,
      network_requests_per_chunk_max: 10,
      worst_case_chunk_network_requests: 560,
      global_planning_requests_per_round_max: 2,
      global_safety_requests_per_round_max: 2,
      global_structural_repair_requests_per_round_max: 2,
      global_provider_requests_per_round_max: 6,
      worst_case_global_provider_requests: 42,
      worst_case_total_provider_requests: 602,
    });
    expect(JSON.parse(readFileSync(join(outputDir, "live-check-summary.json"), "utf8"))).toMatchObject({
      zero_denominator: true,
      provider_attempts: 0,
    });
  });

  it("keeps the runner dry unless live true is explicit even with source directories", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-runner-dry-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-runner-dry-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn();

    const result = await runAssetPlanningFiveRoundQualityCheck(
      { sourceDirs: [sourceDir], outputDir, rounds: 1 },
      { requireRealEnv: false, planGenerator },
    );

    expect(planGenerator).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dry_run: true,
      requires_real_env: false,
      total_rounds: 0,
      provider_attempts: 0,
    });
  });

  it("accepts Windows npm.cmd argument forwarding for help and fixture dry-run", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-cli-spawn-"));
    const help = spawnNpm([
      "run",
      "harness:asset-planning-five-round-quality-check",
      "--",
      "--help",
    ]);
    expectSuccessfulCleanSpawn(help);
    expect(help.stdout).toContain("Windows PowerShell: use npm.cmd");
    expect(help.stdout).toContain(
      "npm.cmd run harness:asset-planning-five-round-quality-check",
    );
    expect(help.stdout).not.toContain(
      "  npm run harness:asset-planning-five-round-quality-check",
    );

    const dryRun = spawnNpm([
        "run",
        "harness:asset-planning-five-round-quality-check",
        "--",
        "--fixture=tests/fixtures/asset-planning/long-15-segment-input.json",
        "--mode=intent_compiler",
        "--rounds=5",
        "--max-makeup-rounds=2",
        "--dry-run",
        `--output-dir=${outputDir}`,
      ]);
    expectSuccessfulCleanSpawn(dryRun);
    expect(dryRun.stdout).toContain('"estimated_chunk_count": 8');
    expect(dryRun.stdout).toContain('"provider_attempts": 0');
    expect(dryRun.stdout).toContain(`"output_dir": "${outputDir.replaceAll("\\", "\\\\")}"`);
    expect(existsSync(join(outputDir, "live-check-summary.json"))).toBe(true);
  });

  it("cold-starts help and dry-run without loading runtime env configuration", () => {
    const coldCwd = mkdtempSync(join(tmpdir(), "svf2-asset-planning-cold-start-"));
    const outputDir = join(coldCwd, "output");
    writeFileSync(
      join(coldCwd, ".env"),
      "ASSET_PLANNING_GENERATION_MODE=definitely_invalid\n",
      "utf8",
    );
    const cleanEnv = { ...process.env, VITEST: undefined, NODE_ENV: undefined };
    const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const script = join(
      process.cwd(),
      "harness",
      "scripts",
      "runtime",
      "asset-planning-five-round-quality-check.ts",
    );
    const fixture = join(
      process.cwd(),
      "tests",
      "fixtures",
      "asset-planning",
      "long-15-segment-input.json",
    );

    const help = spawnSync(process.execPath, [tsxCli, script, "--help"], {
      cwd: coldCwd,
      env: cleanEnv,
      encoding: "utf8",
    });
    expectSuccessfulCleanSpawn(help);

    const dryRun = spawnSync(
      process.execPath,
      [
        tsxCli,
        script,
        `--fixture=${fixture}`,
        "--mode=intent_compiler",
        "--rounds=1",
        "--dry-run",
        "--output-dir",
        outputDir,
      ],
      { cwd: coldCwd, env: cleanEnv, encoding: "utf8" },
    );
    expectSuccessfulCleanSpawn(dryRun);
    expect(dryRun.stdout).toContain('"provider_attempts": 0');
    const coldPlan = JSON.parse(
      readFileSync(join(outputDir, "live-check-plan.json"), "utf8"),
    );
    expect(coldPlan.run_manifest.fingerprint_inputs).toMatchObject({
      provider_id: "not_loaded_dry_run",
      model_id: "not_loaded_dry_run",
      prompt_bundle_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      runtime_revision_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      runtime_profile_sha256: "not_loaded_dry_run",
    });
  });

  it("rejects conflicting dry-run/live flags and legacy live mode", async () => {
    expect(() =>
      parseAssetPlanningFiveRoundQualityCheckCliArgs([
        "--dry-run",
        "--live",
        "--mode=intent_compiler",
      ]),
    ).toThrow("asset_planning_quality_check_dry_run_live_conflict");
    await expect(
      runAssetPlanningFiveRoundQualityCheck({ dryRun: true, live: true }),
    ).rejects.toThrow("asset_planning_quality_check_dry_run_live_conflict");
    await expect(
      runAssetPlanningFiveRoundQualityCheck({ live: true, mode: "legacy" }),
    ).rejects.toThrow("asset_planning_quality_check_live_mode_unsupported");
  });

  it("keeps 15 and 21 segment fixture reports in separate default output directories", () => {
    const fifteen = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
      mode: "intent_compiler",
    });
    const twentyOne = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture: "tests/fixtures/asset-planning/long-21-segment-input.json",
      mode: "intent_compiler",
    });

    expect(fifteen.output_dir).not.toBe(twentyOne.output_dir);
    expect(fifteen.output_dir).toContain("long-15-segment-input-intent_compiler");
    expect(twentyOne.output_dir).toContain("long-21-segment-input-intent_compiler");
  });

  it("separates default dry-run and live evidence directories", () => {
    const fixture =
      "tests/fixtures/asset-planning/long-15-segment-input.json";
    const dryPlan = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture,
      mode: "intent_compiler",
      dryRun: true,
    });
    const livePlan = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture,
      mode: "intent_compiler",
      live: true,
    });

    expect(dryPlan.output_dir).not.toBe(livePlan.output_dir);
    expect(dryPlan.output_dir).toContain("dry-run");
    expect(livePlan.output_dir).toContain("live");
  });

  it("fingerprints canonical input content, source order, and run configuration without persisting source text", () => {
    const sourceA = mkdtempSync(join(tmpdir(), "svf2-asset-planning-fingerprint-a-"));
    const sourceB = mkdtempSync(join(tmpdir(), "svf2-asset-planning-fingerprint-b-"));
    writeFixedStoryboardSource(sourceA, 1);
    writeFixedStoryboardSource(sourceB, 2);
    const secret = "FINGERPRINT_SOURCE_SECRET_MUST_NOT_PERSIST";
    const sourceScriptPath = join(sourceA, "source-script-draft.json");
    const sourceScript = JSON.parse(readFileSync(sourceScriptPath, "utf8"));
    sourceScript.script_text = `${sourceScript.script_text} ${secret}`;
    writeJson(sourceScriptPath, sourceScript);
    const base = {
      sourceDirs: [sourceA, sourceB],
      rounds: 2,
      maxMakeupRounds: 1,
      mode: "intent_compiler" as const,
      chunkConcurrency: 2,
    };
    const fingerprint = (
      overrides: Partial<AssetPlanningFiveRoundQualityCheckInput> = {},
    ) =>
      buildAssetPlanningFiveRoundQualityCheckPlan({ ...base, ...overrides })
        .run_manifest.fingerprint;

    expect(fingerprint()).not.toBe(
      fingerprint({ sourceDirs: [sourceB, sourceA] }),
    );
    expect(fingerprint()).not.toBe(fingerprint({ rounds: 3 }));
    expect(fingerprint()).not.toBe(fingerprint({ maxMakeupRounds: 2 }));
    expect(fingerprint()).not.toBe(fingerprint({ chunkConcurrency: 3 }));
    expect(fingerprint()).not.toBe(fingerprint({ mode: "legacy" }));
    const planText = JSON.stringify(
      buildAssetPlanningFiveRoundQualityCheckPlan(base),
    );
    expect(planText).not.toContain(secret);

    const beforeContentChange = fingerprint();
    sourceScript.script_text = `${sourceScript.script_text} changed`;
    writeJson(sourceScriptPath, sourceScript);
    expect(fingerprint()).not.toBe(beforeContentChange);

    const fixturePath = join(
      mkdtempSync(join(tmpdir(), "svf2-asset-planning-fingerprint-fixture-")),
      "fixture.json",
    );
    const fixture = JSON.parse(
      readFileSync(
        "tests/fixtures/asset-planning/long-15-segment-input.json",
        "utf8",
      ),
    );
    writeJson(fixturePath, fixture);
    const fixtureFingerprint = buildAssetPlanningFiveRoundQualityCheckPlan({
      fixture: fixturePath,
      mode: "intent_compiler",
    }).run_manifest.fingerprint;
    fixture.script.script_text = `${fixture.script.script_text} changed`;
    writeJson(fixturePath, fixture);
    expect(
      buildAssetPlanningFiveRoundQualityCheckPlan({
        fixture: fixturePath,
        mode: "intent_compiler",
      }).run_manifest.fingerprint,
    ).not.toBe(fixtureFingerprint);
  });

  it("hashes the conservative runtime content tree independent of file creation order", () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "svf2-runtime-tree-first-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "svf2-runtime-tree-second-"));
    const files = [
      ["backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts", "enrichment-v1"],
      ["backend/src/runtime/llm/llm-gateway.ts", "gateway-v1"],
      ["shared/src/index.ts", "shared-schema-v1"],
      ["prompts/asset-planning/segment-intent-planner.prompt.md", "prompt-v1"],
      ["harness/scripts/runtime/asset-planning-five-round-quality-check.ts", "harness-v1"],
      ["backend/providers.json", "providers-v1"],
      ["package-lock.json", "lock-v1"],
    ] as const;
    const populate = (root: string, entries: typeof files) => {
      for (const [relativePath, content] of entries) {
        const filePath = join(root, relativePath);
        mkdirSync(join(filePath, ".."), { recursive: true });
        writeFileSync(filePath, content, "utf8");
      }
    };
    populate(firstRoot, files);
    populate(secondRoot, [...files].reverse() as unknown as typeof files);
    const baseline = computeAssetPlanningRuntimeRevisionSha256(firstRoot);
    expect(computeAssetPlanningRuntimeRevisionSha256(secondRoot)).toBe(baseline);

    for (const relativePath of [
      "backend/src/modules/asset-planning/asset-plan-prompt-enrichment.ts",
      "backend/src/runtime/llm/llm-gateway.ts",
      "shared/src/index.ts",
    ]) {
      const filePath = join(firstRoot, relativePath);
      const original = readFileSync(filePath, "utf8");
      writeFileSync(filePath, `${original}-changed`, "utf8");
      expect(computeAssetPlanningRuntimeRevisionSha256(firstRoot)).not.toBe(
        baseline,
      );
      writeFileSync(filePath, original, "utf8");
    }
    const addedDependency = join(
      firstRoot,
      "backend/src/modules/asset-planning/new-runtime-dependency.ts",
    );
    writeFileSync(addedDependency, "new-dependency", "utf8");
    expect(computeAssetPlanningRuntimeRevisionSha256(firstRoot)).not.toBe(
      baseline,
    );
  });

  it("separates provider failures from structural failures and counts settled attempts", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-metrics-source-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-metrics-output-"));
    writeFixedStoryboardSource(sourceDir, 1);

    const result = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 2,
        maxMakeupRounds: 2,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        runtimeFingerprintInputs: injectedRuntimeFingerprintInputs,
        planGenerator: async ({
          round,
          sourceStoryboardRecordId,
          sourceScriptRecordId,
          sourceTopicPackageId,
          onIntentChunkSettled,
          interactionLogWriter,
        }) => {
          writeTestInteraction(interactionLogWriter);
          if (round === 1) {
            await onIntentChunkSettled?.({
              type: "intent_chunk_settled",
              chunk_id: "chunk_001",
              chunk_index: 0,
              outcome: "failure",
              status: "failed",
              stage: "regenerated",
              accounting: {
                chunk_id: "chunk_001",
                business_slot: 3,
                logical_invocation: 4,
                safety_invocation: 1,
                provider_attempts: 6,
                network_request_count: 6,
              },
              compiler_actions: [],
              error_code: "llm_service_unavailable",
              failure_class: "provider",
            });
            throw Object.assign(new Error("provider unavailable"), {
              code: "llm_service_unavailable",
            });
          }
          if (round === 3) {
            throw Object.assign(new Error("compiler invariant"), {
              code: "asset_plan_compiler_invariant_failed",
            });
          }
          await onIntentChunkSettled?.({
            type: "intent_chunk_settled",
            chunk_id: "chunk_001",
            chunk_index: 0,
            outcome: "success",
            status: "compiled",
            stage: "compiled",
            accounting: {
              chunk_id: "chunk_001",
              business_slot: 3,
              logical_invocation: 4,
              safety_invocation: 2,
              provider_attempts: 5,
              network_request_count: 5,
            },
            compiler_actions: [],
          });
          return makeAssetPlan({
            storyboardRecordId: sourceStoryboardRecordId,
            scriptRecordId: sourceScriptRecordId,
            topicPackageId: sourceTopicPackageId,
          });
        },
      },
    );

    expect(result).toMatchObject({
      target_rounds: 2,
      total_rounds: 3,
      valid_provider_rounds: 2,
      end_to_end_success_rounds: 1,
      provider_failure_rounds: 1,
      structural_compiler_failure_rounds: 1,
      repair_attempts: 2,
      regeneration_attempts: 2,
      safety_attempts: 3,
      provider_attempts: 11,
      makeup_rounds: 1,
      zero_denominator: false,
    });
    expect(result.rounds.map((round) => round.failure_class)).toEqual([
      "provider",
      null,
      "structural_compiler",
    ]);
    expect(readFileSync(join(outputDir, "gemini-review-pack.md"), "utf8")).toContain(
      "valid_provider_rounds: 2",
    );
  });

  it("classifies every frozen ExternalServiceError code as provider failure before chunks start", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-provider-codes-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-provider-codes-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const codes = [
      "configuration",
      "timeout",
      "network",
      "invalid_request",
      "invalid_response",
      "rate_limited",
      "service_unavailable",
      "budget_exceeded",
      "unknown",
      "content_filter",
      "llm_service_unavailable",
    ];

    const result = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        maxMakeupRounds: codes.length - 1,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        planGenerator: async ({ round }) => {
          const code = codes[round - 1]!;
          throw new ExternalServiceError({
            provider: "llm",
            operation: "asset-planning.segment-intent-planner",
            retryable: false,
            code,
            userMessage: "provider failed",
            debugMessage: "provider failed",
          });
        },
      },
    );

    expect(result).toMatchObject({
      total_rounds: codes.length,
      valid_provider_rounds: 0,
      provider_failure_rounds: codes.length,
      structural_compiler_failure_rounds: 0,
      zero_denominator: true,
    });
  });

  it("classifies mixed concurrent chunk failures as structural when any failure is non-provider", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-mixed-failure-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-mixed-failure-output-"));
    writeFixedStoryboardSource(sourceDir, 1);

    const result = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        planGenerator: async ({ onIntentChunkSettled, interactionLogWriter }) => {
          writeTestInteraction(interactionLogWriter);
          const base = {
            type: "intent_chunk_settled" as const,
            outcome: "failure" as const,
            status: "failed" as const,
            stage: "regenerated" as const,
            accounting: {
              business_slot: 3,
              logical_invocation: 3,
              safety_invocation: 0,
              provider_attempts: 2,
              network_request_count: 2,
            },
            compiler_actions: [],
          };
          await onIntentChunkSettled?.({
            ...base,
            chunk_id: "chunk_001",
            chunk_index: 0,
            accounting: { ...base.accounting, chunk_id: "chunk_001" },
            failure_class: "provider",
            error_code: "service_unavailable",
          });
          await onIntentChunkSettled?.({
            ...base,
            chunk_id: "chunk_002",
            chunk_index: 1,
            accounting: { ...base.accounting, chunk_id: "chunk_002" },
            failure_class: "business",
            error_code: "intent_chunk_business_failed",
          });
          throw Object.assign(new Error("provider primary"), {
            code: "service_unavailable",
          });
        },
      },
    );

    expect(result).toMatchObject({
      provider_failure_rounds: 0,
      structural_compiler_failure_rounds: 1,
      valid_provider_rounds: 1,
    });
    expect(
      JSON.parse(
        readFileSync(join(outputDir, "round-1", "round-result.json"), "utf8"),
      ),
    ).toMatchObject({
      outcome: "structural_failure",
      success: false,
      failure_class: "structural_compiler",
      failure_code: "asset_planning_structural_compiler_failure",
    });
  });

  it("counts intent global structural repair attempts", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-global-repair-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-global-repair-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const result = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        planGenerator: async ({
          sourceStoryboardRecordId,
          sourceScriptRecordId,
          sourceTopicPackageId,
          onGlobalStructureEvent,
          interactionLogWriter,
        }) => {
          writeTestInteraction(interactionLogWriter);
          await onGlobalStructureEvent?.({ type: "repair_started", issues: [] });
          await onGlobalStructureEvent?.({ type: "repair_succeeded" });
          return makeAssetPlan({
            storyboardRecordId: sourceStoryboardRecordId,
            scriptRecordId: sourceScriptRecordId,
            topicPackageId: sourceTopicPackageId,
          });
        },
      },
    );
    expect(result.repair_attempts).toBe(1);
  });

  it("does not full-regenerate an intent compiler plan after local structural validation fails", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-no-regen-source-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-no-regen-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const invalidPlan = makeAssetPlan({
      storyboardRecordId: "fixed-storyboard-record-1",
      scriptRecordId: "script_1",
      topicPackageId: "topic_1",
    });
    invalidPlan.dependencies = [
      {
        dependency_id: "dep_missing",
        task_id: "subtitle_001",
        depends_on_task_id: "missing_task",
        dependency_type: "requires_timing",
      },
    ];
    const planGenerator = vi.fn(async () => invalidPlan);

    const result = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        live: true,
      },
      { requireRealEnv: false, planGenerator },
    );

    expect(planGenerator).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      structural_compiler_failure_rounds: 1,
      regeneration_attempts: 0,
    });
  });

  it("passes chunk concurrency override to the asset plan generator", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-source-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-concurrency-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn(
      async ({ sourceStoryboardRecordId, sourceScriptRecordId, sourceTopicPackageId }) =>
        makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        }),
    );

    await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        chunkConcurrency: 4,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        planGenerator,
      },
    );

    expect(planGenerator).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkConcurrency: 4,
      }),
    );
  });

  it("records failed rounds when the planner throws instead of aborting the live summary", async () => {
    const sourceDirs = Array.from({ length: 2 }, (_, index) =>
      mkdtempSync(join(tmpdir(), `svf2-asset-planning-failure-source-${index + 1}-`)),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-failure-"));
    sourceDirs.forEach((sourceDir, index) => {
      writeFixedStoryboardSource(sourceDir, index + 1);
    });
    const planGenerator = vi.fn(
      async ({
        round,
        sourceStoryboardRecordId,
        sourceScriptRecordId,
        sourceTopicPackageId,
        interactionLogWriter,
      }) => {
        interactionLogWriter?.write({
          generatedAt: "2026-05-11T00:00:00.000Z",
          provider: "test-provider",
          model: "test-model",
          operationName: "asset-planning.planner",
          promptId: "asset-planning.planner",
          promptStage: "asset-planning",
          promptLanguage: "zh-CN",
          promptSha256: "test-sha256",
          promptVersion: "test-v1",
          promptFilePath:
            "prompts/asset-planning/asset-planner.prompt.md",
          systemPrompt: "test prompt",
          input: {
            planning_mode: "segment_chunk",
            chunk: {
              chunk_id: "chunk_001",
              segment_ids: ["sb_001"],
            },
          },
          rawOutput: round === 2 ? "" : "{}",
          parsedOutput:
            round === 2
              ? null
              : {
                  planning_mode: "segment_chunk",
                  chunk_id: "chunk_001",
                },
          errorMessage: round === 2 ? "400 contentFilter" : null,
        });
        if (round === 2) {
          throw Object.assign(new Error("400 contentFilter"), {
            code: "invalid_request",
            retryable: false,
          });
        }

        return makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        });
      },
    );

    const result = await runAssetPlanningFiveRoundQualityCheck(
      { sourceDirs, outputDir, rounds: 2, mode: "intent_compiler", live: true },
      {
        requireRealEnv: false,
        planGenerator,
      },
    );

    expect(result.passed_rounds).toBe(1);
    expect(result.failed_rounds).toBe(1);
    expect(result.rounds[1]).toMatchObject({
      round: 2,
      status: "round-failed",
      validation_decision: "external_error",
      validation_errors: ["invalid_request"],
      task_count: 0,
      dependency_count: 0,
    });
    expect(existsSync(join(outputDir, "live-check-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "round-2", "runtime-diagnostics.json"))).toBe(
      true,
    );
    const failedReview = readFileSync(
      join(outputDir, "round-2", "review.md"),
      "utf8",
    );
    expect(failedReview).toContain("invalid_request");
    expect(failedReview).not.toContain("400 contentFilter");
    const diagnostics = JSON.parse(
      readFileSync(join(outputDir, "round-2", "runtime-diagnostics.json"), "utf8"),
    ) as { checks?: Array<{ code: string; level: string }> };
    expect(diagnostics.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_request",
          level: "error",
        }),
      ]),
    );
  });

  it("persists only stable failure code and class across diagnostics, review, and interaction markdown", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-secret-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-secret-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const secret = "TOP_SECRET_RAW_PROVIDER_PAYLOAD";

    await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        planGenerator: async ({ interactionLogWriter }) => {
          interactionLogWriter?.write({
            generatedAt: "2026-08-10T00:00:00.000Z",
            provider: "test-provider",
            model: "test-model",
            operationName: "asset-planning.segment-intent-planner",
            promptId: "asset-planning.segment-intent-planner",
            promptStage: "asset-planning",
            promptLanguage: "zh-CN",
            promptSha256: "test-sha256",
            promptVersion: "test-v1",
            promptFilePath: "prompts/asset-planning/segment-intent-planner.prompt.md",
            systemPrompt: secret,
            input: { secret },
            rawOutput: secret,
            parsedOutput: null,
            errorMessage: secret,
            attempts: [
              {
                attempt: 1,
                startedAt: "2026-08-10T00:00:00.000Z",
                finishedAt: "2026-08-10T00:00:00.010Z",
                durationMs: 10,
                outcome: "error",
                errorCode: "service_unavailable",
              },
            ],
          });
          throw Object.assign(new Error(secret), { code: "service_unavailable" });
        },
      },
    );

    const persisted = readAllTextFiles(outputDir);
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain("service_unavailable");
    expect(persisted).toContain("provider");
  });

  it("renders a retry-success interaction as success while retaining safe attempt codes", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-retry-success-"));
    const outputDir = mkdtempSync(
      join(tmpdir(), "svf2-asset-planning-retry-success-output-"),
    );
    writeFixedStoryboardSource(sourceDir, 1);

    await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        live: true,
      },
      {
        requireRealEnv: false,
        runtimeFingerprintInputs: injectedRuntimeFingerprintInputs,
        planGenerator: async ({
          interactionLogWriter,
          sourceStoryboardRecordId,
          sourceScriptRecordId,
          sourceTopicPackageId,
        }) => {
          interactionLogWriter?.write({
            generatedAt: "2026-08-10T00:00:00.000Z",
            provider: "test-provider",
            model: "test-model",
            operationName: "asset-planning.segment-intent-planner",
            promptId: "asset-planning.segment-intent-planner",
            promptStage: "asset-planning",
            promptLanguage: "zh-CN",
            promptSha256: "test-sha256",
            promptVersion: "test-v1",
            promptFilePath:
              "prompts/asset-planning/segment-intent-planner.prompt.md",
            systemPrompt: "safe prompt",
            input: { planning_mode: "segment_intent_batch" },
            rawOutput: "SAFE_FINAL_OUTPUT",
            parsedOutput: { planning_mode: "segment_intent_batch" },
            attempts: [
              {
                attempt: 1,
                startedAt: "2026-08-10T00:00:00.000Z",
                finishedAt: "2026-08-10T00:00:00.010Z",
                durationMs: 10,
                outcome: "error",
                errorCode: "timeout",
              },
              {
                attempt: 2,
                startedAt: "2026-08-10T00:00:00.020Z",
                finishedAt: "2026-08-10T00:00:00.030Z",
                durationMs: 10,
                outcome: "success",
              },
            ],
          });
          return makeAssetPlan({
            storyboardRecordId: sourceStoryboardRecordId,
            scriptRecordId: sourceScriptRecordId,
            topicPackageId: sourceTopicPackageId,
          });
        },
      },
    );

    const interaction = readFileSync(
      join(
        outputDir,
        "round-1",
        "llm-interactions",
        "01-asset-planning.segment-intent-planner.md",
      ),
      "utf8",
    );
    expect(interaction).toContain("SAFE_FINAL_OUTPUT");
    expect(interaction).toContain("timeout");
    expect(interaction).not.toContain("# LLM failure interaction");
    const marker = JSON.parse(
      readFileSync(join(outputDir, "round-1", "round-result.json"), "utf8"),
    );
    expect(marker.required_paths).toContain(
      "llm-interactions/01-asset-planning.segment-intent-planner.md",
    );
    expect(marker.interaction_evidence).toEqual([
      "llm-interactions/01-asset-planning.segment-intent-planner.md",
    ]);

    unlinkSync(
      join(
        outputDir,
        "round-1",
        "llm-interactions",
        "01-asset-planning.segment-intent-planner.md",
      ),
    );
    const resumedGenerator = vi.fn();
    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        {
          sourceDirs: [sourceDir],
          outputDir,
          rounds: 1,
          mode: "intent_compiler",
          live: true,
          resume: true,
        },
        {
          requireRealEnv: false,
          runtimeFingerprintInputs: injectedRuntimeFingerprintInputs,
          planGenerator: resumedGenerator,
        },
      ),
    ).rejects.toThrow("asset_planning_quality_check_partial_round_evidence");
    expect(resumedGenerator).not.toHaveBeenCalled();
  });

  it("refuses to settle a round with provider attempts but no interaction markdown", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-missing-log-"));
    const outputDir = mkdtempSync(
      join(tmpdir(), "svf2-asset-planning-missing-log-output-"),
    );
    writeFixedStoryboardSource(sourceDir, 1);

    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        {
          sourceDirs: [sourceDir],
          outputDir,
          rounds: 1,
          mode: "intent_compiler",
          live: true,
        },
        {
          requireRealEnv: false,
          runtimeFingerprintInputs: injectedRuntimeFingerprintInputs,
          planGenerator: async ({
            onIntentChunkSettled,
            sourceStoryboardRecordId,
            sourceScriptRecordId,
            sourceTopicPackageId,
          }) => {
            await onIntentChunkSettled?.({
              type: "intent_chunk_settled",
              chunk_id: "chunk_001",
              chunk_index: 0,
              outcome: "success",
              status: "compiled",
              stage: "compiled",
              accounting: {
                chunk_id: "chunk_001",
                business_slot: 1,
                logical_invocation: 1,
                safety_invocation: 0,
                provider_attempts: 1,
                network_request_count: 1,
              },
              compiler_actions: [],
            });
            return makeAssetPlan({
              storyboardRecordId: sourceStoryboardRecordId,
              scriptRecordId: sourceScriptRecordId,
              topicPackageId: sourceTopicPackageId,
            });
          },
        },
      ),
    ).rejects.toThrow(
      "asset_planning_quality_check_interaction_evidence_missing",
    );
    expect(existsSync(join(outputDir, "round-1", "round-result.json"))).toBe(
      false,
    );
  });

  it("rejects a non-resume live run when round evidence already exists", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-evidence-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-evidence-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn(
      async ({ sourceStoryboardRecordId, sourceScriptRecordId, sourceTopicPackageId }) =>
        makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        }),
    );
    const input = {
      sourceDirs: [sourceDir],
      outputDir,
      rounds: 1,
      mode: "intent_compiler" as const,
      live: true,
    };
    await runAssetPlanningFiveRoundQualityCheck(input, {
      requireRealEnv: false,
      planGenerator,
    });
    planGenerator.mockClear();

    await expect(
      runAssetPlanningFiveRoundQualityCheck(input, {
        requireRealEnv: false,
        planGenerator,
      }),
    ).rejects.toThrow("asset_planning_quality_check_existing_evidence_requires_resume");
    expect(planGenerator).not.toHaveBeenCalled();
  });

  it("treats any non-empty round directory as existing live evidence", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-any-evidence-"));
    mkdirSync(join(outputDir, "round-1"));
    writeFileSync(join(outputDir, "round-1", "unexpected.partial"), "partial", "utf8");
    const planGenerator = vi.fn();

    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        {
          outputDir,
          rounds: 1,
          mode: "intent_compiler",
          live: true,
        },
        { requireRealEnv: false, planGenerator },
      ),
    ).rejects.toThrow(
      "asset_planning_quality_check_existing_evidence_requires_resume",
    );
    expect(planGenerator).not.toHaveBeenCalled();
  });

  it("rejects dry-run output that points at live round evidence", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-dry-live-"));
    mkdirSync(join(outputDir, "round-1"));
    writeFileSync(join(outputDir, "round-1", "round-result.json"), "{}", "utf8");

    await expect(
      runAssetPlanningFiveRoundQualityCheck({
        fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        dryRun: true,
      }),
    ).rejects.toThrow(
      "asset_planning_quality_check_dry_run_live_evidence_conflict",
    );
    expect(readdirSync(outputDir)).toEqual(["round-1"]);
  });

  it("atomically persists and resumes a settled provider-failure round", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-failed-resume-"));
    const outputDir = mkdtempSync(
      join(tmpdir(), "svf2-asset-planning-failed-resume-output-"),
    );
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn(async ({ onIntentChunkSettled, interactionLogWriter }) => {
      writeTestInteraction(interactionLogWriter);
      await onIntentChunkSettled?.({
        type: "intent_chunk_settled",
        chunk_id: "chunk_001",
        chunk_index: 0,
        outcome: "failure",
        status: "failed",
        stage: "provider",
        failure_class: "provider",
        error_code: "timeout",
        accounting: {
          chunk_id: "chunk_001",
          business_slot: 2,
          logical_invocation: 2,
          safety_invocation: 1,
          provider_attempts: 3,
          network_request_count: 3,
        },
        compiler_actions: [],
      });
      throw Object.assign(new Error("raw provider detail"), { code: "timeout" });
    });
    const input = {
      sourceDirs: [sourceDir],
      outputDir,
      rounds: 1,
      maxMakeupRounds: 1,
      mode: "intent_compiler" as const,
      live: true,
    };

    const first = await runAssetPlanningFiveRoundQualityCheck(input, {
      requireRealEnv: false,
      planGenerator,
    });
    expect(first).toMatchObject({
      total_rounds: 2,
      provider_failure_rounds: 2,
      repair_attempts: 2,
      safety_attempts: 2,
      provider_attempts: 6,
    });
    const roundResultPath = join(outputDir, "round-1", "round-result.json");
    const settled = JSON.parse(readFileSync(roundResultPath, "utf8"));
    expect(settled).toMatchObject({
      round: 1,
      outcome: "provider_failure",
      success: false,
      failure_class: "provider",
      failure_code: "timeout",
      attempt_accounting: {
        repair_attempts: 1,
        safety_attempts: 1,
        provider_attempts: 3,
        accounting_complete: true,
      },
    });
    const artifactContract = buildAssetPlanningFiveRoundQualityCheckPlan(input)
      .required_artifacts;
    expect(settled.required_paths).toEqual([
      ...artifactContract.all_settled,
      ...artifactContract.failure_only,
      "llm-interactions/01-asset-planning.segment-intent-planner.md",
    ]);
    expect(settled.interaction_evidence).toEqual([
      "llm-interactions/01-asset-planning.segment-intent-planner.md",
    ]);
    expect(settled.required_paths).not.toContain("asset-plan.json");
    expect(settled.required_paths).not.toContain(
      "asset-planning-validation-result.json",
    );
    expect(readdirSync(join(outputDir, "round-1"))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.tmp$/u)]),
    );
    planGenerator.mockClear();

    const resumed = await runAssetPlanningFiveRoundQualityCheck(
      { ...input, resume: true },
      { requireRealEnv: false, planGenerator },
    );
    expect(planGenerator).not.toHaveBeenCalled();
    expect(resumed).toMatchObject({
      total_rounds: 2,
      provider_failure_rounds: 2,
      repair_attempts: 2,
      safety_attempts: 2,
      provider_attempts: 6,
    });
    expect(resumed.rounds[0]).toMatchObject({ resumed: true });
  });

  it("rejects resume fingerprint drift before overwriting the root plan or settled round", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-drift-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-drift-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn(
      async ({ sourceStoryboardRecordId, sourceScriptRecordId, sourceTopicPackageId }) =>
        makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        }),
    );
    const input = {
      sourceDirs: [sourceDir],
      outputDir,
      rounds: 1,
      mode: "intent_compiler" as const,
      live: true,
    };
    await runAssetPlanningFiveRoundQualityCheck(input, {
      requireRealEnv: false,
      planGenerator,
    });
    const planPath = join(outputDir, "live-check-plan.json");
    const roundPath = join(outputDir, "round-1", "round-result.json");
    const originalPlan = readFileSync(planPath, "utf8");
    const originalRound = readFileSync(roundPath, "utf8");
    const originalManifest = JSON.parse(originalPlan).run_manifest;
    expect(JSON.parse(originalRound)).toMatchObject({
      run_fingerprint: originalManifest.fingerprint,
    });
    const mismatchedRound = JSON.parse(originalRound);
    mismatchedRound.run_fingerprint = "0".repeat(64);
    writeJson(roundPath, mismatchedRound);
    const mismatchedRoundText = readFileSync(roundPath, "utf8");
    const paddedPlan = `${originalPlan}\n`;
    writeFileSync(planPath, paddedPlan, "utf8");
    planGenerator.mockClear();
    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        { ...input, resume: true },
        { requireRealEnv: false, planGenerator },
      ),
    ).rejects.toThrow("asset_planning_quality_check_round_fingerprint_mismatch");
    expect(readFileSync(planPath, "utf8")).toBe(paddedPlan);
    expect(readFileSync(roundPath, "utf8")).toBe(mismatchedRoundText);
    writeFileSync(roundPath, originalRound, "utf8");
    writeFileSync(planPath, originalPlan, "utf8");

    const sourcePath = join(sourceDir, "source-script-draft.json");
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    source.script_text = `${source.script_text} changed after settlement`;
    writeJson(sourcePath, source);
    planGenerator.mockClear();

    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        { ...input, resume: true },
        { requireRealEnv: false, planGenerator },
      ),
    ).rejects.toThrow("asset_planning_quality_check_run_fingerprint_mismatch");
    expect(planGenerator).not.toHaveBeenCalled();
    expect(readFileSync(planPath, "utf8")).toBe(originalPlan);
    expect(readFileSync(roundPath, "utf8")).toBe(originalRound);
  });

  it("rejects provider, model, prompt, runtime revision, and runtime profile drift before overwriting evidence", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-runtime-drift-"));
    const outputDir = mkdtempSync(
      join(tmpdir(), "svf2-asset-planning-runtime-drift-output-"),
    );
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn(
      async ({ sourceStoryboardRecordId, sourceScriptRecordId, sourceTopicPackageId }) =>
        makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        }),
    );
    const input = {
      sourceDirs: [sourceDir],
      outputDir,
      rounds: 1,
      mode: "intent_compiler" as const,
      live: true,
    };
    await runAssetPlanningFiveRoundQualityCheck(input, {
      requireRealEnv: false,
      runtimeFingerprintInputs: injectedRuntimeFingerprintInputs,
      planGenerator,
    });
    const planPath = join(outputDir, "live-check-plan.json");
    const roundPath = join(outputDir, "round-1", "round-result.json");
    const preservedPlan = `${readFileSync(planPath, "utf8")}\n`;
    writeFileSync(planPath, preservedPlan, "utf8");
    const preservedRound = readFileSync(roundPath, "utf8");
    planGenerator.mockClear();

    const drifts = [
      { provider_id: "changed-provider" },
      { model_id: "changed-model" },
      { prompt_bundle_sha256: "3".repeat(64) },
      { runtime_revision_sha256: "4".repeat(64) },
      { runtime_profile_sha256: "5".repeat(64) },
    ];
    for (const drift of drifts) {
      await expect(
        runAssetPlanningFiveRoundQualityCheck(
          { ...input, resume: true },
          {
            requireRealEnv: false,
            runtimeFingerprintInputs: {
              ...injectedRuntimeFingerprintInputs,
              ...drift,
            },
            planGenerator,
          },
        ),
      ).rejects.toThrow("asset_planning_quality_check_run_fingerprint_mismatch");
      expect(readFileSync(planPath, "utf8")).toBe(preservedPlan);
      expect(readFileSync(roundPath, "utf8")).toBe(preservedRound);
    }
    expect(planGenerator).not.toHaveBeenCalled();
  });

  it("rejects a legacy root plan without a fingerprint before overwriting it", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-legacy-plan-"));
    const planPath = join(outputDir, "live-check-plan.json");
    const legacyPlan = JSON.stringify({ generation_mode: "intent_compiler" });
    writeFileSync(planPath, legacyPlan, "utf8");

    await expect(
      runAssetPlanningFiveRoundQualityCheck({
        fixture: "tests/fixtures/asset-planning/long-15-segment-input.json",
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        dryRun: true,
      }),
    ).rejects.toThrow("asset_planning_quality_check_run_fingerprint_missing");
    expect(readFileSync(planPath, "utf8")).toBe(legacyPlan);
  });

  it("rejects a partial non-empty round on resume instead of overwriting it", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-partial-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-partial-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    mkdirSync(join(outputDir, "round-1", "llm-interactions"), { recursive: true });
    writeFileSync(
      join(outputDir, "round-1", "source-script-draft.json"),
      "partial",
      "utf8",
    );
    const resumeInput = {
      sourceDirs: [sourceDir],
      outputDir,
      rounds: 1,
      mode: "intent_compiler" as const,
      resume: true,
      live: true,
    };
    writeJson(
      join(outputDir, "live-check-plan.json"),
      buildAssetPlanningFiveRoundQualityCheckPlan(
        resumeInput,
        injectedRuntimeFingerprintInputs,
      ),
    );
    const planGenerator = vi.fn();

    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        resumeInput,
        {
          requireRealEnv: false,
          runtimeFingerprintInputs: injectedRuntimeFingerprintInputs,
          planGenerator,
        },
      ),
    ).rejects.toThrow("asset_planning_quality_check_partial_round_evidence");
    expect(planGenerator).not.toHaveBeenCalled();
    expect(readFileSync(join(outputDir, "round-1", "source-script-draft.json"), "utf8"))
      .toBe("partial");
  });

  it("restores persisted attempt accounting and rejects legacy evidence without a fingerprint", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-resume-accounting-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-resume-accounting-output-"));
    writeFixedStoryboardSource(sourceDir, 1);
    const planGenerator = vi.fn(
      async ({
        sourceStoryboardRecordId,
        sourceScriptRecordId,
        sourceTopicPackageId,
        onIntentChunkSettled,
        interactionLogWriter,
      }) => {
        writeTestInteraction(interactionLogWriter);
        await onIntentChunkSettled?.({
          type: "intent_chunk_settled",
          chunk_id: "chunk_001",
          chunk_index: 0,
          outcome: "success",
          status: "compiled",
          stage: "compiled",
          accounting: {
            chunk_id: "chunk_001",
            business_slot: 3,
            logical_invocation: 4,
            safety_invocation: 2,
            provider_attempts: 5,
            network_request_count: 5,
          },
          compiler_actions: [],
        });
        return makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        });
      },
    );

    await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        live: true,
      },
      { requireRealEnv: false, planGenerator },
    );
    planGenerator.mockClear();

    const resumed = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs: [sourceDir],
        outputDir,
        rounds: 1,
        mode: "intent_compiler",
        resume: true,
        live: true,
      },
      { requireRealEnv: false, planGenerator },
    );
    expect(planGenerator).not.toHaveBeenCalled();
    expect(resumed).toMatchObject({
      repair_attempts: 1,
      regeneration_attempts: 1,
      safety_attempts: 2,
      provider_attempts: 5,
      accounting_incomplete_rounds: 0,
    });
    expect(resumed.rounds[0]).toMatchObject({
      resumed: true,
      accounting_complete: true,
    });

    const diagnosticsPath = join(outputDir, "round-1", "runtime-diagnostics.json");
    const diagnostics = JSON.parse(readFileSync(diagnosticsPath, "utf8")) as Record<string, unknown>;
    delete diagnostics.attempt_accounting;
    writeJson(diagnosticsPath, diagnostics);
    unlinkSync(join(outputDir, "round-1", "round-result.json"));
    await expect(
      runAssetPlanningFiveRoundQualityCheck(
        {
          sourceDirs: [sourceDir],
          outputDir,
          rounds: 1,
          mode: "intent_compiler",
          resume: true,
          live: true,
        },
        { requireRealEnv: false, planGenerator },
      ),
    ).rejects.toThrow("asset_planning_quality_check_round_fingerprint_missing");
  });

  it("resumes completed rounds without calling the planner again", async () => {
    const sourceDirs = Array.from({ length: 5 }, (_, index) =>
      mkdtempSync(join(tmpdir(), `svf2-asset-planning-resume-source-${index + 1}-`)),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-asset-planning-resume-"));
    sourceDirs.forEach((sourceDir, index) => {
      writeFixedStoryboardSource(sourceDir, index + 1);
    });
    const planGenerator = vi.fn(
      async ({ sourceStoryboardRecordId, sourceScriptRecordId, sourceTopicPackageId }) =>
        makeAssetPlan({
          storyboardRecordId: sourceStoryboardRecordId,
          scriptRecordId: sourceScriptRecordId,
          topicPackageId: sourceTopicPackageId,
        }),
    );

    await runAssetPlanningFiveRoundQualityCheck(
      { sourceDirs, outputDir, mode: "intent_compiler", live: true },
      {
        requireRealEnv: false,
        planGenerator,
      },
    );
    const successMarker = JSON.parse(
      readFileSync(join(outputDir, "round-1", "round-result.json"), "utf8"),
    );
    expect(successMarker).toMatchObject({
      round: 1,
      outcome: "success",
      success: true,
      failure_class: null,
      failure_code: null,
    });
    const artifactContract = buildAssetPlanningFiveRoundQualityCheckPlan({
      sourceDirs,
      mode: "intent_compiler",
      live: true,
    }).required_artifacts;
    expect(successMarker.required_paths).toEqual([
      ...artifactContract.all_settled,
      ...artifactContract.success_only,
    ]);
    planGenerator.mockClear();

    const resumed = await runAssetPlanningFiveRoundQualityCheck(
      {
        sourceDirs,
        outputDir,
        mode: "intent_compiler",
        resume: true,
        live: true,
      },
      {
        requireRealEnv: false,
        planGenerator,
      },
    );

    expect(planGenerator).not.toHaveBeenCalled();
    expect(resumed.passed_rounds).toBe(5);
    expect(resumed.rounds.every((round) => round.resumed === true)).toBe(true);
  });
});
