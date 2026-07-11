import type { AppPrismaClient } from "../prisma-client.types.js";
import type {
  ActiveProjectRecordPatch,
  CreateProjectRecordInput,
  ProjectStore,
  StoredProjectRecord,
} from "./project-store.js";

type PrismaProjectRow = Awaited<ReturnType<AppPrismaClient["project"]["findUniqueOrThrow"]>>;

function mapProject(row: PrismaProjectRow): StoredProjectRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    createdById: row.createdById,
    name: row.name,
    status: row.status,
    storageKey: row.storageKey,
    storageDisplayName: row.storageDisplayName,
    storageRenameLocked: row.storageRenameLocked,
    archivedAt: row.archivedAt,
    activeTopicPackageId: row.activeTopicPackageId,
    activeScriptRecordId: row.activeScriptRecordId,
    activeStoryboardRecordId: row.activeStoryboardRecordId,
    activeAssetPlanRecordId: row.activeAssetPlanRecordId,
    activeAssetManifestRecordId: row.activeAssetManifestRecordId,
    activeComposeRecordId: row.activeComposeRecordId,
    activeRenderJobRecordId: row.activeRenderJobRecordId,
    activePublishPackageRecordId: row.activePublishPackageRecordId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaProjectStore implements ProjectStore {
  constructor(private readonly client: AppPrismaClient) {}

  async create(input: CreateProjectRecordInput): Promise<StoredProjectRecord> {
    return mapProject(await this.client.project.create({
      data: {
        ownerId: input.ownerId,
        createdById: input.createdById,
        name: input.name,
        storageKey: input.storageKey,
        storageDisplayName: input.storageDisplayName,
      },
    }));
  }

  async findAccessibleById(projectId: string, ownerId?: string): Promise<StoredProjectRecord | null> {
    const row = await this.client.project.findFirst({
      where: {
        id: projectId,
        ...(ownerId ? { ownerId } : {}),
      },
    });
    return row ? mapProject(row) : null;
  }

  async listByOwner(ownerId: string): Promise<StoredProjectRecord[]> {
    return (await this.client.project.findMany({
      where: { ownerId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    })).map(mapProject);
  }

  async updateStatus(projectId: string, status: string): Promise<StoredProjectRecord> {
    return mapProject(await this.client.project.update({
      where: { id: projectId },
      data: { status },
    }));
  }

  async updateActiveRecords(projectId: string, patch: ActiveProjectRecordPatch): Promise<StoredProjectRecord> {
    return this.client.$transaction(async (transaction) => {
      const checks: Array<Promise<{ projectId: string } | null>> = [];
      const fields: string[] = [];
      if (patch.activeTopicPackageId) {
        fields.push("activeTopicPackageId");
        checks.push(transaction.topicPackage.findUnique({ where: { id: patch.activeTopicPackageId }, select: { projectId: true } }));
      }
      if (patch.activeScriptRecordId) {
        fields.push("activeScriptRecordId");
        checks.push(transaction.scriptRecord.findUnique({ where: { id: patch.activeScriptRecordId }, select: { projectId: true } }));
      }
      if (patch.activeStoryboardRecordId) {
        fields.push("activeStoryboardRecordId");
        checks.push(transaction.storyboardRecord.findUnique({ where: { id: patch.activeStoryboardRecordId }, select: { projectId: true } }));
      }
      if (patch.activeAssetPlanRecordId) {
        fields.push("activeAssetPlanRecordId");
        checks.push(transaction.assetPlanRecord.findUnique({ where: { id: patch.activeAssetPlanRecordId }, select: { projectId: true } }));
      }
      if (patch.activeAssetManifestRecordId) {
        fields.push("activeAssetManifestRecordId");
        checks.push(transaction.assetManifestRecord.findUnique({ where: { id: patch.activeAssetManifestRecordId }, select: { projectId: true } }));
      }
      if (patch.activeComposeRecordId) {
        fields.push("activeComposeRecordId");
        checks.push(transaction.composeRecord.findUnique({ where: { id: patch.activeComposeRecordId }, select: { projectId: true } }));
      }
      if (patch.activeRenderJobRecordId) {
        fields.push("activeRenderJobRecordId");
        checks.push(transaction.renderJobRecord.findUnique({ where: { id: patch.activeRenderJobRecordId }, select: { projectId: true } }));
      }
      if (patch.activePublishPackageRecordId) {
        fields.push("activePublishPackageRecordId");
        checks.push(transaction.publishPackageRecord.findUnique({ where: { id: patch.activePublishPackageRecordId }, select: { projectId: true } }));
      }
      const records = await Promise.all(checks);
      for (let index = 0; index < records.length; index += 1) {
        if (records[index]?.projectId !== projectId) {
          throw new Error(`project_active_record_mismatch:${fields[index]}`);
        }
      }
      return mapProject(await transaction.project.update({
        where: { id: projectId },
        data: patch,
      }));
    });
  }
}
