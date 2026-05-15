import type {
  DbClient,
  ProjectRecord,
} from "../../db/client";
import {
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";
import type {
  AssetArtifact,
  AssetManifest,
  AssetPlan,
} from "../../../shared/src/index.js";
import { saveAssetManifestRecord } from "./asset-manifest-record.repository";
import { getAssetManifestRecordById } from "./asset-manifest-record.repository";
import { getProjectById } from "../projects/project.repository";
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

// ─── Manual Artifact Registration ───────────────────────────────────────────

export interface RegisterManualArtifactInput {
  db: DbClient;
  project: ProjectRecord;
  taskId: string;
  artifactType: string;
  fileUri: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export async function registerManualArtifact(input: RegisterManualArtifactInput) {
  const { db, project, taskId, artifactType, fileUri, mimeType, metadata } = input;

  // Step 1: Check active manifest exists
  if (!project.activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  // Step 2: Get the active manifest record
  const manifestRecord = await getAssetManifestRecordById(db, project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;

  // Step 3: Find the execution by task_id
  const execution = manifest.executions.find((e) => e.task_id === taskId);
  if (!execution) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 4: Get the asset plan to check MIME type
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (!assetPlanRecord) {
    return {
      statusCode: 404,
      body: { error: "asset_plan_record_not_found" },
    };
  }
  const assetPlan = assetPlanRecord.planJson as unknown as AssetPlan;
  const planTask = assetPlan.tasks.find((t) => t.task_id === taskId);
  if (!planTask) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 5: Validate MIME type
  const allowedTypes = planTask.manual_upload_policy.accepted_file_types;
  if (!allowedTypes.includes(mimeType)) {
    return {
      statusCode: 422,
      body: { error: "asset_manual_upload_type_not_allowed" },
    };
  }

  // Step 6: Create new artifact
  const now = new Date().toISOString();
  const artifactId = `artifact_manual_${db.generateId()}`;

  const newArtifact: AssetArtifact = {
    artifact_id: artifactId,
    artifact_type: artifactType as AssetArtifact["artifact_type"],
    origin: "manual_upload",
    file_uri: fileUri,
    created_at: now,
    metadata: metadata as AssetArtifact["metadata"],
  };

  // Step 7: Add artifact to manifest
  manifest.artifacts.push(newArtifact);

  // Step 8: Add artifact_id to execution output_artifact_ids
  execution.output_artifact_ids.push(artifactId);

  // Step 9: Update execution status to completed and origin to manual_upload
  execution.status = "completed";
  execution.origin = "manual_upload";
  execution.completed_at = now;

  // Step 10: Re-run validator
  const localValidation = validateAssetsManifest({
    assetPlanRecordId: manifestRecord.assetPlanRecordId,
    storyboardRecordId: manifestRecord.storyboardRecordId,
    scriptRecordId: manifestRecord.scriptRecordId,
    topicPackageId: manifestRecord.topicPackageId,
    assetPlan,
    manifest,
  });

  // Step 11: Update manifest readiness
  manifest.readiness = localValidation.decision;

  // Step 12: Save updated manifest record
  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  manifestRecord.validationResultJson = localValidation as unknown as Record<string, unknown>;

  // Step 13: Update project status based on validation decision
  if (localValidation.decision === "ready_for_compose") {
    project.status = "assets_ready";
  } else {
    project.status = "assets_blocked";
  }
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      manifest,
      local_validation: localValidation,
    },
  };
}

// ─── Accept Artifact ────────────────────────────────────────────────────────

export interface AcceptArtifactInput {
  db: DbClient;
  project: ProjectRecord;
  taskId: string;
  artifactId: string;
}

export async function acceptArtifact(input: AcceptArtifactInput) {
  const { db, project, taskId, artifactId } = input;

  // Step 1: Check active manifest exists
  if (!project.activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  // Step 2: Get the active manifest record
  const manifestRecord = await getAssetManifestRecordById(db, project.activeAssetManifestRecordId);
  if (!manifestRecord) {
    return {
      statusCode: 409,
      body: { error: "active_assets_missing" },
    };
  }

  const manifest = manifestRecord.manifestJson as unknown as AssetManifest;

  // Step 3: Find the execution by task_id
  const execution = manifest.executions.find((e) => e.task_id === taskId);
  if (!execution) {
    return {
      statusCode: 404,
      body: { error: "asset_task_not_found" },
    };
  }

  // Step 4: Verify the artifact_id exists in execution output_artifact_ids
  if (!execution.output_artifact_ids.includes(artifactId)) {
    return {
      statusCode: 404,
      body: { error: "artifact_not_found_in_execution" },
    };
  }

  // Step 5: Move the accepted artifact to the front of output_artifact_ids
  // This convention marks it as the "selected" artifact
  execution.output_artifact_ids = [
    artifactId,
    ...execution.output_artifact_ids.filter((id) => id !== artifactId),
  ];

  // Step 6: Update execution status to accepted
  execution.status = "accepted";

  // Step 7: Re-run validator to update readiness
  const assetPlanRecord = db.assetPlanRecords.get(manifestRecord.assetPlanRecordId);
  if (assetPlanRecord) {
    const assetPlan = assetPlanRecord.planJson as unknown as AssetPlan;

    const localValidation = validateAssetsManifest({
      assetPlanRecordId: manifestRecord.assetPlanRecordId,
      storyboardRecordId: manifestRecord.storyboardRecordId,
      scriptRecordId: manifestRecord.scriptRecordId,
      topicPackageId: manifestRecord.topicPackageId,
      assetPlan,
      manifest,
    });

    manifest.readiness = localValidation.decision;
    manifestRecord.validationResultJson = localValidation as unknown as Record<string, unknown>;

    if (localValidation.decision === "ready_for_compose") {
      project.status = "assets_ready";
    } else {
      project.status = "assets_blocked";
    }
  }

  // Step 8: Save updated manifest record
  manifestRecord.manifestJson = manifest as unknown as Record<string, unknown>;
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      asset_manifest_record_id: manifestRecord.id,
      manifest,
    },
  };
}
