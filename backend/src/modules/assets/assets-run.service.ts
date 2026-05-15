import type {
  DbClient,
  ProjectRecord,
} from "../../db/client";
import {
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";
import { saveAssetManifestRecord } from "./asset-manifest-record.repository";
import { buildInitialAssetManifest } from "./assets-manifest-builder";
import { validateAssetsManifest } from "./assets-local-validator";

export interface RunAssetsGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  voiceProfileId: string;
  executionMode: string;
}

function buildTraceSummary(input: {
  runId: string;
  validationDecision: string;
  staleSourceDetected: boolean;
}) {
  const now = new Date().toISOString();
  const steps = [
    "assets-manifest-build",
    "assets-local-validate",
  ].map((stepName) => ({
    step_name: stepName,
    phase: "assets",
    status: "succeeded",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
  }));

  steps.push({
    step_name: "assets-local-validate",
    phase: "assets",
    status: input.validationDecision === "ready_for_compose" ? "succeeded" : "failed",
    started_at: now,
    ended_at: now,
    duration_ms: 0,
  });

  if (input.staleSourceDetected) {
    steps.push({
      step_name: "assets-source-recheck",
      phase: "assets",
      status: "failed",
      started_at: now,
      ended_at: now,
      duration_ms: 0,
    });
  }

  return {
    phase: "assets",
    run_id: input.runId,
    nodes: [
      {
        node_name: "assets-manifest-build",
        input_ref: "active-asset-plan:current",
        output_ref: "asset-manifest:candidate",
        failure_reason: null,
      },
      {
        node_name: "assets-local-validate",
        input_ref: "asset-manifest:candidate",
        output_ref: "assets-local-validation:current",
        failure_reason:
          input.validationDecision === "ready_for_compose"
            ? null
            : "assets_local_validation_failed",
      },
      {
        node_name: "assets-source-recheck",
        input_ref: "active-asset-plan:current",
        output_ref: "asset-manifest-activation:current",
        failure_reason: input.staleSourceDetected
          ? "stale_assets_source"
          : null,
      },
    ],
    steps,
  };
}

export async function runAssetsGeneration(input: RunAssetsGenerationInput) {
  const { db, project } = input;

  // Step 1: Check project has active asset plan
  if (!project.activeAssetPlanRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_asset_plan_missing",
      },
    };
  }

  const capturedAssetPlanRecordId = project.activeAssetPlanRecordId;

  // Step 2: Get the active asset plan record
  const assetPlanRecord = db.assetPlanRecords.get(capturedAssetPlanRecordId);
  if (!assetPlanRecord) {
    return {
      statusCode: 404,
      body: {
        error: "asset_plan_record_not_found",
      },
    };
  }

  // Step 3: Get storyboard record to extract segment IDs
  const storyboardRecord = db.storyboardRecords.get(
    assetPlanRecord.storyboardRecordId,
  );
  if (!storyboardRecord) {
    return {
      statusCode: 404,
      body: {
        error: "storyboard_record_not_found",
      },
    };
  }

  // Extract segment IDs from storyboard plan
  const storyboardPlan = storyboardRecord.planJson as { segments?: Array<{ segment_id: string }> };
  const segmentIds = storyboardPlan.segments?.map((s) => s.segment_id) ?? [];

  // Step 4: Build execution options from request body
  const executionOptions = {
    execution_mode: input.executionMode,
    voice_profile_id: input.voiceProfileId,
  };

  // Step 5: Build manifest
  const manifest = buildInitialAssetManifest({
    assetPlanRecordId: assetPlanRecord.id,
    assetPlan: assetPlanRecord.planJson,
    segmentIds,
  });

  // Step 6: Validate manifest
  const localValidation = validateAssetsManifest({
    assetPlanRecordId: assetPlanRecord.id,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    topicPackageId: assetPlanRecord.topicPackageId,
    assetPlan: assetPlanRecord.planJson,
    manifest,
  });

  const runId = `assets_run_${db.generateId()}`;

  // Step 7: Stale check — verify activeAssetPlanRecordId hasn't changed
  let staleSourceDetected = false;
  if (project.activeAssetPlanRecordId !== capturedAssetPlanRecordId) {
    staleSourceDetected = true;
  }

  if (staleSourceDetected) {
    const traceSummary = buildTraceSummary({
      runId,
      validationDecision: localValidation.decision,
      staleSourceDetected: true,
    });

    return {
      statusCode: 409,
      body: {
        error: "stale_assets_source",
        project_id: project.id,
        source_asset_plan_record_id: capturedAssetPlanRecordId,
        manifest,
        local_validation: localValidation,
        execution_state: {
          ...executionOptions,
          activated: false,
        },
        graph_trace_summary: traceSummary,
        runtime_diagnostics: null,
      },
    };
  }

  // Step 8: Create and save manifest record
  const executionState = {
    ...executionOptions,
    activated: true,
  };

  const assetManifestRecord = await saveAssetManifestRecord(db, {
    projectId: project.id,
    topicPackageId: assetPlanRecord.topicPackageId,
    scriptRecordId: assetPlanRecord.scriptRecordId,
    storyboardRecordId: assetPlanRecord.storyboardRecordId,
    assetPlanRecordId: assetPlanRecord.id,
    manifestJson: manifest,
    validationResultJson: localValidation,
    executionStateJson: executionState,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });

  // Step 9: Update project state
  project.activeAssetManifestRecordId = assetManifestRecord.id;

  // Step 10: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else {
    // "partial" or "blocked"
    project.status = "assets_blocked";
  }

  const traceSummary = buildTraceSummary({
    runId,
    validationDecision: localValidation.decision,
    staleSourceDetected: false,
  });
  project.latestAssetsRunTraceJson = traceSummary as unknown as Record<string, unknown>;
  project.updatedAt = new Date();

  persistProjectRunArtifacts({
    project,
    phase: "asset_planning",
    runId,
    traceSummary: traceSummary as unknown as Record<string, unknown>,
  });

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: assetManifestRecord.id,
      source_asset_plan_record_id: assetPlanRecord.id,
      manifest,
      local_validation: localValidation,
      execution_state: executionState,
      graph_trace_summary: null,
      runtime_diagnostics: null,
    },
  };
}
