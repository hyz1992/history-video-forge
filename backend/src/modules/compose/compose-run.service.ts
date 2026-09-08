import { runNarrationCompose } from "../narration/narration-downstream-run.service.js";
import { currentNarrationSubtitleError } from "../narration/narration-subtitle-revision.service.js";
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
  const subtitleError=await currentNarrationSubtitleError(db,project.id,project.ownerId,project);
  if(subtitleError)return {statusCode:409,body:{error:subtitleError}};
  const activeAssetManifestRecordId = project.activeAssetManifestRecordId;
  const previousActiveComposeRecordId = project.activeComposeRecordId;

  if (!activeAssetManifestRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_assets_missing",
      },
    };
  }

  if(project.narrationTimingMode==="narration_first_v1")return runNarrationCompose(input);
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

  // Save preliminary record BEFORE timeline build so refresh shows generating state
  const generatingRecord = await saveComposeRecord(db, {
    projectId: project.id,
    assetManifestRecordId: assetManifestRecord.id,
    timelineJson: { timeline_version: "compose_timeline_v1", duration_sec: 0, tracks: [], segments: [] },
    validationResultJson: { stage: "compose_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
    executionStateJson: { generating: true, activated: false },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });
  project.status = "compose_generating";
  await db.firstAggregateWriter?.syncProject(project);

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
    // Clean up generating state — delete placeholder record, stale source.
    // Restore status based on the current active asset manifest's actual readiness,
    // not a hardcoded "assets_ready".
    const currentManifest = db.assetManifestRecords.get(project.activeAssetManifestRecordId ?? "");
    const manifestReadiness = (currentManifest?.manifestJson as Record<string, unknown>)?.readiness as string | undefined;
    const assetStatus =
      manifestReadiness === "ready_for_compose" ? "assets_ready" :
      manifestReadiness === "partial" ? "assets_partial" :
      "assets_blocked";
    db.composeRecords.delete(generatingRecord.id);
    project.activeComposeRecordId = previousActiveComposeRecordId;
    project.status = assetStatus;
    project.updatedAt = new Date();
    await db.firstAggregateWriter?.syncProject(project);
    return {
      statusCode: 409,
      body: {
        error: "stale_compose_source",
      },
    };
  }

  const composeRecord = await saveComposeRecord(db, {
    id: generatingRecord.id,
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

  project.latestComposeRunTraceJson = trace;
  project.latestRenderRunTraceJson = null;
  project.status =
    localValidation.decision === "blocked" ? "compose_blocked" : "compose_ready";
  project.updatedAt = new Date();
  try {
    await db.thirdAggregateWriter?.activateCompose(project, composeRecord);
  } catch (error) {
    project.activeComposeRecordId = previousActiveComposeRecordId;
    project.status = previousActiveComposeRecordId ? "compose_ready" : "assets_ready";
    await db.firstAggregateWriter?.syncProject(project);
    throw error;
  }
  project.activeComposeRecordId = composeRecord.id;
  project.activeRenderJobRecordId = null;
  project.activePublishPackageRecordId = null;

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
