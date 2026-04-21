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
  const latestProjectScriptRecord = [...db.scriptRecords.values()]
    .filter((record) => record.projectId === project.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .at(0) ?? null;
  const latestScriptTrace =
    (project.latestScriptRunTraceJson as Record<string, unknown> | null | undefined) ??
    (latestProjectScriptRecord?.graphTraceSummaryJson as Record<string, unknown> | null | undefined) ??
    null;

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
  };
}
