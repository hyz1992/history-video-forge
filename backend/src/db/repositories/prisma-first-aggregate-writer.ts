import type { CandidateCacheRecord, EventRegistryRecord, ProjectRecord, ProjectRecommendationRoundRecord, TopicPackageRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";
import { PrismaRecommendationStore } from "./prisma-recommendation-store.js";

export class PrismaFirstAggregateWriter {
  private constructor(private readonly client: AppPrismaClient, readonly ownerId: string) {}

  static async create(client: AppPrismaClient, ownerId: string): Promise<PrismaFirstAggregateWriter> {
    const owner = await client.user.findUnique({ where: { id: ownerId } });
    if (!owner || owner.status !== "ACTIVE") throw new Error("local_project_owner_not_active");
    return new PrismaFirstAggregateWriter(client, ownerId);
  }

  async createProject(record: ProjectRecord): Promise<void> {
    await this.client.project.create({ data: {
      id: record.id, ownerId: record.ownerId, createdById: record.createdById, name: record.name, status: record.status,
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
        filterFingerprint: candidate.filterFingerprint,
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
}
