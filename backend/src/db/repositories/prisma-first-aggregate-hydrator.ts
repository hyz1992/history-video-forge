import { join } from "node:path";

import type { CandidateCacheRecord, DbClient, EventRegistryRecord, ProjectRecord, ProjectRecommendationRoundRecord, TopicPackageRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export async function hydrateFirstAggregates(
  db: DbClient,
  client: AppPrismaClient,
  options: { storageRoot: string },
): Promise<void> {
  const [projects, events, packages, caches, rounds] = await Promise.all([
    client.project.findMany(), client.eventRegistryEntry.findMany(), client.topicPackage.findMany(),
    client.recommendationCandidateCache.findMany(),
    client.recommendationRound.findMany({ orderBy: [{ projectId: "asc" }, { roundIndex: "asc" }], include: { exposures: { orderBy: { selectedAt: "asc" } } } }),
  ]);
  db.projects.clear(); db.events.clear(); db.topicPackages.clear(); db.candidateCache.clear();
  db.recommendationRounds.clear(); db.topicRunCounts.clear();

  for (const row of projects) {
    const record: ProjectRecord = {
      id: row.id, name: row.name, status: row.status, activeTopicPackageId: row.activeTopicPackageId,
      activeScriptRecordId: row.activeScriptRecordId, activeStoryboardRecordId: row.activeStoryboardRecordId,
      activeAssetPlanRecordId: row.activeAssetPlanRecordId, activeAssetManifestRecordId: row.activeAssetManifestRecordId,
      activeComposeRecordId: row.activeComposeRecordId, activeRenderJobRecordId: row.activeRenderJobRecordId,
      activePublishPackageRecordId: row.activePublishPackageRecordId,
      latestTopicRunTraceJson: row.latestTopicRunTraceJson ? object(row.latestTopicRunTraceJson) : null,
      latestScriptRunTraceJson: row.latestScriptRunTraceJson ? object(row.latestScriptRunTraceJson) : null,
      latestStoryboardRunTraceJson: row.latestStoryboardRunTraceJson ? object(row.latestStoryboardRunTraceJson) : null,
      latestAssetPlanRunTraceJson: row.latestAssetPlanRunTraceJson ? object(row.latestAssetPlanRunTraceJson) : null,
      latestAssetsRunTraceJson: row.latestAssetsRunTraceJson ? object(row.latestAssetsRunTraceJson) : null,
      latestComposeRunTraceJson: row.latestComposeRunTraceJson ? object(row.latestComposeRunTraceJson) : null,
      latestRenderRunTraceJson: row.latestRenderRunTraceJson ? object(row.latestRenderRunTraceJson) : null,
      storageDisplayName: row.storageDisplayName, storageShortId: row.storageKey.slice(-8),
      storageRootDir: join(options.storageRoot, "storage", "projects", row.storageKey),
      storageRenameLocked: row.storageRenameLocked, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.projects.set(record.id, record);
  }
  for (const row of events) {
    const record: EventRegistryRecord = { id: row.id, canonicalName: row.canonicalName, aliases: array<string>(row.aliasesJson),
      canonicalQuotesJson: array<string>(row.canonicalQuotesJson), canonicalQuoteIntentsJson: array(row.canonicalQuoteIntentsJson),
      sourceType: row.sourceType, isProvisional: row.isProvisional, createdAt: row.createdAt, updatedAt: row.updatedAt };
    db.events.set(record.id, record);
  }
  for (const row of packages) {
    const record: TopicPackageRecord = { ...row, canonicalQuotesJson: array<string>(row.canonicalQuotesJson),
      canonicalQuoteIntentsJson: array(row.canonicalQuoteIntentsJson), durationBandJson: object(row.durationBandJson),
      narrativeTensionMapJson: object(row.narrativeTensionMapJson), mustIncludeBeatsJson: array(row.mustIncludeBeatsJson),
      forbiddenExpansionsJson: array(row.forbiddenExpansionsJson), riskHintsJson: array(row.riskHintsJson),
      sourceAnchorRefsJson: array(row.sourceAnchorRefsJson), ambiguityNotesJson: array(row.ambiguityNotesJson) };
    db.topicPackages.set(record.id, record);
  }
  for (const row of caches) {
    const record: CandidateCacheRecord = { ...row, viralRubricJson: object(row.viralRubricJson),
      estimatedDurationBandJson: row.estimatedDurationBandJson, mustCoverPreviewJson: array(row.mustCoverPreviewJson) };
    db.candidateCache.set(record.id, record);
  }
  for (const row of rounds) {
    const record: ProjectRecommendationRoundRecord = { projectId: row.projectId, createdAt: row.createdAt,
      candidates: row.exposures.map((item) => ({ eventRegistryEntryId: item.eventRegistryEntryId ?? "", eventIdentity: item.eventIdentity,
        title: item.title, fingerprint: item.fingerprint, createdAt: item.selectedAt })) };
    const projectRounds = db.recommendationRounds.get(row.projectId) ?? [];
    projectRounds.push(record); db.recommendationRounds.set(row.projectId, projectRounds);
    db.topicRunCounts.set(row.projectId, Math.max(db.topicRunCounts.get(row.projectId) ?? 0, row.roundIndex));
  }
}
