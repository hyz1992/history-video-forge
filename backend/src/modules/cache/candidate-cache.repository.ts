import type { CandidateCacheRecord, DbClient, ProjectRecommendationRoundRecord } from "../../db/client";

export interface SaveCachedCandidateInput {
  projectId?: string | null;
  eventRegistryEntryId?: string | null;
  eventIdentity?: string | null;
  fingerprint: string;
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
  const record: CandidateCacheRecord = {
    id: db.generateId(),
    projectId: input.projectId ?? null,
    eventRegistryEntryId: input.eventRegistryEntryId ?? null,
    eventIdentity: input.eventIdentity ?? null,
    fingerprint: input.fingerprint,
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
    createdAt: new Date(),
  };

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
    candidates: input.candidates.map((candidate) => ({
      eventRegistryEntryId: candidate.eventRegistryEntryId,
      eventIdentity: candidate.eventIdentity ?? null,
      title: candidate.title ?? null,
      fingerprint: candidate.fingerprint,
      createdAt: input.createdAt ?? new Date(),
    })),
  };

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
