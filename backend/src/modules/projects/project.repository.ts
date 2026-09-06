import type { DbClient, ProjectGenerationConfigurationRecord, ProjectRecord } from "../../db/client";
import { DEFAULT_GENERATION_CONFIGURATION, type GenerationConfigurationV1 } from "../../../../shared/src/index.js";
import { initializeProjectStorage } from "../../runtime/trace/project-storage.js";
import { deleteProjectStorage, saveProjectMetadata } from "../../db/persistence.js";
import { getUserGenerationPreference } from "../generation-config/generation-config.repository.js";

export interface CreateProjectInput {
  name: string;
  ownerId?: string;
  createdById?: string;
}

export async function createProject(
  db: DbClient,
  input: CreateProjectInput,
): Promise<ProjectRecord> {
  const now = new Date();
  const effectiveOwnerId = input.ownerId ?? db.firstAggregateWriter?.ownerId ?? "system";
  const project: ProjectRecord = {
    id: db.generateId(),
    name: input.name,
    ownerId: effectiveOwnerId,
    createdById: input.createdById ?? effectiveOwnerId,
    status: "topic_pending",
    activeTopicPackageId: null,
    activeScriptRecordId: null,
    activeNarrationRecordId: null,
    activeNarrationSubtitleRevisionId: null,
    narrationTimingMode: "legacy_estimated",
    activeStoryboardRecordId: null,
    activeAssetPlanRecordId: null,
    activeAssetManifestRecordId: null,
    activeComposeRecordId: null,
    activeRenderJobRecordId: null,
    activePublishPackageRecordId: null,
    latestTopicRunTraceJson: null,
    latestScriptRunTraceJson: null,
    latestStoryboardRunTraceJson: null,
    latestAssetPlanRunTraceJson: null,
    latestAssetsRunTraceJson: null,
    latestComposeRunTraceJson: null,
    latestRenderRunTraceJson: null,
    storageDisplayName: "",
    storageShortId: "",
    storageRootDir: "",
    storageRenameLocked: false,
    createdAt: now,
    updatedAt: now,
  };

  initializeProjectStorage(project);

  // S2-2A：创建项目时冻结当时的用户默认配置为 ProjectGenerationConfiguration。
  // Prisma 激活态使用 createProjectWithGenerationConfiguration（同事务，避免半成品）；
  // 内存态在项目写入后立即写入配置 Map。
  const userPref = getUserGenerationPreference(db, effectiveOwnerId);
  const frozenConfig: GenerationConfigurationV1 = userPref
    ? userPref.configuration
    : { ...DEFAULT_GENERATION_CONFIGURATION };
  const configRecord: ProjectGenerationConfigurationRecord = {
    id: db.generateId(),
    projectId: project.id,
    schemaVersion: "generation_configuration_v1",
    revision: 1,
    sourceUserPreferenceRevision: userPref?.revision ?? null,
    configurationJson: frozenConfig,
    createdAt: now,
    updatedAt: now,
  };

  if (db.firstAggregateWriter) {
    // Prisma 激活态：Project 与冻结配置在同一事务创建（任一失败不留半成品）
    await db.firstAggregateWriter.createProjectWithGenerationConfiguration(project, configRecord);
  }
  // 内存态（无 writer）不做持久化调用
  // Never persist to disk under test — avoids polluting storage/projects/
  if (!process.env.VITEST) {
    saveProjectMetadata(project);
  }

  db.projects.set(project.id, project);
  db.projectGenerationConfigurations.set(configRecord.id, configRecord);

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
): Promise<{ deleted: true } | { deleted: false; error: string } | null> {
  const project = db.projects.get(projectId);
  if (!project) return null;
  if (!process.env.VITEST) {
    const storageResult = deleteProjectStorage(project);
    if (!storageResult.ok) return { deleted: false, error: "project_storage_delete_failed" };
  }
  await db.firstAggregateWriter?.archiveProject(projectId);
  db.projects.delete(projectId);

  for (const [id, record] of db.narrationSubtitleRevisions) {
    if (record.projectId === projectId) db.narrationSubtitleRevisions.delete(id);
  }
  for (const [id, record] of db.narrationRecords) {
    if (record.projectId === projectId) db.narrationRecords.delete(id);
  }

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
  for (const [id, record] of db.assetManifestRecords) {
    if (record.projectId === projectId) db.assetManifestRecords.delete(id);
  }
  for (const [id, record] of db.composeRecords) {
    if (record.projectId === projectId) db.composeRecords.delete(id);
  }
  for (const [id, record] of db.renderJobRecords) {
    if (record.projectId === projectId) db.renderJobRecords.delete(id);
  }
  for (const [id, record] of db.publishPackageRecords) {
    if (record.projectId === projectId) db.publishPackageRecords.delete(id);
  }
  db.topicRunCounts.delete(projectId);
  db.recommendationRounds.delete(projectId);
  for (const [id, record] of db.assetProviderJobRecords) {
    if (record.assetManifestRecordId === project.activeAssetManifestRecordId) db.assetProviderJobRecords.delete(id);
  }
  return { deleted: true };
}
