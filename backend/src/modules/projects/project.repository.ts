import type { DbClient, ProjectRecord } from "../../db/client";
import { initializeProjectStorage } from "../../runtime/trace/project-storage.js";

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
    activeStoryboardRecordId: null,
    latestTopicRunTraceJson: null,
    latestScriptRunTraceJson: null,
    latestStoryboardRunTraceJson: null,
    storageDisplayName: "",
    storageShortId: "",
    storageRootDir: "",
    storageRenameLocked: false,
    createdAt: now,
    updatedAt: now,
  };

  initializeProjectStorage(project);

  db.projects.set(project.id, project);

  return project;
}

export async function getProjectById(
  db: DbClient,
  projectId: string,
): Promise<ProjectRecord | null> {
  return db.projects.get(projectId) ?? null;
}
