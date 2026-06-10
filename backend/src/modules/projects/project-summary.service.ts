import type { DbClient } from "../../db/client";

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
}

export function listProjectSummaries(db: DbClient): ProjectSummary[] {
  const summaries: ProjectSummary[] = [];

  for (const project of db.projects.values()) {
    const topicTitle =
      project.activeTopicPackageId
        ? db.topicPackages.get(project.activeTopicPackageId)?.title ?? null
        : null;

    summaries.push({
      project_id: project.id,
      display_name: topicTitle ?? project.name,
      current_status: project.status,
      is_draft: project.status.startsWith("topic"),
      updated_at: project.updatedAt.toISOString(),
      restore_route: `/projects/${project.id}/${statusToStep(project.status)}`,
    });
  }

  summaries.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  return summaries;
}
