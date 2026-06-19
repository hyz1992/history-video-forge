import { statSync } from "node:fs";
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

function statusToStep(status: string): string {
  if (status === "topic_candidates_ready") return "topic";
  if (status.startsWith("topic")) return "topic";
  if (status.startsWith("script")) return "script";
  if (status.startsWith("storyboard")) return "storyboard";
  if (status.startsWith("asset_plan") || status.startsWith("assets")) return "asset";
  if (status.startsWith("compos")) return "compose";
  if (status.startsWith("render")) return "render";
  return "topic";
}

function isDraft(status: string): boolean {
  return status.startsWith("topic") || status === "topic_candidates_ready" || status === "topic_pending";
}

/**
 * Downgrade the project status based on which active records actually exist.
 * A project recovered from disk may have lost its in-memory active records;
 * we must not claim it is at a stage whose data is missing.
 */
export function resolveEffectiveStatus(project: {
  status: string;
  activeTopicPackageId: string | null;
  activeScriptRecordId: string | null;
  activeStoryboardRecordId: string | null;
  activeAssetManifestRecordId: string | null;
  activeComposeRecordId: string | null;
  activeRenderJobRecordId: string | null;
}): string {
  const s = project.status;
  // Walk down from the claimed stage to the highest stage that has data
  if (s.startsWith("render") && !project.activeComposeRecordId) return resolveEffectiveStatus({ ...project, status: "compose_ready" });
  if (s.startsWith("compos") && !project.activeAssetManifestRecordId) return resolveEffectiveStatus({ ...project, status: "assets_ready" });
  if ((s.startsWith("assets") || s.startsWith("asset_plan")) && !project.activeStoryboardRecordId) return resolveEffectiveStatus({ ...project, status: "storyboard_ready" });
  if (s.startsWith("storyboard") && !project.activeScriptRecordId) return resolveEffectiveStatus({ ...project, status: "script_ready" });
  if (s.startsWith("script") && !project.activeTopicPackageId) return "topic_pending";
  return s;
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
  const publishPackageRecord = project.activePublishPackageRecordId
    ? db.publishPackageRecords.get(project.activePublishPackageRecordId) ?? null
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

  const effectiveStatus = resolveEffectiveStatus(project);

  return {
    project_id: project.id,
    name: project.name,
    current_status: effectiveStatus,
    is_draft: isDraft(effectiveStatus),
    restore_route: `/projects/${project.id}/${statusToStep(effectiveStatus)}`,
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
      ? (() => {
          const artifact = renderJobRecord.outputArtifactJson;
          // Fallback: stat the file to fill file_size_bytes if missing (old artifacts)
          if (artifact?.file_uri && !artifact.metadata?.file_size_bytes) {
            try {
              const s = statSync(artifact.file_uri);
              (artifact.metadata as Record<string, unknown> ?? (artifact.metadata = {} as never)).file_size_bytes = s.size;
            } catch { /* keep as-is */ }
          }
          return {
            render_job_record_id: renderJobRecord.id,
            source_compose_record_id: renderJobRecord.composeRecordId,
            source_asset_manifest_record_id: renderJobRecord.assetManifestRecordId,
            status: renderJobRecord.status,
            profile: renderJobRecord.profileJson,
            output_artifact: artifact,
            validation_result: renderJobRecord.validationResultJson,
            execution_state: renderJobRecord.executionStateJson,
            graph_trace_summary: renderJobRecord.graphTraceSummaryJson,
            runtime_diagnostics: renderJobRecord.runtimeDiagnosticsJson,
          };
        })()
      : null,
    active_publish_package: publishPackageRecord
      ? (() => {
          const pkg = publishPackageRecord.packageJson as Record<string, unknown>;
          const isStale =
            publishPackageRecord.renderJobRecordId !==
            project.activeRenderJobRecordId;

          // Evaluate readiness: blocked when upstream source records are missing.
          // Note: isStale is NOT a blocked reason — it's a warning that the
          // render output has changed, but the package is still functional.
          let effectiveReadiness = (pkg.readiness as string) ?? "draft";
          const blockedReasons: string[] = [];
          if (!db.topicPackages.has(publishPackageRecord.topicPackageId)) {
            blockedReasons.push("source_topic_package_missing");
          }
          if (!db.scriptRecords.has(publishPackageRecord.scriptRecordId)) {
            blockedReasons.push("source_script_record_missing");
          }
          if (!db.renderJobRecords.has(publishPackageRecord.renderJobRecordId)) {
            blockedReasons.push("source_render_job_record_missing");
          }
          if (blockedReasons.length > 0 && effectiveReadiness !== "blocked") {
            effectiveReadiness = "blocked";
          }

          // Update the package object in the snapshot with the effective readiness
          const effectivePkg = { ...pkg, readiness: effectiveReadiness };
          if (blockedReasons.length > 0) {
            (effectivePkg as Record<string, unknown>).blocked_reasons = blockedReasons;
          }

          // Resolve cover_artifact summary from asset manifest
          let coverArtifact: Record<string, unknown> | null = null;
          const coverArtifactId = pkg.cover_artifact_id as string | null | undefined;
          if (coverArtifactId) {
            const manifestRecord = db.assetManifestRecords.get(
              publishPackageRecord.assetManifestRecordId,
            );
            if (manifestRecord) {
              const artifacts = (manifestRecord.manifestJson as Record<string, unknown>).artifacts as Array<Record<string, unknown>> | undefined;
              const found = artifacts?.find(
                (a) => a.artifact_id === coverArtifactId,
              );
              if (found) {
                const meta = (found.metadata ?? {}) as Record<string, unknown>;
                coverArtifact = {
                  artifact_id: found.artifact_id,
                  file_uri: found.file_uri,
                  mime_type: meta.mime_type ?? (found as Record<string, unknown>).mime_type ?? "image/png",
                  width: (meta.width ?? null) as number | null,
                  height: (meta.height ?? null) as number | null,
                  metadata: meta,
                };
              }
            }
          }

          return {
            publish_package_record_id: publishPackageRecord.id,
            source_render_job_record_id: publishPackageRecord.renderJobRecordId,
            package: effectivePkg,
            is_stale: isStale,
            stale_reason: isStale ? "render_output_changed" : null,
            cover_artifact: coverArtifact,
            validation_result: publishPackageRecord.validationResultJson,
            execution_state: publishPackageRecord.executionStateJson,
          };
        })()
      : null,
  };
}
