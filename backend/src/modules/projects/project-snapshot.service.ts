import type { DbClient } from "../../db/client";
import { getProjectStorageProfile } from "../../runtime/trace/project-storage.js";

function summarizeTraceRun(trace: Record<string, unknown> | null | undefined) {
  if (!trace) {
    return null;
  }

  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const latestStep = steps.at(-1);

  return {
    run_id: typeof trace.run_id === "string" ? trace.run_id : null,
    phase: typeof trace.phase === "string" ? trace.phase : null,
    step_count: steps.length,
    latest_step:
      latestStep && typeof latestStep === "object" && latestStep
        ? ((latestStep as Record<string, unknown>).step_name as string | undefined) ?? null
        : null,
  };
}

export async function getProjectSnapshot(db: DbClient, projectId: string) {
  const project = db.projects.get(projectId);
  if (!project) {
    return null;
  }
  const storageProfile = getProjectStorageProfile(project);

  const topicRecord = project.activeTopicPackageId
    ? db.topicPackages.get(project.activeTopicPackageId) ?? null
    : null;
  const scriptRecord = project.activeScriptRecordId
    ? db.scriptRecords.get(project.activeScriptRecordId) ?? null
    : null;
  const storyboardRecord = project.activeStoryboardRecordId
    ? db.storyboardRecords.get(project.activeStoryboardRecordId) ?? null
    : null;
  const assetPlanRecord = project.activeAssetPlanRecordId
    ? db.assetPlanRecords.get(project.activeAssetPlanRecordId) ?? null
    : null;
  const assetManifestRecord = project.activeAssetManifestRecordId
    ? db.assetManifestRecords.get(project.activeAssetManifestRecordId) ?? null
    : null;
  const composeRecord = project.activeComposeRecordId
    ? db.composeRecords.get(project.activeComposeRecordId) ?? null
    : null;
  const renderJobRecord = project.activeRenderJobRecordId
    ? db.renderJobRecords.get(project.activeRenderJobRecordId) ?? null
    : null;
  const latestProjectScriptRecord = [...db.scriptRecords.values()]
    .filter((record) => record.projectId === project.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .at(0) ?? null;
  const latestScriptTrace =
    (project.latestScriptRunTraceJson as Record<string, unknown> | null | undefined) ??
    (latestProjectScriptRecord?.graphTraceSummaryJson as Record<string, unknown> | null | undefined) ??
    null;
  const latestProjectStoryboardRecord = [...db.storyboardRecords.values()]
    .filter((record) => record.projectId === project.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .at(0) ?? null;
  const latestStoryboardTrace =
    (project.latestStoryboardRunTraceJson as Record<string, unknown> | null | undefined) ??
    (latestProjectStoryboardRecord?.graphTraceSummaryJson as
      | Record<string, unknown>
      | null
      | undefined) ??
    null;
  const latestAssetPlanTrace =
    (project.latestAssetPlanRunTraceJson as Record<string, unknown> | null | undefined) ?? null;
  const latestAssetsTrace =
    (project.latestAssetsRunTraceJson as Record<string, unknown> | null | undefined) ?? null;
  const latestComposeTrace =
    (project.latestComposeRunTraceJson as Record<string, unknown> | null | undefined) ?? null;
  const latestRenderTrace =
    (project.latestRenderRunTraceJson as Record<string, unknown> | null | undefined) ?? null;

  return {
    project_id: project.id,
    name: project.name,
    current_status: project.status,
    is_draft: project.status.startsWith("topic"),
    restore_route: project.status.startsWith("topic")
      ? `/projects/${project.id}/topic`
      : `/projects/${project.id}/script`,
    trace_summary: {
      project_storage: {
        root_dir: storageProfile.root_dir,
      },
      latest_topic_run: summarizeTraceRun(
        project.latestTopicRunTraceJson as Record<string, unknown> | null | undefined,
      ),
      latest_script_run: summarizeTraceRun(latestScriptTrace),
      latest_storyboard_run: summarizeTraceRun(latestStoryboardTrace),
      latest_asset_plan_run: summarizeTraceRun(latestAssetPlanTrace),
      latest_assets_run: summarizeTraceRun(latestAssetsTrace),
      latest_compose_run: summarizeTraceRun(latestComposeTrace),
      latest_render_run: summarizeTraceRun(latestRenderTrace),
    },
    active_topic_package: topicRecord
      ? {
          topic_package_id: topicRecord.id,
          canonical_title: topicRecord.title,
          selected_angle: topicRecord.selectedAngle,
          family_label: topicRecord.familyLabel,
          scope_label: topicRecord.scopeLabel,
          narrative_tension_map: topicRecord.narrativeTensionMapJson,
        }
      : null,
    active_script: scriptRecord
      ? {
          script_record_id: scriptRecord.id,
          script_text: scriptRecord.scriptText,
          opening_span: scriptRecord.openingSpan,
          ending_span: scriptRecord.endingSpan,
          estimated_duration_sec: scriptRecord.estimatedDurationSec,
          review_decision:
            (scriptRecord.semanticReviewResultJson?.decision as string | undefined) ??
            scriptRecord.reviewStatus,
          patch_intent:
            (scriptRecord.semanticReviewResultJson?.patch_intent as
              | string
              | null
              | undefined) ?? null,
          local_validation: scriptRecord.validationResultJson,
          semantic_review: scriptRecord.semanticReviewResultJson,
          execution_state: scriptRecord.executionStateJson ?? {
            patch_used: false,
            regenerate_used: false,
          },
          graph_trace_summary: scriptRecord.graphTraceSummaryJson,
          runtime_diagnostics: scriptRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_storyboard: storyboardRecord
      ? {
          storyboard_record_id: storyboardRecord.id,
          source_script_record_id: storyboardRecord.scriptRecordId,
          plan: storyboardRecord.planJson,
          local_validation: storyboardRecord.validationResultJson,
          execution_state: storyboardRecord.executionStateJson ?? {
            regenerate_used: false,
          },
          graph_trace_summary: storyboardRecord.graphTraceSummaryJson,
          runtime_diagnostics: storyboardRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_asset_plan: assetPlanRecord
      ? {
          asset_plan_record_id: assetPlanRecord.id,
          source_storyboard_record_id: assetPlanRecord.storyboardRecordId,
          source_script_record_id: assetPlanRecord.scriptRecordId,
          source_topic_package_id: assetPlanRecord.topicPackageId,
          plan: assetPlanRecord.planJson,
          local_validation: assetPlanRecord.validationResultJson,
          execution_state: assetPlanRecord.executionStateJson,
          graph_trace_summary: assetPlanRecord.graphTraceSummaryJson,
          runtime_diagnostics: assetPlanRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_assets: assetManifestRecord
      ? {
          asset_manifest_record_id: assetManifestRecord.id,
          source_topic_package_id: assetManifestRecord.topicPackageId,
          source_script_record_id: assetManifestRecord.scriptRecordId,
          source_storyboard_record_id: assetManifestRecord.storyboardRecordId,
          source_asset_plan_record_id: assetManifestRecord.assetPlanRecordId,
          manifest: assetManifestRecord.manifestJson,
          local_validation: assetManifestRecord.validationResultJson,
          execution_state: assetManifestRecord.executionStateJson,
          graph_trace_summary: assetManifestRecord.graphTraceSummaryJson,
          runtime_diagnostics: assetManifestRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_compose: composeRecord
      ? {
          compose_record_id: composeRecord.id,
          source_asset_manifest_record_id: composeRecord.assetManifestRecordId,
          timeline: composeRecord.timelineJson,
          local_validation: composeRecord.validationResultJson,
          execution_state: composeRecord.executionStateJson,
          graph_trace_summary: composeRecord.graphTraceSummaryJson,
          runtime_diagnostics: composeRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_render: renderJobRecord
      ? {
          render_job_record_id: renderJobRecord.id,
          source_compose_record_id: renderJobRecord.composeRecordId,
          source_asset_manifest_record_id: renderJobRecord.assetManifestRecordId,
          status: renderJobRecord.status,
          profile: renderJobRecord.profileJson,
          output_artifact: renderJobRecord.outputArtifactJson,
          validation_result: renderJobRecord.validationResultJson,
          execution_state: renderJobRecord.executionStateJson,
          graph_trace_summary: renderJobRecord.graphTraceSummaryJson,
          runtime_diagnostics: renderJobRecord.runtimeDiagnosticsJson,
        }
      : null,
  };
}
