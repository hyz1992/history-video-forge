import type {
  CandidateCacheRecord,
  EventRegistryRecord,
  ProjectGenerationConfigurationRecord,
  ProjectRecord,
  ProjectRecommendationRoundRecord,
  ProviderModelCatalogRecord,
  TopicPackageRecord,
  UserGenerationPreferenceRecord,
} from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";
import { PrismaRecommendationStore } from "./prisma-recommendation-store.js";

export class PrismaFirstAggregateWriter {
  private constructor(private readonly client: AppPrismaClient, readonly ownerId: string) {}

  get narrationPrismaClient(): AppPrismaClient { return this.client; }

  static async create(client: AppPrismaClient, ownerId: string): Promise<PrismaFirstAggregateWriter> {
    const owner = await client.user.findUnique({ where: { id: ownerId } });
    if (!owner || owner.status !== "ACTIVE") throw new Error("local_project_owner_not_active");
    return new PrismaFirstAggregateWriter(client, ownerId);
  }

  async createProject(record: ProjectRecord): Promise<void> {
    await this.client.project.create({ data: {
      id: record.id, ownerId: record.ownerId, createdById: record.createdById, name: record.name, status: record.status,
      narrationTimingMode: record.narrationTimingMode ?? "legacy_estimated",
      activeNarrationRecordId: record.activeNarrationRecordId ?? null, activeNarrationSubtitleRevisionId: record.activeNarrationSubtitleRevisionId ?? null,
      storageKey: record.id, storageDisplayName: record.storageDisplayName, storageRenameLocked: record.storageRenameLocked,
    } });
  }

  async syncProject(record: ProjectRecord): Promise<void> {
    const result = await this.client.project.updateMany({ where: { id: record.id, ownerId: record.ownerId }, data: {
      name: record.name, status: record.status, storageDisplayName: record.storageDisplayName,
      storageRenameLocked: record.storageRenameLocked, latestTopicRunTraceJson: record.latestTopicRunTraceJson as never,
    } });
    if (result.count !== 1) throw new Error("project_scope_denied");
  }

  async archiveProject(projectId: string): Promise<void> {
    await this.client.project.updateMany({ where: { id: projectId }, data: { archivedAt: new Date() } });
  }

  async saveEvent(record: EventRegistryRecord): Promise<void> {
    const data = { canonicalName: record.canonicalName, aliasesJson: record.aliases,
      canonicalQuotesJson: record.canonicalQuotesJson, canonicalQuoteIntentsJson: record.canonicalQuoteIntentsJson,
      sourceType: record.sourceType, isProvisional: record.isProvisional };
    await this.client.eventRegistryEntry.upsert({ where: { id: record.id }, create: { id: record.id, ...data, createdAt: record.createdAt }, update: data });
  }

  async saveCandidate(record: CandidateCacheRecord): Promise<void> {
    if (!record.projectId) throw new Error("candidate_project_required");
    await this.client.recommendationCandidateCache.upsert({
      where: { projectId_fingerprint: { projectId: record.projectId, fingerprint: record.fingerprint } },
      create: { ...record, viralRubricJson: record.viralRubricJson as never, estimatedDurationBandJson: record.estimatedDurationBandJson as never, mustCoverPreviewJson: record.mustCoverPreviewJson as never, riskHintsJson: record.riskHintsJson as never }, update: {
        eventRegistryEntryId: record.eventRegistryEntryId, eventIdentity: record.eventIdentity,
        filterFingerprint: record.filterFingerprint ?? null,
        oneLineAngle: record.oneLineAngle, familyLabel: record.familyLabel, scopeLabel: record.scopeLabel,
        viralRubricJson: record.viralRubricJson as never, estimatedDurationBandJson: record.estimatedDurationBandJson as never,
        strongScene: record.strongScene, coreConflict: record.coreConflict, mustCoverPreviewJson: record.mustCoverPreviewJson as never,
        sourceHint: record.sourceHint, recentUsageHint: record.recentUsageHint, whyThisNow: record.whyThisNow,
        riskHintsJson: record.riskHintsJson as never,
      },
    });
  }

