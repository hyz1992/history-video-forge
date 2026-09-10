/**
 * legacy 模式项目测试夹具：复刻口播前置定版（2026-09-10 移除发布开关）前的
 * legacy 创建语义——默认配置原样冻结、不物化口播资格、模式 legacy_estimated。
 * 用于驱动下游阶段（分镜/资产/合成/渲染/发布）的测试：narration-first 模式下
 * 这些阶段被已确认口播门禁，测试需要存量 legacy 项目语义。生产代码不再产生
 * legacy 新项目，此夹具仅测试使用。
 */
import type { DbClient, ProjectGenerationConfigurationRecord, ProjectRecord } from "../../../backend/src/db/client.js";
import { getUserGenerationPreference } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { initializeProjectStorage } from "../../../backend/src/runtime/trace/project-storage.js";
import { saveProjectMetadata } from "../../../backend/src/db/persistence.js";
import { DEFAULT_GENERATION_CONFIGURATION, type GenerationConfigurationV1 } from "../../../shared/src/index.js";

export interface CreateLegacyProjectInput {
  name: string;
  ownerId?: string;
  createdById?: string;
}

export async function createLegacyProject(
  db: DbClient,
  input: CreateLegacyProjectInput,
): Promise<ProjectRecord> {
  const now = new Date();
  const effectiveOwnerId = input.ownerId ?? db.firstAggregateWriter?.ownerId ?? "system";
  const userPref = getUserGenerationPreference(db, effectiveOwnerId);
  const frozenConfig: GenerationConfigurationV1 = userPref?.configuration ?? structuredClone(DEFAULT_GENERATION_CONFIGURATION);
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
    await db.firstAggregateWriter.createProjectWithGenerationConfiguration(project, configRecord, undefined);
  } else if (db.narrationPersistence.prismaClient) {
    // 镜像旧 createProjectController 的 legacy 分支：无 writer 的 Prisma 激活态
    // 仍同步 Project 行（EventLibraryDraft 等外键依赖），配置不落库。
    // owner 用户不存在（纯 Map 用户夹具）时跳过，避免外键失败。
    const prisma = db.narrationPersistence.prismaClient;
    const ownerRow = await prisma.user.findUnique({ where: { id: project.ownerId } });
    if (ownerRow) {
      await prisma.project.upsert({
        where: { id: project.id },
        create: {
          id: project.id,
          ownerId: project.ownerId,
          createdById: project.createdById,
          name: project.name,
          status: project.status,
          storageKey: project.id,
          storageDisplayName: project.storageDisplayName || project.name,
        },
        update: {
          name: project.name,
          status: project.status,
        },
      });
    }
  }
  if (!process.env.VITEST) {
    saveProjectMetadata(project);
  }

  db.projects.set(project.id, project);
  db.projectGenerationConfigurations.set(configRecord.id, configRecord);

  return project;
}
