import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AssetPlan } from "../../shared/src/index.js";
import {
  buildAssetPlanningFiveRoundQualityCheckPlan,
  parseAssetPlanningFiveRoundQualityCheckCliArgs,
  runAssetPlanningFiveRoundQualityCheck,
} from "../../harness/scripts/runtime/asset-planning-five-round-quality-check";

const scriptText =
  "Opening pressure. The envoy refuses the trap. The court turns silent after the answer.";

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
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
    });

    expect(plan).toMatchObject({
      mode: "asset_planning_real_runtime_live_check",
      automated_gate: false,
      requires_real_env: true,
      total_rounds: 5,
      output_dir: "asset-planning-output",
    });
    expect(plan.source_storyboard_dirs).toHaveLength(5);
    expect(plan.required_artifacts).toEqual(
      expect.arrayContaining([
        "source-script-draft.json",
        "source-topic-package.json",
        "source-storyboard-plan.json",
        "asset-plan.json",
        "asset-planning-validation-result.json",
        "review.md",
      ]),
    );
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
      { sourceDirs, outputDir },
      {
        requireRealEnv: false,
        planGenerator: async ({
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

  it("accepts positional output directory and explicit source directory", () => {
    expect(
      parseAssetPlanningFiveRoundQualityCheckCliArgs([
        "--source-dir",
        "fixed-storyboard",
        "--chunk-concurrency",
        "4",
        "--resume",
        "asset-planning-output",
      ]),
    ).toEqual({
      sourceDirs: ["fixed-storyboard"],
      chunkConcurrency: 4,
      resume: true,
      outputDir: "asset-planning-output",
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
      { sourceDirs: [sourceDir], outputDir, chunkConcurrency: 4 },
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
      { sourceDirs, outputDir, rounds: 2 },
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
      validation_errors: ["asset_planning_external_error"],
      task_count: 0,
      dependency_count: 0,
    });
    expect(existsSync(join(outputDir, "live-check-summary.json"))).toBe(true);
    expect(existsSync(join(outputDir, "round-2", "runtime-diagnostics.json"))).toBe(
      true,
    );
    expect(readFileSync(join(outputDir, "round-2", "review.md"), "utf8")).toContain(
      "400 contentFilter",
    );
    const diagnostics = JSON.parse(
      readFileSync(join(outputDir, "round-2", "runtime-diagnostics.json"), "utf8"),
    ) as { checks?: Array<{ code: string; level: string }> };
    expect(diagnostics.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "asset_planning_external_error",
          level: "error",
        }),
      ]),
    );
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
      { sourceDirs, outputDir },
      {
        requireRealEnv: false,
        planGenerator,
      },
    );
    planGenerator.mockClear();

    const resumed = await runAssetPlanningFiveRoundQualityCheck(
      { sourceDirs, outputDir, resume: true },
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
