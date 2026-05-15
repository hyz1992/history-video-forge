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
    activeAssetPlanRecordId: null,
    latestTopicRunTraceJson: null,
    latestScriptRunTraceJson: null,
    latestStoryboardRunTraceJson: null,
    latestAssetPlanRunTraceJson: null,
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

export async function deleteProject(
  db: DbClient,
  projectId: string,
): Promise<boolean> {
  const existed = db.projects.delete(projectId);
  if (!existed) return false;

  // Clean up related records
  for (const [id, record] of db.topicPackages) {
    if (record.projectId === projectId) db.topicPackages.delete(id);
  }
  for (const [id, record] of db.scriptRecords) {
    if (record.projectId === projectId) db.scriptRecords.delete(id);
  }
  for (const [id, record] of db.storyboardRecords) {
    if (record.projectId === projectId) db.storyboardRecords.delete(id);
  }
  for (const [id, record] of db.assetPlanRecords) {
    if (record.projectId === projectId) db.assetPlanRecords.delete(id);
  }
  db.topicCandidateStore.delete(projectId);

  return true;
}
