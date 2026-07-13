import { dirname, join, resolve } from "node:path";

import {
  ComposeTimeline as ComposeTimelineSchema,
  RenderValidationResult as RenderValidationResultSchema,
} from "../../../../shared/src/index.js";
import type { RenderValidationResult } from "../../../../shared/src/index.js";
import type {
  AssetManifestRecord,
  ComposeRecord,
  DbClient,
  ProjectRecord,
  RenderJobRecord,
} from "../../db/client";
import { createFakeRenderAdapter } from "./fake-render-adapter";
import type { RenderAdapter, RenderProfile } from "./render-adapter";
import { saveRenderJobRecord } from "./render-record.repository";
import { validateRenderSources } from "./render-source-validator";
import {
  preserveArtifactAfterRegistrationFailure,
  promoteStagedArtifactFile,
  resolveStagedArtifactFile,
} from "../../runtime/files/artifact-file-commit.js";

export interface RunRenderGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  adapter?: RenderAdapter;
}

function createRenderTrace(input: {
  runId: string;
  status: "succeeded" | "blocked" | "failed" | "stale_source";
}) {
  const now = new Date().toISOString();
  return {
    phase: "render",
    run_id: input.runId,
    status: input.status,
    steps: [
      {
        step_name: "render-source-validate",
        phase: "render",
        status:
          input.status === "blocked" ? "blocked" : "succeeded",
        started_at: now,
        ended_at: now,
      },
      {
        step_name: "render-export",
        phase: "render",
        status:
          input.status === "succeeded"
            ? "succeeded"
            : input.status === "failed"
              ? "failed"
              : input.status,
        started_at: now,
        ended_at: now,
      },
      {
        step_name: "render-activate",
        phase: "render",
        status: input.status,
        started_at: now,
        ended_at: now,
      },
    ],
  };
}

function firstBlockedError(validation: RenderValidationResult): string {
  if (validation.errors.includes("render_active_compose_missing")) {
    return "active_compose_missing";
  }
  if (validation.errors.length > 0) {
    return validation.errors[0]!;
  }

  return "render_blocked";
}

function buildProfile(composeRecord: ComposeRecord): RenderProfile {
  const timelineResult = ComposeTimelineSchema.safeParse(
    composeRecord.timelineJson,
  );
  if (!timelineResult.success) {
    return { width: 1080, height: 1920, fps: 30 };
  }

  return {
    width: timelineResult.data.output_profile.width,
    height: timelineResult.data.output_profile.height,
    fps: timelineResult.data.output_profile.fps,
  };
}

function buildRenderedValidation(input: {
  readyValidation: RenderValidationResult;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}): RenderValidationResult {
  return RenderValidationResultSchema.parse({
    stage: "render_local_validation",
    decision: "rendered",
    errors: [],
    warnings: input.readyValidation.warnings,
    metrics: {
      ...input.readyValidation.metrics,
      duration_sec: input.durationSec,
      width: input.width,
      height: input.height,
      fps: input.fps,
    },
  });
}

function buildFailedValidation(input: {
  readyValidation: RenderValidationResult;
  errorCode: string;
}): RenderValidationResult {
  return RenderValidationResultSchema.parse({
    stage: "render_local_validation",
    decision: "failed",
    errors: [input.errorCode],
    warnings: input.readyValidation.warnings,
    metrics: input.readyValidation.metrics,
  });
}

async function updateRenderJobRecord(
  db: DbClient,
  record: RenderJobRecord,
  updates: Partial<
    Pick<
      RenderJobRecord,
      | "status"
      | "outputArtifactJson"
      | "validationResultJson"
      | "executionStateJson"
      | "graphTraceSummaryJson"
      | "runtimeDiagnosticsJson"
    >
  >,
) {
  Object.assign(record, updates, {
    updatedAt: new Date(),
  });
  const projectOwnerId = db.projects.get(record.projectId)?.ownerId ?? "system";
  await db.thirdAggregateWriter?.saveRender(record, projectOwnerId);
}

function getAssetManifestRecord(
  db: DbClient,
  composeRecord: ComposeRecord,
): AssetManifestRecord | null {
  return db.assetManifestRecords.get(composeRecord.assetManifestRecordId) ?? null;
}

