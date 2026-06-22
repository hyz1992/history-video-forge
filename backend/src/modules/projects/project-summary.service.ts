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

export interface ProjectSummary {
  project_id: string;
  display_name: string;
  current_status: string;
  is_draft: boolean;
  updated_at: string;
  restore_route: string;
  scope_label: string | null;
  family_label: string | null;
}

export function listProjectSummaries(db: DbClient): ProjectSummary[] {
  const summaries: ProjectSummary[] = [];

  for (const project of db.projects.values()) {
    const topicRecord = project.activeTopicPackageId
      ? db.topicPackages.get(project.activeTopicPackageId) ?? null
      : null;
    const topicTitle = topicRecord?.title ?? null;
    const effectiveStatus = resolveEffectiveStatus(project);

    summaries.push({
      project_id: project.id,
      display_name: topicTitle ?? project.name,
      current_status: effectiveStatus,
      is_draft: effectiveStatus.startsWith("topic"),
      updated_at: project.updatedAt.toISOString(),
      restore_route: `/projects/${project.id}/${statusToStep(effectiveStatus)}`,
      scope_label: topicRecord?.scopeLabel ?? null,
      family_label: topicRecord?.familyLabel ?? null,
    });
  }

  summaries.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return summaries;
}
