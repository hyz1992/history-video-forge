import type { ScriptDraftPackage } from "../../../../shared/src/index.js";
import { ScriptDraftPackage as ScriptDraftPackageSchema, StoryboardPlan } from "../../../../shared/src/index.js";
import type { DbClient, ProjectRecord, ScriptRecord, StoryboardRecord, TopicPackageRecord } from "../../db/client";
import { LlmOutputError } from "../../runtime/llm/llm-output-error.js";
import { createCompositeInteractionLogWriter, persistProjectRunArtifacts } from "../../runtime/trace/project-storage.js";
import { generateStoryboardPlan, regenerateSingleSegment } from "./storyboard-generation.service";
import { validateStoryboardPlan } from "./storyboard-local-validator";
import { decodeStoredStoryboardPlan } from "./storyboard-plan-compatibility";
import { saveStoryboardRecord } from "./storyboard-record.repository";

function mapScriptDraft(record: ScriptRecord): ScriptDraftPackage {
  return ScriptDraftPackageSchema.parse({
    script_text: record.scriptText,
    estimated_duration_sec: record.estimatedDurationSec,
    beat_trace: record.beatTraceJson,
    quote_trace: record.quoteTraceJson,
    opening_span: record.openingSpan,
    ending_span: record.endingSpan,
  });
}

function mapTopicBoundaryContext(record: TopicPackageRecord) {
  return {
    title: record.title,
    selected_angle: record.selectedAngle,
    core_conflict: record.coreConflict,
    strong_scene: record.strongScene,
    forbidden_expansions: record.forbiddenExpansionsJson,
    risk_hints: record.riskHintsJson,
    source_anchor_refs: record.sourceAnchorRefsJson,
    canonical_quotes: record.canonicalQuotesJson,
    narrative_tension_map: record.narrativeTensionMapJson,
  };
}

function buildTraceSummary(input: {
  runId: string;
  validationDecision: string;
  regenerated: boolean;
  generateStartedAt: string;
  generateFinishedAt: string;
  validateStartedAt: string;
  validateFinishedAt: string;
  regenStartedAt?: string;
  regenFinishedAt?: string;
}) {
  const steps = [
    {
      step_name: "storyboard-generate",
      phase: "storyboard",
      status: "succeeded",
      started_at: input.generateStartedAt,
      ended_at: input.generateFinishedAt,
      duration_ms: new Date(input.generateFinishedAt).getTime() - new Date(input.generateStartedAt).getTime(),
    },
  ];

  if (input.regenerated && input.regenStartedAt && input.regenFinishedAt) {
    steps.push({
      step_name: "storyboard-regenerate",
      phase: "storyboard",
      status: "succeeded",
      started_at: input.regenStartedAt,
      ended_at: input.regenFinishedAt,
      duration_ms: new Date(input.regenFinishedAt).getTime() - new Date(input.regenStartedAt).getTime(),
    });
  }

  steps.push({
    step_name: "local-validate",
    phase: "storyboard",
    status: input.validationDecision === "pass" ? "succeeded" : "failed",
    started_at: input.validateStartedAt,
    ended_at: input.validateFinishedAt,
    duration_ms: new Date(input.validateFinishedAt).getTime() - new Date(input.validateStartedAt).getTime(),
  });

  return {
    phase: "storyboard",
    run_id: input.runId,
    nodes: [
      {
        node_name: "storyboard-generate",
        input_ref: "active-script:current",
        output_ref: "storyboard-plan:current",
        failure_reason: null,
      },
      {
        node_name: "local-validate",
        input_ref: "storyboard-plan:current",
        output_ref: "storyboard-local-validation:current",
        failure_reason:
          input.validationDecision === "pass"
            ? null
            : "storyboard_local_validation_failed",
      },
    ],
    steps,
  };
}

export interface RunStoryboardGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  userFeedback?: string;
}

