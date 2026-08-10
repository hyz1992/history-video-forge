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
import { LlmOutputError } from "../../runtime/llm/llm-output-error.js";
import {
  generateAssetPlan,
  type AssetPlanningResilienceEvent,
} from "./asset-planning-generation.service";
import { LegacyChunkResilienceError } from "./legacy-chunk-resilience.js";
import { validateAssetPlan } from "./asset-planning-local-validator";
import { repairAssetPlanStructure } from "./asset-planning-structural-repair.service";
import { saveAssetPlanRecord } from "./asset-plan-record.repository";

export interface RunAssetPlanningGenerationInput {
  db: DbClient;
  project: ProjectRecord;
}

function writeTraceErrorSafely(writer: TraceLogWriter, message: string) {
  try {
    writer.writeError(message);
  } catch (traceError) {
    const failureMessage =
      traceError instanceof Error ? traceError.message : String(traceError);
    console.warn(
      `[asset-planning] failed to write error diagnostic: ${failureMessage}`,
    );
  }
}

const NOOP_TRACE_LOG_WRITER: TraceLogWriter = {
  write() {},
  writeError() {},
  writeDiagnostic() {},
};

function createTraceLogWriterSafely(input: {
  project: ProjectRecord;
  runId: string;
}): TraceLogWriter {
  try {
    return createCompositeInteractionLogWriter({
      project: input.project,
      phase: "asset_planning",
      runId: input.runId,
    });
  } catch (traceError) {
    const message =
      traceError instanceof Error ? traceError.message : String(traceError);
    console.warn(
      `[asset-planning] failed to initialize trace writer: ${message}`,
    );
    return NOOP_TRACE_LOG_WRITER;
  }
}

function persistRunDiagnosticsSafely(input: {
  project: ProjectRecord;
  runId: string;
  traceSummary: Record<string, unknown>;
  runtimeDiagnostics: Record<string, unknown>;
}) {
  try {
    persistProjectRunArtifacts({
      project: input.project,
      phase: "asset_planning",
      runId: input.runId,
      traceSummary: input.traceSummary,
      runtimeDiagnostics: input.runtimeDiagnostics,
    });
  } catch (traceError) {
    const message =
      traceError instanceof Error ? traceError.message : String(traceError);
    console.warn(
      `[asset-planning] failed to persist run diagnostics: ${message}`,
    );
  }
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
  globalStructure?: ReturnType<typeof aggregateGlobalStructureEvents>;
  globalStructureFailureCode?: string;
  includeLocalValidation?: boolean;
}) {
  const checks = input.includeLocalValidation === false
    ? []
    : [
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

  if (input.globalStructure?.global_structure_normalization_used) {
    checks.push({
      code: "asset_global_structure_normalization_used",
      level: "warning",
    });
  }
  if (input.globalStructure?.global_plan_mode_contamination_normalized) {
    checks.push({
      code: "asset_global_plan_mode_contamination_normalized",
      level: "warning",
    });
  }
  if (input.globalStructure?.global_structural_repair_used) {
    checks.push({
      code: "asset_global_structural_repair_used",
      level: "warning",
    });
  }
  if (input.globalStructureFailureCode) {
    checks.push({
      code: input.globalStructureFailureCode,
      level: "error",
    });
  }
  if (input.globalStructure?.legacy_chunk_patch_coercion_used) {
    checks.push({
      code: "asset_legacy_chunk_patch_coerced",
      level: "warning",
    });
  }
  if (input.globalStructure?.legacy_chunk_patch_coercion_failed) {
    checks.push({
      code: "asset_legacy_chunk_patch_coercion_failed",
      level: "error",
    });
  }
  if (input.globalStructure?.legacy_audio_timing_rebind_used) {
    checks.push({
      code: "asset_legacy_audio_timing_rebound",
      level: "warning",
    });
  }
  if (input.globalStructure?.legacy_audio_timing_rebind_failed) {
    checks.push({
      code: "asset_legacy_audio_timing_rebind_ambiguous",
      level: "error",
    });
  }

  return {
    checks: checks.filter(
      (check, index, all) =>
        all.findIndex((candidate) => candidate.code === check.code) === index,
    ),
  };
}

function aggregateGlobalStructureEvents(events: AssetPlanningResilienceEvent[]) {
  const normalizationActions = events.flatMap((event) =>
    event.type === "normalization_applied" ? event.actions : [],
  );
  const normalizedPaths = [
    ...new Set(
      normalizationActions
        .filter((action) => action.type === "default_inserted")
        .map((action) => action.path),
    ),
  ].sort();
  const chunkPatchActions = events.flatMap((event) =>
    event.type === "legacy_chunk_patch_coerced" ? event.actions : [],
  );
  const chunkPatchIssues = events.flatMap((event) =>
    event.type === "legacy_chunk_patch_coercion_failed" ? event.issues : [],
  );
  const chunkPatchIssuePaths = [
    ...new Set(chunkPatchIssues.map((issue) => formatIssuePath(issue.path))),
  ].sort();
  const timingActions = events.flatMap((event) =>
    event.type === "legacy_audio_timing_canonicalized" ? event.actions : [],
  );
  const timingIssues = events.flatMap((event) =>
    event.type === "legacy_audio_timing_canonicalization_failed"
      ? event.issues
      : [],
  );
  const timingIssuePaths = [
    ...new Set(timingIssues.map((issue) => formatIssuePath(issue.path))),
  ].sort();
  return {
    global_structure_normalization_used: normalizationActions.length > 0,
    global_structure_normalized_paths: normalizedPaths.slice(0, 50),
    global_structure_normalized_path_count: normalizedPaths.length,
    global_structure_paths_truncated: normalizedPaths.length > 50,
    global_plan_mode_contamination_normalized: normalizationActions.some(
      (action) => action.type === "forbidden_chunk_key_removed",
    ),
    global_structural_repair_used: events.some(
      (event) => event.type === "repair_started",
    ),
    legacy_chunk_patch_coercion_used: chunkPatchActions.length > 0,
    legacy_chunk_patch_action_types: [
      ...new Set(chunkPatchActions.map((action) => action.type)),
    ].sort(),
    legacy_chunk_patch_action_count: chunkPatchActions.length,
    legacy_chunk_patch_coercion_failed: chunkPatchIssues.length > 0,
    legacy_chunk_patch_issue_paths: chunkPatchIssuePaths.slice(0, 20),
    legacy_chunk_patch_issue_count: chunkPatchIssues.length,
    legacy_chunk_patch_issues_truncated: chunkPatchIssuePaths.length > 20,
    legacy_audio_timing_rebind_used: timingActions.some(
      (action) => action.type === "audio_timing_rebound",
    ),
    legacy_audio_timing_rebind_count: timingActions.filter(
      (action) => action.type === "audio_timing_rebound",
    ).length,
    legacy_audio_timing_rebind_failed: timingIssues.length > 0,
    legacy_audio_timing_issue_paths: timingIssuePaths.slice(0, 20),
    legacy_audio_timing_issue_count: timingIssues.length,
    legacy_audio_timing_issues_truncated: timingIssuePaths.length > 20,
  };
}

function formatIssuePath(path: Array<string | number>) {
  if (path.length === 0) return "<root>";
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    return formatted ? `${formatted}.${segment}` : segment;
  }, "");
}

