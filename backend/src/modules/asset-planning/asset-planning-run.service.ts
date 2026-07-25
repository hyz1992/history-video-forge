import {
  ScriptDraftPackage,
  StoryboardPlan,
  type AssetPlan,
  type AssetPlanningValidationResult,
} from "../../../../shared/src/index.js";
import type {
  DbClient,
  ProjectRecord,
  ScriptRecord,
  StoryboardRecord,
  TopicPackageRecord,
} from "../../db/client";
import {
  createCompositeInteractionLogWriter,
  persistProjectRunArtifacts,
  type TraceLogWriter,
} from "../../runtime/trace/project-storage.js";
import { generateAssetPlan } from "./asset-planning-generation.service";
import { validateAssetPlan } from "./asset-planning-local-validator";
import { repairAssetPlanStructure } from "./asset-planning-structural-repair.service";
import { saveAssetPlanRecord } from "./asset-plan-record.repository";

export interface RunAssetPlanningGenerationInput {
  db: DbClient;
  project: ProjectRecord;
}

function mapScriptDraft(record: ScriptRecord) {
  return ScriptDraftPackage.parse({
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
    family_label: record.familyLabel,
    scope_label: record.scopeLabel,
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
  planStructuralRepairUsed: boolean;
  staleSourceDetected: boolean;
}) {
  const now = new Date().toISOString();
  const steps = [
    "asset-planning-generate",
    "asset-planning-local-audio-skeleton",
    "asset-planning-global-plan",
    "asset-planning-segment-chunk-plan",
    "asset-planning-local-merge",
  ].map((stepName) => ({
    step_name: stepName,
    phase: "asset_planning",
    status: "succeeded",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
  }));

  if (input.regenerated) {
    steps.push({
      step_name: "asset-planning-regenerate",
      phase: "asset_planning",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  if (input.planStructuralRepairUsed) {
    steps.push({
      step_name: "asset-planning-structural-repair",
      phase: "asset_planning",
      status: "succeeded",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  steps.push({
    step_name: "asset-planning-local-validate",
    phase: "asset_planning",
    status: input.validationDecision === "pass" ? "succeeded" : "failed",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
  });

  if (input.staleSourceDetected) {
    steps.push({
      step_name: "asset-planning-source-recheck",
      phase: "asset_planning",
      status: "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  return {
    phase: "asset_planning",
    run_id: input.runId,
    nodes: [
      {
        node_name: "asset-planning-generate",
        input_ref: "active-storyboard:current",
        output_ref: "asset-plan:candidate",
        failure_reason: null,
      },
      {
        node_name: "asset-planning-local-validate",
        input_ref: "asset-plan:candidate",
        output_ref: "asset-planning-local-validation:current",
        failure_reason:
          input.validationDecision === "pass"
            ? null
            : "asset_plan_local_validation_failed",
      },
      {
        node_name: "asset-planning-source-recheck",
        input_ref: "active-storyboard:current",
        output_ref: "asset-plan-activation:current",
        failure_reason: input.staleSourceDetected
          ? "stale_asset_plan_source"
          : null,
      },
    ],
    steps,
  };
}

function buildRuntimeDiagnostics(input: {
  validationDecision: string;
  validationErrors: string[];
  regenerated: boolean;
  planStructuralRepairUsed: boolean;
  staleSourceDetected: boolean;
}) {
  const checks = [
    {
      code:
        input.validationDecision === "pass"
          ? "asset_planning_local_validation_passed"
          : "asset_planning_local_validation_failed",
      level: input.validationDecision === "pass" ? "info" : "error",
    },
    ...input.validationErrors.map((error) => ({
      code: error,
      level: "error",
    })),
  ];

  if (input.regenerated) {
    checks.push({
      code: "asset_planning_regen_once",
      level: "warning",
    });
  }

  if (input.planStructuralRepairUsed) {
    checks.push({
      code: "asset_planning_plan_structural_repair_used",
      level: "warning",
    });
  }

  if (input.staleSourceDetected) {
    checks.push({
      code: "asset_planning_stale_source_detected",
      level: "error",
    });
  }

  return { checks };
}

function isStaleSource(input: {
  db: DbClient;
  projectId: string;
  capturedStoryboardRecordId: string;
  capturedScriptRecordId: string;
}) {
  const currentProject = input.db.projects.get(input.projectId);
  if (!currentProject) {
    return true;
  }
  if (currentProject.activeStoryboardRecordId !== input.capturedStoryboardRecordId) {
    return true;
  }

  const currentStoryboard = input.db.storyboardRecords.get(
    input.capturedStoryboardRecordId,
  );
  return currentStoryboard?.scriptRecordId !== input.capturedScriptRecordId;
}

function buildValidationInput(input: {
  storyboardRecord: StoryboardRecord;
  scriptRecord: ScriptRecord;
  topicPackage: TopicPackageRecord;
  storyboard: StoryboardPlan;
  plan: AssetPlan;
}) {
  return {
    storyboardRecordId: input.storyboardRecord.id,
    scriptRecordId: input.scriptRecord.id,
    topicPackageId: input.topicPackage.id,
    storyboard: input.storyboard,
    scriptText: input.scriptRecord.scriptText,
    plan: input.plan,
  };
}

export async function runAssetPlanningGeneration(
  input: RunAssetPlanningGenerationInput,
) {
  if (!input.project.activeStoryboardRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_storyboard_missing",
      },
    };
  }

  const storyboardRecord = input.db.storyboardRecords.get(
    input.project.activeStoryboardRecordId,
  );
  if (!storyboardRecord) {
    return {
      statusCode: 404,
      body: {
        error: "storyboard_record_not_found",
      },
    };
  }

  const scriptRecord = input.db.scriptRecords.get(storyboardRecord.scriptRecordId);
  const topicPackage = input.db.topicPackages.get(storyboardRecord.topicPackageId);
  if (!scriptRecord || !topicPackage) {
    return {
      statusCode: 404,
      body: {
        error: "source_record_not_found",
      },
    };
  }

  const storyboard = StoryboardPlan.parse(storyboardRecord.planJson);
  const draft = mapScriptDraft(scriptRecord);
  const topicBoundaryContext = mapTopicBoundaryContext(topicPackage);
  const runId = `asset_plan_run_${input.db.generateId()}`;
  const interactionLogWriter = createCompositeInteractionLogWriter({
    project: input.project,
    phase: "asset_planning",
    runId,
  });
  const previousActiveAssetPlanRecordId = input.project.activeAssetPlanRecordId;
  let generatingRecord:
    | Awaited<ReturnType<typeof saveAssetPlanRecord>>
    | undefined;

  try {
    // Save preliminary record BEFORE plan generation so refresh shows generating state
    generatingRecord = await saveAssetPlanRecord(input.db, {
      projectId: input.project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      storyboardRecordId: storyboardRecord.id,
      planJson: { plan_version: "asset_plan_v1" as const, characters: [], locations: [], tasks: [], visual_rules: {}, audio_rules: {} } as unknown as AssetPlan,
      validationResultJson: { stage: "asset_planning_local_validation" as const, decision: "pass" as const, errors: [], warnings: [], metrics: {} } as AssetPlanningValidationResult,
      executionStateJson: { generating: true, run_id: runId, repair_used: false, regenerate_used: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    input.project.status = "asset_plan_generating";
    await input.db.firstAggregateWriter?.syncProject(input.project);

    const onProgress = async (progress: import("./asset-planning-generation.service.js").AssetPlanGenerationProgress) => {
      if (!generatingRecord) return;
      const record = generatingRecord;
      try {
        await saveAssetPlanRecord(input.db, {
          id: record.id,
          projectId: record.projectId,
          topicPackageId: record.topicPackageId,
          scriptRecordId: record.scriptRecordId,
          storyboardRecordId: record.storyboardRecordId,
          planJson: record.planJson,
          validationResultJson: record.validationResultJson,
          executionStateJson: {
            generating: true,
            run_id: runId,
            repair_used: false,
            regenerate_used: false,
            progress_phase: progress.phase,
            progress_completed_chunks: progress.completed_chunks,
            progress_total_chunks: progress.total_chunks,
            progress_total_segments: progress.total_segments,
          },
          graphTraceSummaryJson: record.graphTraceSummaryJson,
          runtimeDiagnosticsJson: record.runtimeDiagnosticsJson,
          createdAt: record.createdAt,
        });
      } catch (progressError) {
        const message = progressError instanceof Error ? progressError.message : String(progressError);
        interactionLogWriter.writeError(`asset_plan_progress_save_failed:${message}`);
      }
    };

    let plan = await generateAssetPlan({
    sourceStoryboardRecordId: storyboardRecord.id,
    sourceScriptRecordId: scriptRecord.id,
    sourceTopicPackageId: topicPackage.id,
    storyboard,
    draft,
    topicBoundaryContext,
    interactionLogWriter,
    onProgress,
  });
  let localValidation = validateAssetPlan(
    buildValidationInput({
      storyboardRecord,
      scriptRecord,
      topicPackage,
      storyboard,
      plan,
    }),
  );
  let regenerated = false;
  let planStructuralRepairUsed = false;

  if (localValidation.decision === "regen_once") {
    const repairResult = await repairAssetPlanStructure({
      plan,
      validation: localValidation,
      storyboard,
      interactionLogWriter,
    });
    plan = repairResult.plan;
    planStructuralRepairUsed = repairResult.repairUsed;
    if (planStructuralRepairUsed) {
      localValidation = validateAssetPlan(
        buildValidationInput({
          storyboardRecord,
          scriptRecord,
          topicPackage,
          storyboard,
          plan,
        }),
      );
    }
  }

  if (localValidation.decision === "regen_once") {
    regenerated = true;
    plan = await generateAssetPlan({
      sourceStoryboardRecordId: storyboardRecord.id,
      sourceScriptRecordId: scriptRecord.id,
      sourceTopicPackageId: topicPackage.id,
      storyboard,
      draft,
      topicBoundaryContext,
      interactionLogWriter,
      regenerationContext: {
        reason: "asset_planning_local_validation_regen_once",
        errors: localValidation.errors,
        metrics: localValidation.metrics,
      },
    });
    localValidation = validateAssetPlan(
      buildValidationInput({
        storyboardRecord,
        scriptRecord,
        topicPackage,
        storyboard,
        plan,
      }),
    );
  }

  let staleSourceDetected = false;
  let graphTraceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    regenerated,
    planStructuralRepairUsed,
    staleSourceDetected,
  });
  let runtimeDiagnostics = buildRuntimeDiagnostics({
    validationDecision: localValidation.decision,
    validationErrors: localValidation.errors,
    regenerated,
    planStructuralRepairUsed,
    staleSourceDetected,
  });
  const executionState = {
    regenerate_used: regenerated,
    plan_structural_repair_used: planStructuralRepairUsed,
  };

  if (localValidation.decision !== "pass") {
    // Clean up generating state — validation failed
    await saveAssetPlanRecord(input.db, {
      id: generatingRecord.id,
      projectId: generatingRecord.projectId,
      topicPackageId: generatingRecord.topicPackageId,
      scriptRecordId: generatingRecord.scriptRecordId,
      storyboardRecordId: generatingRecord.storyboardRecordId,
      planJson: plan,
      validationResultJson: localValidation,
      executionStateJson: {
        ...executionState,
        generating: false,
        run_id: runId,
        error: "asset_plan_local_validation_failed",
      },
      graphTraceSummaryJson: graphTraceSummary,
      runtimeDiagnosticsJson: runtimeDiagnostics,
      createdAt: generatingRecord.createdAt,
    });
    input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
    input.project.status = previousActiveAssetPlanRecordId ? "asset_plan_ready" : "storyboard_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project);
    return {
      statusCode: 422,
      body: {
        error: "asset_plan_local_validation_failed",
        project_id: input.project.id,
        run_mode: "sync_runtime",
        source_storyboard_record_id: storyboardRecord.id,
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

  staleSourceDetected = isStaleSource({
    db: input.db,
    projectId: input.project.id,
    capturedStoryboardRecordId: storyboardRecord.id,
    capturedScriptRecordId: scriptRecord.id,
  });
  if (staleSourceDetected) {
    // Clean up generating state — stale source, delete the placeholder record
    input.db.assetPlanRecords.delete(generatingRecord.id);
    input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
    input.project.status = previousActiveAssetPlanRecordId ? "asset_plan_ready" : "storyboard_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project);
    graphTraceSummary = buildTraceSummary({
      runId,
      validationDecision: localValidation.decision,
      regenerated,
      planStructuralRepairUsed,
      staleSourceDetected,
    });
    runtimeDiagnostics = buildRuntimeDiagnostics({
      validationDecision: localValidation.decision,
      validationErrors: localValidation.errors,
      regenerated,
      planStructuralRepairUsed,
      staleSourceDetected,
    });

    return {
      statusCode: 409,
      body: {
        error: "stale_asset_plan_source",
        project_id: input.project.id,
        run_mode: "sync_runtime",
        source_storyboard_record_id: storyboardRecord.id,
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

  const assetPlanRecord = await saveAssetPlanRecord(input.db, {
    id: generatingRecord.id,
    projectId: input.project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: scriptRecord.id,
    storyboardRecordId: storyboardRecord.id,
    planJson: plan,
    validationResultJson: localValidation,
    executionStateJson: executionState,
    graphTraceSummaryJson: graphTraceSummary,
    runtimeDiagnosticsJson: runtimeDiagnostics,
  });

  input.project.activeAssetPlanRecordId = assetPlanRecord.id;
  input.project.activeAssetManifestRecordId = null;
  input.project.activeComposeRecordId = null;
  input.project.activeRenderJobRecordId = null;
  input.project.latestAssetPlanRunTraceJson =
    graphTraceSummary as unknown as Record<string, unknown>;
  input.project.latestAssetsRunTraceJson = null;
  input.project.latestComposeRunTraceJson = null;
  input.project.latestRenderRunTraceJson = null;
  input.project.status = "asset_plan_ready";
  input.project.updatedAt = new Date();
  await input.db.secondAggregateWriter?.activateAssetPlan(input.project, assetPlanRecord);
  persistProjectRunArtifacts({
    project: input.project,
    phase: "asset_planning",
    runId,
    traceSummary: graphTraceSummary as unknown as Record<string, unknown>,
    runtimeDiagnostics: runtimeDiagnostics as unknown as Record<string, unknown>,
  });

  return {
    statusCode: 200,
    body: {
      project_id: input.project.id,
      run_mode: "sync_runtime",
      asset_plan_record_id: assetPlanRecord.id,
      source_storyboard_record_id: storyboardRecord.id,
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
    if (generatingRecord) {
      await saveAssetPlanRecord(input.db, {
        id: generatingRecord.id,
        projectId: generatingRecord.projectId,
        topicPackageId: generatingRecord.topicPackageId,
        scriptRecordId: generatingRecord.scriptRecordId,
        storyboardRecordId: generatingRecord.storyboardRecordId,
        planJson: generatingRecord.planJson,
        validationResultJson: generatingRecord.validationResultJson,
        executionStateJson: {
          ...(generatingRecord.executionStateJson ?? {}),
          generating: false,
          run_id: runId,
          error: "internal_server_error",
        },
        graphTraceSummaryJson: generatingRecord.graphTraceSummaryJson,
        runtimeDiagnosticsJson: generatingRecord.runtimeDiagnosticsJson,
        createdAt: generatingRecord.createdAt,
      }).catch(() => undefined);
    }
    input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
    input.project.status = previousActiveAssetPlanRecordId ? "asset_plan_ready" : "storyboard_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project).catch(() => undefined);
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
