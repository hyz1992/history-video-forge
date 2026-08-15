import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// 替换 generateAssetPlan，让它在 run 内抛 LlmOutputError，
// 验证 run service catch 把 executionState.error 写成 schema_invalid code。
const generateAssetPlanMock = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js", () => ({
  generateAssetPlan: generateAssetPlanMock,
}));

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { runAssetPlanningGeneration } from "../../../backend/src/modules/asset-planning/asset-planning-run.service.js";
import { LegacyChunkResilienceError } from "../../../backend/src/modules/asset-planning/legacy-chunk-resilience.js";
import { AssetPlanCompilerInvariantError } from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";
import type { StoryboardPlan } from "../../../shared/src/index.js";

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function makeStoryboardPlan(input: {
  scriptRecordId: string;
  topicPackageId: string;
}): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    estimated_total_duration_sec: 40,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: "The envoy answers in public.",
        start_hint_sec: 0,
        end_hint_sec: 40,
        narrative_role: "opening",
        visual_intent: "Show the public pressure.",
        scene_description: "A tense public hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "static",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: ["public answer"],
        linked_quotes: [],
        risk_notes: [],
      },
    ],
    global_visual_notes: [],
  };
}

function seedGenerationCatalog(db: ReturnType<typeof createDbClient>) {
  const now = new Date();
  const catalogSeed: Array<[string, string]> = [
    ["llm.smart", "dashscope.qwen-max"],
    ["llm.flash", "dashscope.qwen-flash"],
    ["image.generate", "dashscope.wanx-v1"],
    ["video.image_to_video", "dashscope.video-v1"],
    ["tts.synthesize", "dashscope.tts"],
  ];
  for (const [capability, id] of catalogSeed) {
    db.providerModelCatalog.set(id, {
      id,
      capability: capability as never,
      providerKey: "dashscope",
      modelId: id,
      modelVersion: null,
      displayName: id,
      qualityTier: null,
      speedTier: null,
      parameterCapabilitiesJson: {},
      pricingVersion: "v1",
      pricingJson: { bounded: true },
      status: "active",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function prepareActiveStoryboard(db: ReturnType<typeof createDbClient>) {
  seedGenerationCatalog(db);
  const project = await createProject(db, { name: "Asset Plan Run Error" });
  const topicPackage = await saveTopicPackage(db, {
    projectId: project.id,
    title: "Asset Plan Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "A public pressure scene begins.",
      pressure_escalation: "The insult keeps rising.",
      mid_reveal: "The answer is guarding the state's face.",
      peak_payoff: "The reply reverses the pressure.",
      ending_residue: "Retreat would cost more than silence.",
    },
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptRecord = await saveScriptRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText: "The envoy answers in public.",
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 40,
    beatTraceJson: [
      {
        beat: "public answer",
        excerpt: "The envoy answers in public.",
        confidence: 0.95,
      },
    ],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: {
      stage: "script_local_validation",
      decision: "pass",
    },
    semanticReviewResultJson: {
      stage: "script_semantic_review",
      decision: "pass",
      patch_intent: null,
    },
    executionStateJson: { patch_used: false, regenerate_used: false },
  });
  const storyboardPlan = makeStoryboardPlan({
    scriptRecordId: scriptRecord.id,
    topicPackageId: topicPackage.id,
  });
  const storyboardRecord = await saveStoryboardRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    planJson: storyboardPlan,
    validationResultJson: {
      stage: "storyboard_local_validation",
      decision: "pass",
    },
  });

  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.activeStoryboardRecordId = storyboardRecord.id;
  project.status = "storyboard_ready";

  return { project, topicPackage, scriptRecord, storyboardRecord };
}

describe("runAssetPlanningGeneration error classification", () => {
  it.each([
    ["ordinary", () => new Error("RAW_GLOBAL_SECRET ordinary")],
    ["llm", () => new LlmOutputError("secret_token_123", {
      cause: { message: "RAW_GLOBAL_SECRET cause", value: "secret_token_123" },
    })],
  ])("freezes %s global failures across API, DB, trace, and artifacts", async (_kind, makeFailure) => {
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-global-failure-boundary-"));
    process.env.STORAGE_ROOT_DIR = root;
    try {
      generateAssetPlanMock.mockClear();
      generateAssetPlanMock.mockImplementation(() => { throw makeFailure(); });
      const db = createDbClient();
      const { project } = await prepareActiveStoryboard(db);

      const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({
        error: "internal_server_error",
        repair_used: false,
      });
      expect(response.body).not.toHaveProperty("message");
      const failed = [...db.assetPlanRecords.values()].at(-1)!;
      expect(failed.executionStateJson).toMatchObject({
        generating: false,
        error: "internal_server_error",
      });
      const runId = (failed.executionStateJson as { run_id: string }).run_id;
      const profile = getProjectStorageProfile(project)!;
      const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
      const runtimeArtifact = readFileSync(
        resolve(root, profile.asset_plan_runs_dir, runId, "runtime-diagnostics.json"),
        "utf8",
      );
      const graphArtifact = readFileSync(
        resolve(root, profile.asset_plan_runs_dir, runId, "graph-trace-summary.json"),
        "utf8",
      );
      const serialized = JSON.stringify({
        api: response.body,
        execution: failed.executionStateJson,
        diagnostics: failed.runtimeDiagnosticsJson,
        trace,
        runtimeArtifact,
        graphArtifact,
      });
      expect(serialized).not.toContain("RAW_GLOBAL_SECRET");
      expect(serialized).not.toContain("secret_token_123");
      expect(trace).toContain('{"error_code":"internal_server_error"}');
    } finally {
      if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT_DIR;
      else process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists cloned bounded intent chunk diagnostics on failure and writes a redacted service trace", async () => {
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-intent-settled-failure-"));
    process.env.STORAGE_ROOT_DIR = root;
    const rawSecret = `RAW_INTENT_SETTLED_SECRET_${"x".repeat(200)}`;
    try {
      generateAssetPlanMock.mockClear();
      generateAssetPlanMock.mockImplementation(async (input) => {
        const event = {
          type: "intent_chunk_settled",
          chunk_id: "chunk_001",
          chunk_index: 0,
          outcome: "failure",
          status: "failed",
          stage: "regenerated",
          error_code: "asset_segment_intent_invalid",
          failure_class: "llm_output",
          compiler_actions: [],
          accounting: {
            chunk_id: "chunk_001",
            business_slot: 3,
            logical_invocation: 3,
            safety_invocation: 1,
            provider_attempts: 6,
            network_request_count: 6,
          },
          prompt: rawSecret,
          issues: [{ message: rawSecret, value: rawSecret }],
        };
        await input.onIntentChunkSettled?.(event);
        event.chunk_id = rawSecret;
        throw new LlmOutputError("asset_segment_intent_invalid");
      });
      const db = createDbClient();
      const { project } = await prepareActiveStoryboard(db);

      const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toHaveProperty("message");
      expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
      expect(generateAssetPlanMock).toHaveBeenCalledWith(expect.objectContaining({
        onIntentChunkSettled: expect.any(Function),
      }));
      const failed = [...db.assetPlanRecords.values()].at(-1)!;
      const expectedChunk = expect.objectContaining({
        chunk_id: "chunk_001",
        chunk_index: 0,
        status: "failed",
        stage: "regenerated",
        error_code: "asset_segment_intent_invalid",
        failure_class: "llm_output",
        compiler_actions: [],
        accounting: expect.objectContaining({
          logical_invocation: 3,
          safety_invocation: 1,
          provider_attempts: 6,
          network_request_count: 6,
        }),
      });
      expect(failed.executionStateJson).toMatchObject({
        intent_chunk_diagnostics: { chunk_count: 1, chunks: [expectedChunk] },
      });
      expect(failed.runtimeDiagnosticsJson).toMatchObject({
        intent_chunk_diagnostics: { chunk_count: 1, chunks: [expectedChunk] },
      });
      const persisted = JSON.stringify({
        execution: failed.executionStateJson,
        diagnostics: failed.runtimeDiagnosticsJson,
        api: response.body,
      });
      expect(persisted).not.toContain("RAW_INTENT_SETTLED_SECRET");
      expect(persisted).not.toContain('"issues":');
      const profile = getProjectStorageProfile(project)!;
      const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
      expect(trace).toContain("asset-planning.intent-chunks");
      expect(trace).toContain('"chunk_id": "chunk_001"');
      expect(trace).not.toContain("RAW_INTENT_SETTLED_SECRET");
      expect(trace).not.toContain('"issues":');
    } finally {
      if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT_DIR;
      else process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("drains an in-flight progress save before the final failure cleanup write", async () => {
    generateAssetPlanMock.mockClear();
    const progressSaveStarted = deferred();
    const releaseProgressSave = deferred();
    let progressCallback: Promise<void> | undefined;
    let saveCalls = 0;
    const db = createDbClient();
    db.secondAggregateWriter = {
      async saveAssetPlan() {
        saveCalls += 1;
        if (saveCalls === 2) {
          progressSaveStarted.resolve();
          await releaseProgressSave.promise;
        }
      },
      async saveScript() {},
      async saveStoryboard() {},
      async activateScript() {},
      async activateStoryboard() {},
      async activateAssetPlan() {},
    };
    generateAssetPlanMock.mockImplementation(async (input) => {
      progressCallback = input.onProgress({
        phase: "chunks",
        completed_chunks: 1,
        total_chunks: 2,
        total_segments: 3,
      });
      await progressSaveStarted.promise;
      throw new LlmOutputError("asset_segment_intent_invalid");
    });
    const { project } = await prepareActiveStoryboard(db);

    const run = runAssetPlanningGeneration({ db, project, demoMode: false });
    await progressSaveStarted.promise;
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    releaseProgressSave.resolve();
    const response = await run;
    await progressCallback;

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toHaveProperty("message");
    expect(saveCalls).toBe(3);
    const failed = [...db.assetPlanRecords.values()].at(-1)!;
    expect(failed.executionStateJson).toMatchObject({
      generating: false,
      error: "asset_segment_intent_invalid",
    });
    expect(project.status).toBe("storyboard_ready");
  });

  it("preserves and redacts compiler invariant failures without regeneration", async () => {
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-compiler-failure-"));
    process.env.STORAGE_ROOT_DIR = root;
    const rawSecret = `RAW_SECRET_COMPILER_${"x".repeat(200)}`;
    try {
      generateAssetPlanMock.mockClear();
      generateAssetPlanMock.mockImplementation(() => {
        throw new AssetPlanCompilerInvariantError([
          {
            code: "task_id_collision",
            path: ["tasks", 0, "task_id"],
            segment_id: "sb_001",
            task_id: "secret_token_123",
            chunk_index: 0,
          },
          {
            code: rawSecret,
            path: [rawSecret, -1, Number.NaN],
            segment_id: rawSecret,
            task_id: rawSecret,
            chunk_index: -1,
          },
        ] as never);
      });
      const db = createDbClient();
      const { project } = await prepareActiveStoryboard(db);

      const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

      expect(response.statusCode).toBe(500);
      expect(response.body).toEqual({
        error: "asset_plan_compiler_invariant_failed",
        repair_used: false,
      });
      expect(response.body).not.toHaveProperty("message");
      expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
      const failed = [...db.assetPlanRecords.values()].at(-1)!;
      expect(failed.executionStateJson).toMatchObject({
        generating: false,
        error: "asset_plan_compiler_invariant_failed",
      });
      expect(failed.runtimeDiagnosticsJson).toMatchObject({
        compiler_invariant_failure: {
          issue_count: 2,
          issues_truncated: false,
          issue_codes: ["compiler_invariant_issue", "task_id_collision"],
          issue_paths: ["$unknown.$index.$index", "tasks[0].task_id"],
        },
      });
      const serialized = JSON.stringify({
        response: response.body,
        execution: failed.executionStateJson,
        diagnostics: failed.runtimeDiagnosticsJson,
      });
      expect(serialized).not.toContain("RAW_SECRET_COMPILER");
      expect(serialized).not.toContain("secret_token_123");
      expect(serialized).not.toContain('"issues":');
      const profile = getProjectStorageProfile(project)!;
      const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
      expect(trace).not.toContain("RAW_SECRET_COMPILER");
      expect(trace).not.toContain("secret_token_123");
      expect(trace).not.toContain('"issues":');
      expect(trace).not.toContain("AssetPlanCompilerInvariantError:");
      expect(trace).toContain('"error_code":"asset_plan_compiler_invariant_failed"');
    } finally {
      if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT_DIR;
      else process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks compiler summaries truncated when unique projected paths exceed the cap", async () => {
    generateAssetPlanMock.mockClear();
    generateAssetPlanMock.mockImplementation(() => {
      throw new AssetPlanCompilerInvariantError(
        Array.from({ length: 21 }, (_, index) => ({
          code: "task_id_collision",
          path: ["tasks", index, "task_id"],
          chunk_index: index,
        })) as never,
      );
    });
    const db = createDbClient();
    const { project } = await prepareActiveStoryboard(db);

    const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toHaveProperty("message");
    const failed = [...db.assetPlanRecords.values()].at(-1)!;
    expect(failed.runtimeDiagnosticsJson).toMatchObject({
      compiler_invariant_failure: {
        issue_count: 21,
        issues_truncated: true,
        issue_codes: ["task_id_collision"],
      },
    });
    expect(
      (failed.runtimeDiagnosticsJson as {
        compiler_invariant_failure: { issue_paths: string[] };
      }).compiler_invariant_failure.issue_paths,
    ).toHaveLength(20);
  });

  it("classifies invalid intent as terminal LLM output without full regeneration", async () => {
    generateAssetPlanMock.mockClear();
    generateAssetPlanMock.mockImplementation(() => {
      throw new LlmOutputError("asset_segment_intent_invalid", {
        cause: {
          issues: [{
            code: "unknown_segment",
            path: ["segments", 0, "source_segment_id"],
            segment_id: null,
            expected_kind: null,
          }],
        },
      });
    });
    const db = createDbClient();
    const { project } = await prepareActiveStoryboard(db);
    const previousActiveId = "asset_plan_previous";
    project.activeAssetPlanRecordId = previousActiveId;
    project.status = "asset_plan_ready";

    const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ error: "asset_segment_intent_invalid" });
    expect(response.body).not.toHaveProperty("message");
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
    expect(project.activeAssetPlanRecordId).toBe(previousActiveId);
    expect(project.status).toBe("asset_plan_ready");
    const failed = [...db.assetPlanRecords.values()].at(-1)!;
    expect(failed.executionStateJson).toMatchObject({
      generating: false,
      error: "asset_segment_intent_invalid",
    });
  });

  it("writes asset_plan_schema_invalid to executionState.error when generateAssetPlan throws LlmOutputError", async () => {
    generateAssetPlanMock.mockImplementation(() => {
      throw new LlmOutputError("asset_plan_schema_invalid", {
        cause: [{ path: ["tasks"], message: "Required" }],
      });
    });

    const db = createDbClient();
    const { project } = await prepareActiveStoryboard(db);

    const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: "asset_plan_schema_invalid",
    });
    expect(response.body).not.toHaveProperty("message");

    const failedRecord = [...db.assetPlanRecords.values()].at(-1);
    expect(failedRecord).toBeDefined();
    const executionState = (failedRecord!.executionStateJson ?? {}) as Record<
      string,
      unknown
    >;
    expect(executionState.generating).toBe(false);
    expect(executionState.error).toBe("asset_plan_schema_invalid");
  });

  it("falls back to internal_server_error for non-LlmOutputError exceptions", async () => {
    generateAssetPlanMock.mockImplementation(() => {
      throw new Error("provider network boom");
    });

    const db = createDbClient();
    const { project } = await prepareActiveStoryboard(db);

    const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ error: "internal_server_error" });
    expect(response.body).not.toHaveProperty("message");

    const failedRecord = [...db.assetPlanRecords.values()].at(-1);
    expect(failedRecord).toBeDefined();
    const executionState = (failedRecord!.executionStateJson ?? {}) as Record<
      string,
      unknown
    >;
    expect(executionState.generating).toBe(false);
    expect(executionState.error).toBe("internal_server_error");
  });

  it("persists bounded legacy timing failure diagnostics without regeneration or activation", async () => {
    generateAssetPlanMock.mockClear();
    generateAssetPlanMock.mockImplementation(async (input) => {
      await input.onGlobalStructureEvent?.({
        type: "legacy_audio_timing_canonicalization_failed",
        error_code: "asset_legacy_audio_timing_rebind_ambiguous",
        issues: [
          {
            code: "audio_timing_rebind_ambiguous",
            path: ["dependencies", 7, "depends_on_task_id"],
            tts_task_count: 0,
            dependency_id: "dep-secret",
            before_task_id: "motion-secret",
          },
        ],
      });
      throw new LegacyChunkResilienceError([
        {
          code: "audio_timing_rebind_ambiguous",
          path: ["dependencies", 7, "depends_on_task_id"],
          tts_task_count: 0,
        },
      ]);
    });

    const db = createDbClient();
    const { project } = await prepareActiveStoryboard(db);

    const response = await runAssetPlanningGeneration({ db, project, demoMode: false });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: "asset_legacy_audio_timing_rebind_ambiguous",
      failure_class: "deterministic_resilience",
      issue_count: 1,
      issue_paths: ["dependencies[7].depends_on_task_id"],
    });
    expect(response.body).not.toHaveProperty("message");
    expect(JSON.stringify(response.body)).not.toContain("dep-secret");
    expect(JSON.stringify(response.body)).not.toContain("motion-secret");
    expect(generateAssetPlanMock).toHaveBeenCalledTimes(1);
    expect(project.activeAssetPlanRecordId).toBeNull();
    expect(project.status).toBe("storyboard_ready");

    const failedRecord = [...db.assetPlanRecords.values()].at(-1)!;
    expect(failedRecord.executionStateJson).toMatchObject({
      generating: false,
      error: "asset_legacy_audio_timing_rebind_ambiguous",
      legacy_audio_timing_rebind_failed: true,
      legacy_audio_timing_issue_count: 1,
      legacy_audio_timing_issue_paths: [
        "dependencies[7].depends_on_task_id",
      ],
    });
    expect(JSON.stringify(failedRecord.executionStateJson)).not.toContain(
      "dep-secret",
    );
    expect(failedRecord.runtimeDiagnosticsJson).toMatchObject({
      checks: expect.arrayContaining([
        {
          code: "asset_legacy_audio_timing_rebind_ambiguous",
          level: "error",
        },
      ]),
    });
  });
});
