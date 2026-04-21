import type { DbClient } from "../../db/client";

export async function getProjectSnapshot(db: DbClient, projectId: string) {
  const project = db.projects.get(projectId);
  if (!project) {
    return null;
  }

  const topicRecord = project.activeTopicPackageId
    ? db.topicPackages.get(project.activeTopicPackageId) ?? null
    : null;
  const scriptRecord = project.activeScriptRecordId
    ? db.scriptRecords.get(project.activeScriptRecordId) ?? null
    : null;

  return {
    project_id: project.id,
    name: project.name,
    current_status: project.status,
    is_draft: project.status.startsWith("topic"),
    restore_route: project.status.startsWith("topic")
      ? `/projects/${project.id}/topic`
      : `/projects/${project.id}/script`,
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
