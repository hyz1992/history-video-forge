import { join } from "node:path";

import type { ProjectTopicCandidateState } from "../../app.js";
import type { StoredTopicCandidate } from "../../modules/topic/topic-confirm.service.js";
import type { CandidateCacheRecord, DbClient, EventRegistryRecord, ProjectRecord, ProjectRecommendationRoundRecord, TopicPackageRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";
import { parseRecommendationRoundFilterJson } from "./recommendation-round-filter.js";
import { buildProjectStorageRelativeDir } from "../../runtime/trace/project-storage.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/** Reconstruct the on-disk short id from the project UUID, matching the
 *  convention used by project-storage.ts (`p_<first 8 hex chars>`). */
function buildShortId(projectId: string): string {
  const compact = projectId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const shortBody = (compact.slice(0, 8) || "00000000").padEnd(8, "0");
  return `p_${shortBody}`;
}

export async function hydrateFirstAggregates(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  client: AppPrismaClient,
  options: { storageRoot: string },
): Promise<void> {
  const [projects, events, packages, caches, rounds] = await Promise.all([
    client.project.findMany({ where: { archivedAt: null } }), client.eventRegistryEntry.findMany(), client.topicPackage.findMany(),
    client.recommendationCandidateCache.findMany(),
    client.recommendationRound.findMany({ orderBy: [{ projectId: "asc" }, { roundIndex: "asc" }], include: { exposures: { orderBy: { selectedAt: "asc" } } } }),
  ]);
  const roundFilters = new Map(
    rounds.map((round) => [round.id, parseRecommendationRoundFilterJson(round.filterJson)]),
  );
  db.projects.clear(); db.events.clear(); db.topicPackages.clear(); db.candidateCache.clear();
  db.recommendationRounds.clear(); db.topicRunCounts.clear(); topicCandidateStore.clear();

  for (const row of projects) {
    const record: ProjectRecord = {
      id: row.id, name: row.name, ownerId: row.ownerId, createdById: row.createdById,
      status: row.status, activeTopicPackageId: row.activeTopicPackageId,
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
      storageDisplayName: row.storageDisplayName,
      storageShortId: buildShortId(row.id),
      // Reconstruct the on-disk storage root from createdAt + displayName +
      // shortId, matching the layout used by project-storage.ts when files
      // are written. The DB storageKey is the project UUID (used for
      // uniqueness), NOT the on-disk directory name.
      storageRootDir: join(
        options.storageRoot,
        buildProjectStorageRelativeDir({
          createdAt: row.createdAt,
          displayName: row.storageDisplayName || row.name,
          shortId: buildShortId(row.id),
        }),
      ),
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
    if (!db.projects.has(row.projectId)) continue;
    const record: TopicPackageRecord = { ...row, canonicalQuotesJson: array<string>(row.canonicalQuotesJson),
      canonicalQuoteIntentsJson: array(row.canonicalQuoteIntentsJson), durationBandJson: object(row.durationBandJson),
      narrativeTensionMapJson: object(row.narrativeTensionMapJson), mustIncludeBeatsJson: array(row.mustIncludeBeatsJson),
      forbiddenExpansionsJson: array(row.forbiddenExpansionsJson), riskHintsJson: array(row.riskHintsJson),
      sourceAnchorRefsJson: array(row.sourceAnchorRefsJson), ambiguityNotesJson: array(row.ambiguityNotesJson),
      sourceRefJson: row.sourceRefJson ? object(row.sourceRefJson) : null };
    db.topicPackages.set(record.id, record);
  }
  for (const row of caches) {
    if (row.projectId && !db.projects.has(row.projectId)) continue;
    const record: CandidateCacheRecord = { ...row, filterFingerprint: row.filterFingerprint,
      viralRubricJson: object(row.viralRubricJson),
      estimatedDurationBandJson: row.estimatedDurationBandJson, mustCoverPreviewJson: array(row.mustCoverPreviewJson),
      riskHintsJson: array<string>(row.riskHintsJson) };
    db.candidateCache.set(record.id, record);
  }
  for (const row of rounds) {
    if (!db.projects.has(row.projectId)) continue;
    const record: ProjectRecommendationRoundRecord = { projectId: row.projectId, createdAt: row.createdAt,
      filterFingerprint: row.filterFingerprint,
      filterJson: roundFilters.get(row.id)!,
      candidates: row.exposures.map((item) => ({ eventRegistryEntryId: item.eventRegistryEntryId ?? "", eventIdentity: item.eventIdentity,
        title: item.title, fingerprint: item.fingerprint, filterFingerprint: item.filterFingerprint,
        createdAt: item.selectedAt })) };
    const projectRounds = db.recommendationRounds.get(row.projectId) ?? [];
    projectRounds.push(record); db.recommendationRounds.set(row.projectId, projectRounds);
    db.topicRunCounts.set(row.projectId, Math.max(db.topicRunCounts.get(row.projectId) ?? 0, row.roundIndex));
    const cacheByFingerprint = new Map(caches.filter((cache) => cache.projectId === row.projectId).map((cache) => [cache.fingerprint, cache]));
    const candidates = row.exposures.flatMap((exposure): StoredTopicCandidate[] => {
      const cache = cacheByFingerprint.get(exposure.fingerprint);
      const event = exposure.eventRegistryEntryId ? db.events.get(exposure.eventRegistryEntryId) : undefined;
      if (!cache || !event) return [];
      return [{
        candidateId: exposure.id, projectId: row.projectId, event,
        title: exposure.title ?? cache.eventIdentity ?? event.canonicalName,
        oneLineAngle: cache.oneLineAngle, familyLabel: cache.familyLabel, scopeLabel: cache.scopeLabel,
        coreConflict: cache.coreConflict, strongScene: cache.strongScene,
        mustCoverPreview: array<string>(cache.mustCoverPreviewJson), sourceHint: cache.sourceHint,
        recentUsageHint: cache.recentUsageHint, whyThisNow: cache.whyThisNow,
        riskHints: array<string>(cache.riskHintsJson), viralRubric: object(cache.viralRubricJson) as Record<string, string>,
      }];
    });
    const state: ProjectTopicCandidateState = topicCandidateStore.get(row.projectId) ?? { candidatesById: new Map(), rounds: [] };
    for (const candidate of candidates) state.candidatesById.set(candidate.candidateId, candidate);
    state.rounds.push({ roundId: row.id, roundIndex: row.roundIndex, createdAt: row.createdAt.toISOString(), candidates });
    topicCandidateStore.set(row.projectId, state);
  }
}
