import { AssetManifest as AssetManifestSchema } from "../../../../shared/src/index.js";
import type { DbClient, ProjectRecord } from "../../db/client";
import { buildComposeTimeline } from "./compose-timeline-builder";
import { validateComposeTimeline } from "./compose-local-validator";
import { saveComposeRecord } from "./compose-record.repository";
import { normalizeAssetManifestDates } from "../assets/manifest-date-normalizer.js";

export interface RunComposeGenerationInput {
  db: DbClient;
  project: ProjectRecord;
}

function createComposeTrace(input: {
  runId: string;
  status: "succeeded" | "partial" | "blocked";
}) {
  const now = new Date().toISOString();
  return {
    phase: "compose",
    run_id: input.runId,
    steps: [
      {
        step_name: "compose-build-timeline",
        phase: "compose",
        status: "succeeded",
        started_at: now,
        ended_at: now,
      },
      {
        step_name: "compose-local-validate",
        phase: "compose",
        status: input.status,
        started_at: now,
        ended_at: now,
      },
    ],
  };
}

export async function runComposeGeneration(input: RunComposeGenerationInput) {
  const { db, project } = input;
  const activeAssetManifestRecordId = project.activeAssetManifestRecordId;

  if (!activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_assets_missing",
      },
    };
  }

  const assetManifestRecord = db.assetManifestRecords.get(
    activeAssetManifestRecordId,
  );
  if (!assetManifestRecord) {
    return {
      statusCode: 409,
      body: {
        error: "active_assets_missing",
      },
    };
  }

  const manifest = AssetManifestSchema.parse(
    normalizeAssetManifestDates(assetManifestRecord.manifestJson as Record<string, unknown>),
  );
  const timeline = buildComposeTimeline({
    assetManifestRecordId: assetManifestRecord.id,
    assetPlanRecordId: assetManifestRecord.assetPlanRecordId,
    storyboardRecordId: assetManifestRecord.storyboardRecordId,
    scriptRecordId: assetManifestRecord.scriptRecordId,
    manifest,
    projectStorageRootDir: project.storageRootDir,
  });
  const localValidation = await validateComposeTimeline({
    manifest,
    timeline,
    projectStorageRootDir: project.storageRootDir,
  });
  const finalizedTimeline = {
    ...timeline,
    readiness: localValidation.decision,
  };
  const trace = createComposeTrace({
    runId: db.generateId(),
    status:
      localValidation.decision === "blocked"
        ? "blocked"
        : localValidation.decision === "partial"
          ? "partial"
          : "succeeded",
  });

  if (project.activeAssetManifestRecordId !== activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "stale_compose_source",
      },
    };
  }

  const composeRecord = await saveComposeRecord(db, {
    projectId: project.id,
    assetManifestRecordId: assetManifestRecord.id,
    timelineJson: finalizedTimeline,
    validationResultJson: localValidation,
    executionStateJson: {
      activated: true,
    },
    graphTraceSummaryJson: trace,
    runtimeDiagnosticsJson: null,
  });

  project.activeComposeRecordId = composeRecord.id;
  project.activeRenderJobRecordId = null;
  project.latestComposeRunTraceJson = trace;
  project.latestRenderRunTraceJson = null;
  project.status =
    localValidation.decision === "blocked" ? "compose_blocked" : "compose_ready";
  project.updatedAt = new Date();

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      compose_record_id: composeRecord.id,
      source_asset_manifest_record_id: assetManifestRecord.id,
      timeline: finalizedTimeline,
      local_validation: localValidation,
      execution_state: composeRecord.executionStateJson,
      graph_trace_summary: trace,
      runtime_diagnostics: composeRecord.runtimeDiagnosticsJson,
    },
  };
}
