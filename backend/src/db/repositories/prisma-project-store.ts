import type { AppPrismaClient } from "../prisma-client.types.js";
import type {
  CreateProjectRecordInput,
  ProjectStore,
  StoredProjectRecord,
} from "./project-store.js";

type PrismaProjectRow = Awaited<ReturnType<AppPrismaClient["project"]["findUniqueOrThrow"]>>;

function mapProject(row: PrismaProjectRow): StoredProjectRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
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
}
