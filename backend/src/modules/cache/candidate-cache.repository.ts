import type { TopicRecommendationFilter } from "../../../../shared/src/topic/topic-recommendation-filter.schema.js";
import type { CandidateCacheRecord, DbClient, ProjectRecommendationRoundRecord } from "../../db/client";

export interface SaveCachedCandidateInput {
  projectId?: string | null;
  eventRegistryEntryId?: string | null;
  eventIdentity?: string | null;
  fingerprint: string;
  filterFingerprint?: string | null;
  oneLineAngle: string;
  familyLabel: string;
  scopeLabel: string;
  viralRubricJson: Record<string, unknown>;
  estimatedDurationBandJson: unknown;
  strongScene: string;
  coreConflict: string;
  mustCoverPreviewJson?: unknown[];
  sourceHint?: string;
  recentUsageHint?: string;
  whyThisNow?: string;
  riskHintsJson?: string[];
}

export async function saveCachedCandidate(
  db: DbClient,
  input: SaveCachedCandidateInput,
): Promise<CandidateCacheRecord> {
  const projectId = input.projectId ?? null;
  const existingRecord = projectId
    ? [...db.candidateCache.values()].find(
        (candidate) =>
          candidate.projectId === projectId &&
          candidate.fingerprint === input.fingerprint,
      )
    : undefined;
  const record: CandidateCacheRecord = {
    id: existingRecord?.id ?? db.generateId(),
    projectId,
    eventRegistryEntryId: input.eventRegistryEntryId ?? null,
    eventIdentity: input.eventIdentity ?? null,
    fingerprint: input.fingerprint,
    filterFingerprint: input.filterFingerprint,
    oneLineAngle: input.oneLineAngle,
    familyLabel: input.familyLabel,
    scopeLabel: input.scopeLabel,
    viralRubricJson: input.viralRubricJson,
    estimatedDurationBandJson: input.estimatedDurationBandJson,
    strongScene: input.strongScene,
    coreConflict: input.coreConflict,
    mustCoverPreviewJson: input.mustCoverPreviewJson ?? [],
    sourceHint: input.sourceHint ?? "",
    recentUsageHint: input.recentUsageHint ?? "",
    whyThisNow: input.whyThisNow ?? "",
    riskHintsJson: input.riskHintsJson ?? [],
    createdAt: existingRecord?.createdAt ?? new Date(),
  };

  await db.firstAggregateWriter?.saveCandidate(record);
  if (projectId) {
    for (const [recordId, candidate] of db.candidateCache) {
      if (
        recordId !== record.id &&
        candidate.projectId === projectId &&
        candidate.fingerprint === record.fingerprint
      ) {
        db.candidateCache.delete(recordId);
      }
    }
  }
  db.candidateCache.set(record.id, record);

  return record;
}

export interface ListRecentCachedCandidatesInput {
  projectId?: string | null;
  createdBefore?: Date;
  finalOnly?: boolean;
  recordIds?: string[];
  limit?: number;
}

export async function listRecentCachedCandidates(
  db: DbClient,
  input: ListRecentCachedCandidatesInput,
): Promise<CandidateCacheRecord[]> {
  return [...db.candidateCache.values()]
    .filter((record) => {
      if (input.projectId && record.projectId !== input.projectId) {
        return false;
      }

      if (input.createdBefore && record.createdAt >= input.createdBefore) {
        return false;
      }

      if (input.finalOnly && !record.eventRegistryEntryId) {
        return false;
      }

      if (input.recordIds && !input.recordIds.includes(record.id)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, input.limit ?? 20);
}

export type { ProjectRecommendationRoundRecord } from "../../db/client";

export async function recordProjectRecommendationRound(
  db: DbClient,
  input: {
    projectId: string;
    createdAt?: Date;
    filterFingerprint?: string | null;
    filterJson?: TopicRecommendationFilter | null;
    candidates: Array<{
      eventRegistryEntryId: string;
      eventIdentity?: string | null;
      title?: string | null;
      fingerprint: string;
    }>;
  },
): Promise<ProjectRecommendationRoundRecord> {
  const store = db.recommendationRounds;
  const rounds = store.get(input.projectId) ?? [];
  const round: ProjectRecommendationRoundRecord = {
    projectId: input.projectId,
    createdAt: input.createdAt ?? new Date(),
    filterFingerprint: input.filterFingerprint,
    filterJson: input.filterJson,
    candidates: input.candidates.map((candidate) => ({
      eventRegistryEntryId: candidate.eventRegistryEntryId,
      eventIdentity: candidate.eventIdentity ?? null,
      title: candidate.title ?? null,
      fingerprint: candidate.fingerprint,
      filterFingerprint: input.filterFingerprint,
      createdAt: input.createdAt ?? new Date(),
    })),
  };

  const project = db.projects.get(input.projectId);
  const projectOwnerId = project?.ownerId ?? db.firstAggregateWriter?.ownerId ?? "system";

  await db.firstAggregateWriter?.recordRecommendationRound(round, projectOwnerId);
  rounds.push(round);
  store.set(input.projectId, rounds);

  return round;
}

export async function listRecentProjectRecommendationRounds(
  db: DbClient,
  input: {
    projectId: string;
    createdBefore?: Date;
    limit?: number;
  },
): Promise<ProjectRecommendationRoundRecord[]> {
  const store = db.recommendationRounds;
  const rounds = store.get(input.projectId) ?? [];

  return rounds
    .filter((round) =>
      input.createdBefore ? round.createdAt < input.createdBefore : true,
    )
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, input.limit ?? 10);
}