function buildSuccessBody(input: {
  project: ProjectRecord;
  renderJob: RenderJobRecord;
  composeRecord: ComposeRecord;
  assetManifestRecord: AssetManifestRecord;
  validation: RenderValidationResult;
}) {
  return {
    project_id: input.project.id,
    render_job_record_id: input.renderJob.id,
    source_compose_record_id: input.composeRecord.id,
    source_asset_manifest_record_id: input.assetManifestRecord.id,
    render_job: {
      status: input.renderJob.status,
    },
    output_artifact: input.renderJob.outputArtifactJson,
    local_validation: input.validation,
    execution_state: input.renderJob.executionStateJson,
    graph_trace_summary: input.renderJob.graphTraceSummaryJson,
    runtime_diagnostics: input.renderJob.runtimeDiagnosticsJson,
  };
}

export async function runRenderGeneration(input: RunRenderGenerationInput) {
  const { db, project } = input;
  const activeComposeRecordId = project.activeComposeRecordId;
  const previousActiveRenderJobRecordId = project.activeRenderJobRecordId;

  if (!activeComposeRecordId) {
    return {
      statusCode: 409,
      body: {
        error: "active_compose_missing",
      },
    };
  }

  const composeRecord = db.composeRecords.get(activeComposeRecordId) ?? null;
  if (!composeRecord) {
    return {
      statusCode: 409,
      body: {
        error: "active_compose_missing",
      },
    };
  }

  const assetManifestRecord = getAssetManifestRecord(db, composeRecord);
  const readyValidation = await validateRenderSources({
    activeComposeRecordId,
    composeRecord,
    assetManifestRecord,
    projectStorageRootDir: project.storageRootDir,
  });

  if (readyValidation.decision !== "ready_to_render") {
    const trace = createRenderTrace({
      runId: db.generateId(),
      status: "blocked",
    });
    project.status = "render_blocked";
    project.latestRenderRunTraceJson = trace;
    project.updatedAt = new Date();

    return {
      statusCode: 409,
      body: {
        error: firstBlockedError(readyValidation),
        local_validation: readyValidation,
        graph_trace_summary: trace,
      },
    };
  }

  const profile = buildProfile(composeRecord);
  const trace = createRenderTrace({
    runId: db.generateId(),
    status: "succeeded",
  });
  const renderJob = await saveRenderJobRecord(db, {
    projectId: project.id,
    composeRecordId: composeRecord.id,
    assetManifestRecordId: assetManifestRecord!.id,
    status: "rendering",
    profileJson: profile as unknown as Record<string, unknown>,
    outputArtifactJson: null,
    validationResultJson: readyValidation,
    executionStateJson: {
      activated: false,
    },
    graphTraceSummaryJson: trace,
    runtimeDiagnosticsJson: null,
  });

  project.status = "render_rendering";
  project.latestRenderRunTraceJson = trace;
  project.updatedAt = new Date();
  await db.firstAggregateWriter?.syncProject(project);

  const adapter = input.adapter ?? createFakeRenderAdapter();
  const projectStorageRootDir = resolve(project.storageRootDir);
  const stagedOutput = resolveStagedArtifactFile({
    rootDir: projectStorageRootDir,
    operationId: renderJob.id,
    relativeFinalPath: join("renders", renderJob.id, "output.mp4"),
  });
  const outputDir = dirname(stagedOutput.stagingPath);
  let outputPromoted = false;

  try {
    const adapterResult = await adapter.render({
      projectId: project.id,
      composeRecord,
      assetManifestRecord: assetManifestRecord!,
      outputDir,
      profile,
      projectStorageRootDir,
    });
    await promoteStagedArtifactFile(stagedOutput);
    outputPromoted = true;

    if (project.activeComposeRecordId !== activeComposeRecordId) {
      const staleTrace = createRenderTrace({
        runId: String(trace.run_id),
        status: "stale_source",
      });
      const staleValidation = buildFailedValidation({
        readyValidation,
        errorCode: "render_stale_source",
      });
      if (adapterResult.outputArtifact) {
        adapterResult.outputArtifact.file_uri = join(
          "renders",
          renderJob.id,
          "output.mp4",
        );
      }
      await updateRenderJobRecord(db, renderJob, {
        status: "stale_source",
        outputArtifactJson: adapterResult.outputArtifact,
        validationResultJson: staleValidation,
        executionStateJson: {
          activated: false,
          stale_source: true,
        },
        graphTraceSummaryJson: staleTrace,
        runtimeDiagnosticsJson: adapterResult.diagnostics,
      });
      project.latestRenderRunTraceJson = staleTrace;
      project.activeRenderJobRecordId = previousActiveRenderJobRecordId;
      project.status = previousActiveRenderJobRecordId ? "render_ready" : "render_failed";
      project.updatedAt = new Date();
      await db.firstAggregateWriter?.syncProject(project);

      return {
        statusCode: 409,
        body: {
          error: "stale_render_source",
          render_job_record_id: renderJob.id,
          render_job: {
            status: renderJob.status,
          },
          local_validation: staleValidation,
          graph_trace_summary: staleTrace,
          runtime_diagnostics: renderJob.runtimeDiagnosticsJson,
        },
      };
    }

    const renderedValidation = buildRenderedValidation({
      readyValidation,
      durationSec: adapterResult.probe.duration_sec,
      width: adapterResult.probe.width,
      height: adapterResult.probe.height,
      fps: adapterResult.probe.fps,
    });
    if (adapterResult.outputArtifact) {
      adapterResult.outputArtifact.file_uri = join(
        "renders",
        renderJob.id,
        "output.mp4",
      );
    }
    await updateRenderJobRecord(db, renderJob, {
      status: "completed",
      outputArtifactJson: adapterResult.outputArtifact,
      validationResultJson: renderedValidation,
      executionStateJson: {
        activated: true,
      },
      graphTraceSummaryJson: trace,
      runtimeDiagnosticsJson: adapterResult.diagnostics,
    });
    project.status = "render_ready";
    project.latestRenderRunTraceJson = trace;
    project.updatedAt = new Date();
    try {
      await db.thirdAggregateWriter?.activateRender(project, renderJob);
    } catch (error) {
      project.activeRenderJobRecordId = previousActiveRenderJobRecordId;
      project.status = previousActiveRenderJobRecordId ? "render_ready" : "render_failed";
      await db.firstAggregateWriter?.syncProject(project);
      throw error;
    }
    project.activeRenderJobRecordId = renderJob.id;
    project.activePublishPackageRecordId = null;

    return {
      statusCode: 200,
      body: buildSuccessBody({
        project,
        renderJob,
        composeRecord,
        assetManifestRecord: assetManifestRecord!,
        validation: renderedValidation,
      }),
    };
  } catch (error) {
    if (outputPromoted) {
      try {
        await preserveArtifactAfterRegistrationFailure(stagedOutput);
        outputPromoted = false;
      } catch {
        // Keep the original failure as the user-facing cause. The final file
        // remains an unregistered orphan and is never allowed to replace an active record.
      }
    }
    const diagnostics = {
      error_message:
        error instanceof Error ? error.message : "unknown render adapter error",
    };
    const failedTrace = createRenderTrace({
      runId: String(trace.run_id),
      status: "failed",
    });
    const failedValidation = buildFailedValidation({
      readyValidation,
      errorCode: "render_export_failed",
    });
    await updateRenderJobRecord(db, renderJob, {
      status: "failed",
      validationResultJson: failedValidation,
      executionStateJson: {
        activated: false,
      },
      graphTraceSummaryJson: failedTrace,
      runtimeDiagnosticsJson: diagnostics,
    });
    project.activeRenderJobRecordId = previousActiveRenderJobRecordId;
    project.status = previousActiveRenderJobRecordId ? "render_ready" : "render_failed";
    project.latestRenderRunTraceJson = failedTrace;
    project.updatedAt = new Date();
    await db.firstAggregateWriter?.syncProject(project);

    return {
      statusCode: 500,
      body: {
        error: "render_failed",
        render_job_record_id: renderJob.id,
        render_job: {
          status: renderJob.status,
        },
        local_validation: failedValidation,
        graph_trace_summary: failedTrace,
        runtime_diagnostics: diagnostics,
      },
    };
  }
}