  async recordRecommendationRound(record: ProjectRecommendationRoundRecord, projectOwnerId: string): Promise<void> {
    await new PrismaRecommendationStore(this.client).recordRound({
      projectId: record.projectId, ownerId: projectOwnerId,
      filterFingerprint: record.filterFingerprint,
      filterJson: record.filterJson,
      candidates: record.candidates.map((candidate) => ({
        eventRegistryEntryId: candidate.eventRegistryEntryId || null, eventIdentity: candidate.eventIdentity,
        title: candidate.title, fingerprint: candidate.fingerprint,
      })),
    });
  }

  async activateTopic(project: ProjectRecord, topic: TopicPackageRecord): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      const scoped = await transaction.project.findFirst({ where: { id: project.id, ownerId: project.ownerId }, select: { id: true } });
      if (!scoped) throw new Error("project_scope_denied");
      await transaction.topicPackage.create({ data: {
        ...topic, canonicalQuotesJson: topic.canonicalQuotesJson as never, canonicalQuoteIntentsJson: topic.canonicalQuoteIntentsJson as never,
        durationBandJson: topic.durationBandJson as never, narrativeTensionMapJson: topic.narrativeTensionMapJson as never,
        mustIncludeBeatsJson: topic.mustIncludeBeatsJson as never, forbiddenExpansionsJson: topic.forbiddenExpansionsJson as never,
        riskHintsJson: topic.riskHintsJson as never, sourceAnchorRefsJson: topic.sourceAnchorRefsJson as never,
        ambiguityNotesJson: topic.ambiguityNotesJson as never, sourceRefJson: topic.sourceRefJson as never,
      } });
      await transaction.project.update({ where: { id: project.id }, data: {
        name: project.name, status: project.status, storageDisplayName: project.storageDisplayName,
        storageRenameLocked: project.storageRenameLocked, activeTopicPackageId: topic.id, activeScriptRecordId: null,
      } });
    });
  }

  // --- S2-2A 生成配置与费用治理 ---

  async saveUserGenerationPreference(record: UserGenerationPreferenceRecord): Promise<void> {
    const data = {
      userId: record.userId,
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      configurationJson: record.configurationJson as never,
    };
    await this.client.userGenerationPreference.upsert({
      where: { userId: record.userId },
      create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt },
      update: { ...data, updatedAt: record.updatedAt },
    });
  }

  async saveProjectGenerationConfiguration(record: ProjectGenerationConfigurationRecord): Promise<void> {
    const data = {
      projectId: record.projectId,
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      sourceUserPreferenceRevision: record.sourceUserPreferenceRevision,
      configurationJson: record.configurationJson as never,
    };
    await this.client.projectGenerationConfiguration.upsert({
      where: { projectId: record.projectId },
      create: { id: record.id, ...data, createdAt: record.createdAt, updatedAt: record.updatedAt },
      update: { ...data, updatedAt: record.updatedAt },
    });
  }

  async saveProviderModelCatalogEntry(record: ProviderModelCatalogRecord): Promise<void> {
    await this.client.providerModelCatalog.upsert(
      this.buildProviderModelCatalogUpsert(record),
    );
  }

  /**
   * 目录 seed 批量应用（S2-2A 任务 7 重开，codex P3）：单事务按序 upsert，
   * 任一失败整体回滚，不留半应用状态（避免启动中段失败时 capability 暂无默认项）。
   */
  async applyProviderModelCatalogSeedBatch(records: ProviderModelCatalogRecord[]): Promise<void> {
    await this.client.$transaction(
      records.map((record) =>
        this.client.providerModelCatalog.upsert(this.buildProviderModelCatalogUpsert(record)),
      ),
    );
  }

  private buildProviderModelCatalogUpsert(record: ProviderModelCatalogRecord) {
    const data = {
      capability: record.capability,
      providerKey: record.providerKey,
      modelId: record.modelId,
      modelVersion: record.modelVersion,
      displayName: record.displayName,
      qualityTier: record.qualityTier,
      speedTier: record.speedTier,
      parameterCapabilitiesJson: record.parameterCapabilitiesJson as never,
      pricingVersion: record.pricingVersion,
      pricingJson: record.pricingJson as never,
      status: record.status,
      isDefault: record.isDefault,
      updatedAt: record.updatedAt,
    };
    return {
      where: { id: record.id },
      create: { id: record.id, ...data, createdAt: record.createdAt },
      update: data,
    };
  }

  /**
   * 在同一事务创建 Project 与冻结的 ProjectGenerationConfiguration。
   * 任一写入失败都不留下半成品 Project（详细设计 4.2 节）。
   * 不允许先调用 createProject 提交后再补配置。
   */
  async createProjectWithGenerationConfiguration(
    project: ProjectRecord,
    configuration: ProjectGenerationConfigurationRecord,
  ): Promise<void> {
    // P1-3：冻结配置必须绑定到被创建的项目本身；configuration.projectId 不等于
    // project.id 时直接拒绝（防止创建无配置的新项目或把配置写到另一个项目）。
    if (configuration.projectId !== project.id) {
      throw new Error("project_configuration_project_mismatch: configuration must bind to the project being created");
    }
    await this.client.$transaction(async (transaction) => {
      const scoped = await transaction.project.findFirst({
        where: { id: project.id, ownerId: project.ownerId },
        select: { id: true },
      });
      if (scoped) throw new Error("project_already_exists");
      await transaction.project.create({ data: {
        id: project.id, ownerId: project.ownerId, createdById: project.createdById, name: project.name, status: project.status,
        narrationTimingMode: project.narrationTimingMode ?? "legacy_estimated",
        activeNarrationRecordId: project.activeNarrationRecordId ?? null, activeNarrationSubtitleRevisionId: project.activeNarrationSubtitleRevisionId ?? null,
        storageKey: project.id, storageDisplayName: project.storageDisplayName, storageRenameLocked: project.storageRenameLocked,
      } });
      await transaction.projectGenerationConfiguration.create({ data: {
        // 固定用 project.id 写入，不再信任 configuration.projectId。
        id: configuration.id, projectId: project.id, schemaVersion: configuration.schemaVersion,
        revision: configuration.revision, sourceUserPreferenceRevision: configuration.sourceUserPreferenceRevision,
        configurationJson: configuration.configurationJson as never,
        createdAt: configuration.createdAt, updatedAt: configuration.updatedAt,
      } });
    });
  }

  /**
   * S2-2C（复审整改 P2）：DB 权威只读查询——跨实例内存缺失时 repository
   * 以数据库为权威读取用户偏好（缺省保留语义与 revision 检查不依赖内存）。
   */
  async getUserGenerationPreference(userId: string): Promise<UserGenerationPreferenceRecord | null> {
    const row = await this.client.userGenerationPreference.findUnique({
      where: { userId },
    });
    return row ? mapUserPreferenceRow(row) : null;
  }

  /**
   * CAS 更新或创建用户偏好。
   * expectedRevision=0 → 事务内 create（唯一冲突→返回完整现有记录）。
   * expectedRevision>0 → 条件 updateMany WHERE revision=expectedRevision。
   * 只有明确的唯一约束冲突（Prisma P2002）返回 conflict + existingRecord；
   * 其他事务异常（审计 FK 失败、I/O 等）继续抛出，由调用方处理。
   */
  async casUpsertUserGenerationPreference(
    record: UserGenerationPreferenceRecord,
    expectedRevision: number,
    audit: { actorUserId: string; oldRevision: number; newRevision: number; diff: Record<string, unknown> },
  ): Promise<{ success: true } | { success: false; conflict: true; existingRecord: UserGenerationPreferenceRecord }> {
    return this.client.$transaction(async (tx) => {
      if (expectedRevision === 0) {
        try {
          await tx.userGenerationPreference.create({
            data: {
              id: record.id, userId: record.userId, schemaVersion: record.schemaVersion,
              revision: record.revision, configurationJson: record.configurationJson as never,
              createdAt: record.createdAt, updatedAt: record.updatedAt,
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            const existing = await tx.userGenerationPreference.findUnique({ where: { userId: record.userId } });
            if (!existing) throw error;
            return { success: false, conflict: true, existingRecord: mapUserPreferenceRow(existing) };
          }
          throw error;
        }
      } else {
        const result = await tx.userGenerationPreference.updateMany({
          where: { userId: record.userId, revision: expectedRevision },
          data: {
            revision: record.revision, configurationJson: record.configurationJson as never,
            schemaVersion: record.schemaVersion, updatedAt: record.updatedAt,
          },
        });
        if (result.count !== 1) {
          const existing = await tx.userGenerationPreference.findUnique({ where: { userId: record.userId } });
          return { success: false, conflict: true, existingRecord: existing ? mapUserPreferenceRow(existing) : record };
        }
      }
      await tx.auditLog.create({
        data: {
          actorUserId: audit.actorUserId,
          action: expectedRevision === 0 ? "generation_preference_create" : "generation_preference_update",
          targetType: "UserGenerationPreference",
          targetId: record.userId,
          metadataJson: {
            old_revision: audit.oldRevision, new_revision: audit.newRevision, diff: audit.diff,
          } as never,
        },
      });
      return { success: true };
    });
  }

  /**
   * CAS 更新或创建项目配置（同语义：仅唯一约束冲突返回 conflict + 完整现有记录）。
   */
  async casUpsertProjectGenerationConfiguration(
    record: ProjectGenerationConfigurationRecord,
    expectedRevision: number,
    audit: { actorUserId: string; projectId: string; oldRevision: number; newRevision: number; diff: Record<string, unknown> },
  ): Promise<{ success: true } | { success: false; conflict: true; existingRecord: ProjectGenerationConfigurationRecord }> {
    return this.client.$transaction(async (tx) => {
      if (expectedRevision === 0) {
        try {
          await tx.projectGenerationConfiguration.create({
            data: {
              id: record.id, projectId: record.projectId, schemaVersion: record.schemaVersion,
              revision: record.revision, sourceUserPreferenceRevision: record.sourceUserPreferenceRevision,
              configurationJson: record.configurationJson as never,
              createdAt: record.createdAt, updatedAt: record.updatedAt,
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            const existing = await tx.projectGenerationConfiguration.findUnique({ where: { projectId: record.projectId } });
            if (!existing) throw error;
            return { success: false, conflict: true, existingRecord: mapProjectConfigRow(existing) };
          }
          throw error;
        }
      } else {
        const result = await tx.projectGenerationConfiguration.updateMany({
          where: { projectId: record.projectId, revision: expectedRevision },
          data: {
            revision: record.revision, configurationJson: record.configurationJson as never,
            schemaVersion: record.schemaVersion, updatedAt: record.updatedAt,
          },
        });
        if (result.count !== 1) {
          const existing = await tx.projectGenerationConfiguration.findUnique({ where: { projectId: record.projectId } });
          return { success: false, conflict: true, existingRecord: existing ? mapProjectConfigRow(existing) : record };
        }
      }
      await tx.auditLog.create({
        data: {
          actorUserId: audit.actorUserId, projectId: audit.projectId,
          action: expectedRevision === 0 ? "project_generation_configuration_create" : "project_generation_configuration_update",
          targetType: "ProjectGenerationConfiguration",
          targetId: record.projectId,
          metadataJson: {
            old_revision: audit.oldRevision, new_revision: audit.newRevision, diff: audit.diff,
          } as never,
        },
      });
      return { success: true };
    });
  }
}

// --- 行映射与错误识别辅助 ---------------------------------------------------

/** Prisma 唯一约束冲突错误码（P2002）。其他错误不得折叠为 conflict。 */
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function mapUserPreferenceRow(row: { id: string; userId: string; schemaVersion: string; revision: number; configurationJson: unknown; createdAt: Date; updatedAt: Date }): UserGenerationPreferenceRecord {
  return {
    id: row.id,
    userId: row.userId,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    configurationJson: row.configurationJson as UserGenerationPreferenceRecord["configurationJson"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapProjectConfigRow(row: { id: string; projectId: string; schemaVersion: string; revision: number; sourceUserPreferenceRevision: number | null; configurationJson: unknown; createdAt: Date; updatedAt: Date }): ProjectGenerationConfigurationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    sourceUserPreferenceRevision: row.sourceUserPreferenceRevision,
    configurationJson: row.configurationJson as ProjectGenerationConfigurationRecord["configurationJson"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
