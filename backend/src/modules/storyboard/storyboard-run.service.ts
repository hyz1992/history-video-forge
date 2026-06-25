import type { ScriptDraftPackage } from "../../../../shared/src/index.js";
import { ScriptDraftPackage as ScriptDraftPackageSchema } from "../../../../shared/src/index.js";
import type { DbClient, ProjectRecord, ScriptRecord, TopicPackageRecord } from "../../db/client";
import { createCompositeInteractionLogWriter, persistProjectRunArtifacts } from "../../runtime/trace/project-storage.js";
import { generateStoryboardPlan } from "./storyboard-generation.service";
import { validateStoryboardPlan } from "./storyboard-local-validator";
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
}) {
  const now = new Date().toISOString();
  const steps = [
    {
      step_name: "storyboard-generate",
      phase: "storyboard",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    },
  ];

  if (input.regenerated) {
    steps.push({
      step_name: "storyboard-regenerate",
      phase: "storyboard",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  steps.push({
    step_name: "local-validate",
    phase: "storyboard",
    status: input.validationDecision === "pass" ? "succeeded" : "failed",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
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

  try {
    // Save preliminary record BEFORE plan generation so refresh shows generating state
    const generatingRecord = await saveStoryboardRecord(input.db, {
      projectId: input.project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: { plan_version: "storyboard_v1", segments: [] },
      validationResultJson: { stage: "storyboard_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
      executionStateJson: { generating: true, run_id: runId, regenerate_used: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    input.project.activeStoryboardRecordId = generatingRecord.id;
    input.project.status = "storyboard_generating";

    let plan = await generateStoryboardPlan({
    sourceScriptRecordId: scriptRecord.id,
    sourceTopicPackageId: topicPackage.id,
    draft,
    topicBoundaryContext,
    interactionLogWriter,
  });
  let localValidation = validateStoryboardPlan({
    draft,
    plan,
  });
  let regenerated = false;

  if (localValidation.decision === "regen_once") {
    regenerated = true;
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
    localValidation = validateStoryboardPlan({
      draft,
      plan,
    });
  }

  const executionState = {
    regenerate_used: regenerated,
  };
  const graphTraceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    regenerated,
  });
  const runtimeDiagnostics = {
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
    // Clean up generating state — validation failed
    input.project.activeStoryboardRecordId = null;
    input.project.status = "script_ready";
    input.project.updatedAt = new Date();
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
    // Clean up generating state — unexpected error
    input.project.activeStoryboardRecordId = null;
    input.project.status = "script_ready";
    input.project.updatedAt = new Date();
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    interactionLogWriter.writeError(message);
    return {
      statusCode: 500,
      body: {
        error: "internal_server_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
