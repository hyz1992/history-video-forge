import { NarrationOutput } from "../../../../shared/src/index.js";
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
    narrationTimingMode: row.narrationTimingMode as StoredProjectRecord["narrationTimingMode"],
    activeNarrationRecordId: row.activeNarrationRecordId,
    activeNarrationSubtitleRevisionId: row.activeNarrationSubtitleRevisionId,
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

  async findByIdForOwner(projectId: string, ownerId: string): Promise<StoredProjectRecord | null> {
    const row = await this.client.project.findFirst({
      where: {
        id: projectId,
        ownerId,
      },
    });
    return row ? mapProject(row) : null;
  }

  async findByIdForSystem(projectId: string): Promise<StoredProjectRecord | null> {
    const row = await this.client.project.findUnique({ where: { id: projectId } });
    return row ? mapProject(row) : null;
  }

  async listByOwner(ownerId: string): Promise<StoredProjectRecord[]> {
    return (await this.client.project.findMany({
      where: { ownerId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    })).map(mapProject);
  }

  async updateStatusForOwner(projectId: string, ownerId: string, status: string): Promise<StoredProjectRecord> {
    const result = await this.client.project.updateMany({
      where: { id: projectId, ownerId },
      data: { status },
    });
    if (result.count !== 1) throw new Error("project_scope_denied");
    return mapProject(await this.client.project.findUniqueOrThrow({ where: { id: projectId } }));
  }

  async archiveForOwner(projectId: string, ownerId: string): Promise<StoredProjectRecord> {
    const result = await this.client.project.updateMany({
      where: { id: projectId, ownerId },
      data: { archivedAt: new Date() },
    });
    if (result.count !== 1) throw new Error("project_scope_denied");
    return mapProject(await this.client.project.findUniqueOrThrow({ where: { id: projectId } }));
  }

  async updateActiveRecordsForOwner(projectId: string, ownerId: string, patch: ActiveProjectRecordPatch): Promise<StoredProjectRecord> {
    return this.client.$transaction(async (transaction) => {
      const project = await transaction.project.findFirst({ where: { id: projectId, ownerId, archivedAt: null } });
      if (!project) throw new Error("project_scope_denied");
      // 检查更新后的完整组合，包括仅切口播/仅切字幕/清空口播的反向情况。
      const narrationId = patch.activeNarrationRecordId === undefined ? project.activeNarrationRecordId : patch.activeNarrationRecordId;
      const subtitleId = patch.activeNarrationSubtitleRevisionId === undefined ? project.activeNarrationSubtitleRevisionId : patch.activeNarrationSubtitleRevisionId;
      let narrationOutput: NarrationOutput | null = null;
      if (narrationId) {
        const narration = await transaction.narrationRecord.findUnique({ where: { id: narrationId } });
        if (!narration || narration.projectId !== projectId || !narration.outputJson) throw new Error("project_active_narration_mismatch");
        narrationOutput = NarrationOutput.parse(narration.outputJson);
      }
      if (subtitleId) {
        const subtitle = await transaction.narrationSubtitleRevision.findUnique({ where: { id: subtitleId } });
        if (!subtitle || subtitle.projectId !== projectId || subtitle.narrationRecordId !== narrationId || subtitle.audioHash !== narrationOutput?.audio.sha256 || subtitle.timingHash !== narrationOutput?.timingMap.sha256) throw new Error("project_active_narration_subtitle_mismatch");
      }
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