function extractIssuePaths(error: unknown) {
  if (!(error instanceof LlmOutputError) || error.cause === undefined) return [];
  const cause = error.cause as Record<string, unknown>;
  const collections = [
    cause.initial_issues,
    cause.patch_issues,
    cause.final_issues,
  ];
  const paths = collections.flatMap((collection) =>
    Array.isArray(collection)
      ? collection.flatMap((issue) => {
          if (typeof issue !== "object" || issue === null) return [];
          const path = (issue as Record<string, unknown>).path;
          if (!Array.isArray(path)) return [];
          if (
            !path.every(
              (part) => typeof part === "string" || typeof part === "number",
            )
          ) return [];
          return [formatIssuePath(path as Array<string | number>)];
        })
      : [],
  );
  return [...new Set(paths)].sort().slice(0, 20);
}

function buildResilienceFailureTracePayload(input: {
  errorCode: string;
  globalStructure: ReturnType<typeof aggregateGlobalStructureEvents>;
}): Record<string, unknown> | undefined {
  const isResilienceFailure =
    input.globalStructure.legacy_chunk_patch_coercion_failed ||
    input.globalStructure.legacy_audio_timing_rebind_failed;
  if (!isResilienceFailure) return undefined;

  const issuePaths = [
    ...new Set([
      ...input.globalStructure.legacy_chunk_patch_issue_paths,
      ...input.globalStructure.legacy_audio_timing_issue_paths,
    ]),
  ].sort();
  const issueCount =
    input.globalStructure.legacy_chunk_patch_issue_count +
    input.globalStructure.legacy_audio_timing_issue_count;

  return {
    error_code: input.errorCode,
    failure_class: "deterministic_resilience",
    issue_count: issueCount,
    issue_paths: issuePaths.slice(0, 20),
    issues_truncated:
      input.globalStructure.legacy_chunk_patch_issues_truncated ||
      input.globalStructure.legacy_audio_timing_issues_truncated ||
      issuePaths.length > 20,
  };
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
  const interactionLogWriter = createTraceLogWriterSafely({
    project: input.project,
    runId,
  });
  const previousActiveAssetPlanRecordId = input.project.activeAssetPlanRecordId;
  const globalStructureEvents: AssetPlanningResilienceEvent[] = [];
  const onGlobalStructureEvent = async (event: AssetPlanningResilienceEvent) => {
    globalStructureEvents.push(event);
    try {
      interactionLogWriter.writeDiagnostic(
        event.type.startsWith("legacy_")
          ? "asset-planning.resilience"
          : "asset-planning.global-structure",
        event,
      );
    } catch (traceError) {
      const message =
        traceError instanceof Error ? traceError.message : String(traceError);
      console.warn(
        `[asset-planning] failed to write global structure diagnostic: ${message}`,
      );
    }
  };
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
        writeTraceErrorSafely(
          interactionLogWriter,
          `asset_plan_progress_save_failed:${message}`,
        );
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
    onGlobalStructureEvent,
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
      onGlobalStructureEvent,
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
    globalStructure: aggregateGlobalStructureEvents(globalStructureEvents),
  });
  const executionState = {
    regenerate_used: regenerated,
    plan_structural_repair_used: planStructuralRepairUsed,
    ...aggregateGlobalStructureEvents(globalStructureEvents),
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
      globalStructure: aggregateGlobalStructureEvents(globalStructureEvents),
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
  persistRunDiagnosticsSafely({
    project: input.project,
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
    const errorCode =
      error instanceof LlmOutputError ||
      error instanceof LegacyChunkResilienceError
        ? error.code
        : "internal_server_error";
    const globalStructure = aggregateGlobalStructureEvents(globalStructureEvents);
    const globalStructureFailureCode = globalStructureEvents.some(
      (event) => event.type === "repair_provider_failed",
    )
      ? "asset_global_structural_repair_provider_failed"
      : globalStructureEvents.some((event) => event.type === "repair_failed") ||
          errorCode === "asset_global_plan_structural_repair_failed"
        ? "asset_global_structural_repair_failed"
        : undefined;
    const failureDiagnostics = buildRuntimeDiagnostics({
      validationDecision: "pass",
      validationErrors: [],
      regenerated: false,
      planStructuralRepairUsed: false,
      staleSourceDetected: false,
      globalStructure,
      globalStructureFailureCode,
      includeLocalValidation: false,
    });
    const failureExecutionState = {
      ...globalStructure,
      generating: false,
      run_id: runId,
      error: errorCode,
    };

    // Clean up generating state — unexpected error
    if (generatingRecord) {
      const cleanupRecordId = generatingRecord.id;
      await saveAssetPlanRecord(input.db, {
        id: generatingRecord.id,
        projectId: generatingRecord.projectId,
        topicPackageId: generatingRecord.topicPackageId,
        scriptRecordId: generatingRecord.scriptRecordId,
        storyboardRecordId: generatingRecord.storyboardRecordId,
        planJson: generatingRecord.planJson,
        validationResultJson: generatingRecord.validationResultJson,
        executionStateJson: {
          ...failureExecutionState,
        },
        graphTraceSummaryJson: generatingRecord.graphTraceSummaryJson,
        runtimeDiagnosticsJson: failureDiagnostics,
        createdAt: generatingRecord.createdAt,
      }).catch((cleanupError) => {
        // 关键：清理失败时一定要记录，避免静默吞错让记录卡在 generating: true
        const cleanupMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(
          `[asset-planning] failed to clear generating state for record ${cleanupRecordId}: ${cleanupMsg}`,
        );
        writeTraceErrorSafely(
          interactionLogWriter,
          `asset_plan_generating_state_cleanup_failed:${cleanupMsg}`,
        );
      });
    }
    input.project.activeAssetPlanRecordId = previousActiveAssetPlanRecordId;
    input.project.status = previousActiveAssetPlanRecordId ? "asset_plan_ready" : "storyboard_ready";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project).catch(() => undefined);
    const resilienceFailureTracePayload = buildResilienceFailureTracePayload({
      errorCode,
      globalStructure,
    });
    if (resilienceFailureTracePayload) {
      writeTraceErrorSafely(
        interactionLogWriter,
        JSON.stringify(resilienceFailureTracePayload, null, 2),
      );
    } else {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      writeTraceErrorSafely(interactionLogWriter, message);
      if (error instanceof LlmOutputError && error.cause !== undefined) {
        writeTraceErrorSafely(
          interactionLogWriter,
          JSON.stringify(error.cause),
        );
      }
    }
    return {
      statusCode: 500,
      body: {
        error: errorCode,
        message: error instanceof Error ? error.message : String(error),
        repair_used: globalStructure.global_structural_repair_used,
        ...(errorCode === "asset_global_plan_structural_repair_failed"
          ? { issue_paths: extractIssuePaths(error) }
          : {}),
        ...(error instanceof LegacyChunkResilienceError
          ? {
              failure_class: "deterministic_resilience",
              issue_count: error.issues.length,
              issue_paths: [
                ...new Set(
                  error.issues.map((issue) => formatIssuePath(issue.path)),
                ),
              ]
                .sort()
                .slice(0, 20),
            }
          : {}),
      },
    };
  }
}
