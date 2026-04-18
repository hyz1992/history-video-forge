import type { DbClient, ProjectRecord } from "../../db/client";

export interface CreateProjectInput {
  name: string;
}

export async function createProject(
  db: DbClient,
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  const now = new Date();
  const project: ProjectRecord = {
    id: db.generateId(),
    name: input.name,
    status: "topic_pending",
    activeTopicPackageId: null,
    activeScriptRecordId: null,
    createdAt: now,
    updatedAt: now,
  };

  db.projects.set(project.id, project);

  return project;
}

export async function getProjectById(
  db: DbClient,
  projectId: string,
): Promise<ProjectRecord | null> {
  return db.projects.get(projectId) ?? null;
}