export async function runStoryboardGeneration(
  input: RunStoryboardGenerationInput,
) {
  if (!input.project.activeScriptRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_script_record_missing",
      },
    };
  }

  const scriptRecord = input.db.scriptRecords.get(input.project.activeScriptRecordId);
  if (!scriptRecord) {
    return {
      statusCode: 404,
      body: {
        error: "script_record_not_found",
      },
    };
  }

  const topicPackage = input.db.topicPackages.get(scriptRecord.topicPackageId);
  if (!topicPackage) {
    return {
      statusCode: 404,
      body: {
        error: "topic_package_not_found",
      },
    };
  }

  const draft = mapScriptDraft(scriptRecord);
  const topicBoundaryContext = mapTopicBoundaryContext(topicPackage);
  const runId = `storyboard_run_${input.db.generateId()}`;
  const interactionLogWriter = createCompositeInteractionLogWriter({
    project: input.project,
    phase: "storyboard",
    runId,
  });
  const previousActiveStoryboardRecordId = input.project.activeStoryboardRecordId;

  // Declare outside try so catch block can access them for failure-record update
  let generatingRecord: StoryboardRecord | undefined;
  let plan: StoryboardPlan | undefined;
  let localValidation: ReturnType<typeof validateStoryboardPlan> | undefined;
  let regenerated = false;
  let graphTraceSummary: Record<string, unknown> | null = null;
  let runtimeDiagnostics: Record<string, unknown> | null = null;
  let executionState: Record<string, unknown> = {};

  try {
    // Save preliminary record BEFORE plan generation so refresh shows generating state
    generatingRecord = await saveStoryboardRecord(input.db, {
      projectId: input.project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: { plan_version: "storyboard_v1", segments: [] },
      validationResultJson: { stage: "storyboard_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
      executionStateJson: { generating: true, run_id: runId, regenerate_used: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    input.project.status = "storyboard_generating";
    await input.db.firstAggregateWriter?.syncProject(input.project);

    const generateStart = new Date().toISOString();
    plan = await generateStoryboardPlan({
      sourceScriptRecordId: scriptRecord.id,
      sourceTopicPackageId: topicPackage.id,
      draft,
      topicBoundaryContext,
      interactionLogWriter,
    });
    const generateEnd = new Date().toISOString();
    const validateStart = new Date().toISOString();
    localValidation = validateStoryboardPlan({
      draft,
      plan,
    });
    const validateEnd = new Date().toISOString();
    let regenStart: string | undefined;
    let regenEnd: string | undefined;

    if (localValidation.decision === "regen_once") {
    regenerated = true;
    regenStart = new Date().toISOString();
    const regenContext: {
      reason: "storyboard_local_validation_regen_once";
      errors: string[];
      metrics: Record<string, unknown>;
      user_feedback?: string;
    } = {
      reason: "storyboard_local_validation_regen_once",
      errors: localValidation.errors,
      metrics: localValidation.metrics,
    };
    if (input.userFeedback) {
      regenContext.user_feedback = input.userFeedback;
    }
    plan = await generateStoryboardPlan({
      sourceScriptRecordId: scriptRecord.id,
      sourceTopicPackageId: topicPackage.id,
      draft,
      topicBoundaryContext,
      interactionLogWriter,
      regenerationContext: regenContext,
    });
    regenEnd = new Date().toISOString();
    localValidation = validateStoryboardPlan({
      draft,
      plan,
    });
  }

  executionState = {
    regenerate_used: regenerated,
  };
  graphTraceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    regenerated,
    generateStartedAt: generateStart,
    generateFinishedAt: generateEnd,
    validateStartedAt: validateStart,
    validateFinishedAt: validateEnd,
    regenStartedAt: regenStart,
    regenFinishedAt: regenEnd,
  });
  runtimeDiagnostics = {
    checks: [
      {
        code:
          localValidation.decision === "pass"
            ? "storyboard_local_validation_passed"
            : "storyboard_local_validation_failed",
        level: localValidation.decision === "pass" ? "info" : "error",
      },
    ],
  };

  if (localValidation.decision !== "pass") {
    // Update generating record with failure state — no dirty placeholder
    await saveStoryboardRecord(input.db, {
      id: generatingRecord.id,
      projectId: input.project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: plan as Record<string, unknown>,
      validationResultJson: localValidation as Record<string, unknown>,
      executionStateJson: {
        generating: false,
        regenerate_used: regenerated,
        error: "storyboard_local_validation_failed",
        run_id: runId,
      },
      graphTraceSummaryJson: graphTraceSummary as Record<string, unknown>,
      runtimeDiagnosticsJson: runtimeDiagnostics as Record<string, unknown>,
    });

    // Clean up generating state — validation failed
    input.project.activeStoryboardRecordId = previousActiveStoryboardRecordId;
    input.project.status = previousActiveStoryboardRecordId ? "storyboard_ready" : "script_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project);
    return {
      statusCode: 422,
      body: {
        error: "storyboard_local_validation_failed",
        project_id: input.project.id,
        run_mode: "sync_runtime",
        source_script_record_id: scriptRecord.id,
        source_topic_package_id: topicPackage.id,
        plan,
        local_validation: localValidation,
        execution_state: executionState,
        graph_trace_summary: graphTraceSummary,
        runtime_diagnostics: runtimeDiagnostics,
      },
    };
  }

  const storyboardRecord = await saveStoryboardRecord(input.db, {
    id: generatingRecord.id,
    projectId: input.project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    planJson: plan,
    validationResultJson: localValidation,
    executionStateJson: executionState,
    graphTraceSummaryJson: graphTraceSummary,
    runtimeDiagnosticsJson: runtimeDiagnostics,
  });

  input.project.activeStoryboardRecordId = storyboardRecord.id;
  input.project.activeAssetPlanRecordId = null;
  input.project.activeAssetManifestRecordId = null;
  input.project.activeComposeRecordId = null;
  input.project.activeRenderJobRecordId = null;
  input.project.latestStoryboardRunTraceJson = graphTraceSummary;
  input.project.latestAssetPlanRunTraceJson = null;
  input.project.latestAssetsRunTraceJson = null;
  input.project.latestComposeRunTraceJson = null;
  input.project.latestRenderRunTraceJson = null;
  input.project.status = "storyboard_ready";
  input.project.updatedAt = new Date();
  await input.db.secondAggregateWriter?.activateStoryboard(input.project, storyboardRecord);
  persistProjectRunArtifacts({
    project: input.project,
    phase: "storyboard",
    runId,
    traceSummary: graphTraceSummary,
    runtimeDiagnostics,
  });

  return {
    statusCode: 200,
    body: {
      project_id: input.project.id,
      run_mode: "sync_runtime",
      storyboard_record_id: storyboardRecord.id,
      source_script_record_id: scriptRecord.id,
      source_topic_package_id: topicPackage.id,
      plan,
      local_validation: localValidation,
      execution_state: executionState,
      graph_trace_summary: graphTraceSummary,
      runtime_diagnostics: runtimeDiagnostics,
    },
  };
  } catch (error) {
    const errorCode =
      error instanceof LlmOutputError ? error.code : "internal_server_error";

    // Update generating record with failure state — best effort
    if (generatingRecord) {
      try {
        await saveStoryboardRecord(input.db, {
          id: generatingRecord.id,
          projectId: input.project.id,
          topicPackageId: topicPackage.id,
          scriptRecordId: scriptRecord.id,
          planJson: plan ?? { plan_version: "storyboard_v1", segments: [] },
          validationResultJson: localValidation ?? {
            stage: "storyboard_local_validation",
            decision: "error",
            errors: ["internal_server_error"],
            warnings: [],
            metrics: {},
          },
          executionStateJson: {
            generating: false,
            regenerate_used: regenerated,
            error: errorCode,
            run_id: runId,
          },
          graphTraceSummaryJson: graphTraceSummary,
          runtimeDiagnosticsJson: runtimeDiagnostics,
        });
      } catch (cleanupError) {
        // 关键：清理失败时一定要记录，避免静默吞错让记录卡在 generating: true
        const cleanupMsg =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(
          `[storyboard] failed to clear generating state for record ${generatingRecord.id}: ${cleanupMsg}`,
        );
        interactionLogWriter.writeError(
          `storyboard_generating_state_cleanup_failed:${cleanupMsg}`,
        );
      }
    }

    // Clean up generating state — unexpected error
    input.project.activeStoryboardRecordId = previousActiveStoryboardRecordId;
    input.project.status = previousActiveStoryboardRecordId ? "storyboard_ready" : "script_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project).catch(() => undefined);
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    interactionLogWriter.writeError(message);
    if (error instanceof LlmOutputError && error.cause !== undefined) {
      interactionLogWriter.writeError(JSON.stringify(error.cause));
    }
    return {
      statusCode: 500,
      body: {
        error: errorCode,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export interface RunStoryboardSegmentRegenInput {
  db: DbClient;
  project: ProjectRecord;
  segmentId: string;
  userFeedback: string;
}

export async function runStoryboardSegmentRegeneration(
  input: RunStoryboardSegmentRegenInput,
) {
  if (!input.project.activeScriptRecordId) {
    return { statusCode: 409, body: { error: "active_script_record_missing" } };
  }

  if (!input.project.activeStoryboardRecordId) {
    return { statusCode: 400, body: { error: "no_active_storyboard" } };
  }

  const scriptRecord = input.db.scriptRecords.get(input.project.activeScriptRecordId);
  if (!scriptRecord) {
    return { statusCode: 404, body: { error: "script_record_not_found" } };
  }

  const storyboardRecord = input.db.storyboardRecords.get(input.project.activeStoryboardRecordId);
  if (!storyboardRecord) {
    return { statusCode: 404, body: { error: "storyboard_record_not_found" } };
  }

  // P1：旧 StoryboardPlan 必须先经兼容解码器读取（含 visual_strategy_preference 的记录
  // 无法被正式 schema 直接解析，必须走 legacy 路径才能执行局部重生成）。
  const decoded = decodeStoredStoryboardPlan(storyboardRecord.planJson);
  if (!decoded.ok) {
    return { statusCode: 500, body: { error: "storyboard_plan_invalid" } };
  }
  const existingPlan = decoded.value.plan;
  const targetSegment = existingPlan.segments.find(
    (s) => s.segment_id === input.segmentId,
  );
  if (!targetSegment) {
    return { statusCode: 404, body: { error: "segment_not_found" } };
  }

  const draft = mapScriptDraft(scriptRecord);
  const interactionLogWriter = createCompositeInteractionLogWriter({
    project: input.project,
    phase: "storyboard" as const,
    runId: input.db.generateId(),
  } as never);

  try {
    const newSegment = await regenerateSingleSegment({
      plan: existingPlan,
      targetSegmentId: input.segmentId,
      userFeedback: input.userFeedback,
      interactionLogWriter,
    });

    const newPlan = {
      ...existingPlan,
      segments: existingPlan.segments.map((s) =>
        s.segment_id === input.segmentId ? newSegment : s,
      ),
    };

    const localValidation = validateStoryboardPlan({ draft, plan: newPlan });

    const validatedPlan = localValidation.decision === "pass"
      ? StoryboardPlan.parse(newPlan)
      : existingPlan;

    await saveStoryboardRecord(input.db, {
      id: storyboardRecord.id,
      projectId: storyboardRecord.projectId,
      topicPackageId: storyboardRecord.topicPackageId,
      scriptRecordId: storyboardRecord.scriptRecordId,
      planJson: validatedPlan,
      validationResultJson: localValidation,
      executionStateJson: storyboardRecord.executionStateJson as Record<string, unknown> | null,
      graphTraceSummaryJson: storyboardRecord.graphTraceSummaryJson as Record<string, unknown> | null,
      runtimeDiagnosticsJson: storyboardRecord.runtimeDiagnosticsJson as Record<string, unknown> | null,
    });

    return {
      statusCode: localValidation.decision === "pass" ? 200 : 422,
      body: {
        segment_id: input.segmentId,
        plan: validatedPlan,
        local_validation: localValidation,
        regenerated: localValidation.decision === "pass",
      },
    };
  } catch (error) {
    console.error("[storyboard] segment regen failed:", error);
    interactionLogWriter.writeError(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    return {
      statusCode: 500,
      body: { error: "segment_regen_failed", message },
    };
  }
}
