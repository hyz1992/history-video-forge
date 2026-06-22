import type { DbClient } from "../../db/client";
import { resolveEffectiveStatus } from "./project-snapshot.service.js";

function statusToStep(status: string): string {
  if (status.startsWith("topic")) return "topic";
  if (status.startsWith("script")) return "script";
  if (status.startsWith("storyboard")) return "storyboard";
  if (status.startsWith("asset_plan") || status.startsWith("assets")) return "asset";
  if (status.startsWith("compos")) return "compose";
  if (status.startsWith("render")) return "render";
  return "topic";
}

function readDurationSec(db: DbClient, project: { id: string; activeRenderJobRecordId: string | null; activeComposeRecordId: string | null }): number | null {
  const renderRecord = project.activeRenderJobRecordId
    ? db.renderJobRecords.get(project.activeRenderJobRecordId) ?? null
    : null;
  if (renderRecord?.outputArtifactJson?.duration_sec != null) {
    return renderRecord.outputArtifactJson.duration_sec;
  }

  const composeRecord = project.activeComposeRecordId
    ? db.composeRecords.get(project.activeComposeRecordId) ?? null
    : null;
  const timeline = composeRecord?.timelineJson as { duration_sec?: number } | undefined;
  if (timeline?.duration_sec != null) {
    return timeline.duration_sec;
  }

  return null;
}

function readAspectRatio(db: DbClient, project: { id: string; activeComposeRecordId: string | null }): string | null {
  const composeRecord = project.activeComposeRecordId
    ? db.composeRecords.get(project.activeComposeRecordId) ?? null
    : null;
  const timeline = composeRecord?.timelineJson as { output_profile?: { aspect_ratio?: string } } | undefined;
  return timeline?.output_profile?.aspect_ratio ?? null;
}

export interface ProjectSummary {
  project_id: string;
  display_name: string;
  current_status: string;
  is_draft: boolean;
  updated_at: string;
  restore_route: string;
  scope_label: string | null;
  family_label: string | null;
  duration_sec: number | null;
  aspect_ratio: string | null;
  thumbnail_url: string | null;
}

export function listProjectSummaries(db: DbClient): ProjectSummary[] {
  const summaries: ProjectSummary[] = [];

  for (const project of db.projects.values()) {
    const topicRecord = project.activeTopicPackageId
      ? db.topicPackages.get(project.activeTopicPackageId) ?? null
      : null;
    const topicTitle = topicRecord?.title ?? null;
    const effectiveStatus = resolveEffectiveStatus(project);

    let thumbnailUrl: string | null = null;
    const pkgRecord = project.activePublishPackageRecordId
      ? db.publishPackageRecords.get(project.activePublishPackageRecordId) ?? null
      : null;
    if (pkgRecord) {
      const pkg = pkgRecord.packageJson as { cover_artifact_id?: string } | undefined;
      if (pkg?.cover_artifact_id) {
        thumbnailUrl = `/api/projects/${project.id}/artifacts/${pkg.cover_artifact_id}/file`;
      }
    }

    summaries.push({
      project_id: project.id,
      display_name: topicTitle ?? project.name,
      current_status: effectiveStatus,
      is_draft: effectiveStatus.startsWith("topic"),
      updated_at: project.updatedAt.toISOString(),
      restore_route: `/projects/${project.id}/${statusToStep(effectiveStatus)}`,
      scope_label: topicRecord?.scopeLabel ?? null,
      family_label: topicRecord?.familyLabel ?? null,
      duration_sec: readDurationSec(db, project),
      aspect_ratio: readAspectRatio(db, project),
      thumbnail_url: thumbnailUrl,
    });
  }

  summaries.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return summaries;
}
