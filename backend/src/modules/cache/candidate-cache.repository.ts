import type { CandidateCacheRecord, DbClient } from "../../db/client";

export interface SaveCachedCandidateInput {
  projectId?: string | null;
  eventRegistryEntryId?: string | null;
  fingerprint: string;
  oneLineAngle: string;
  familyLabel: string;
  scopeLabel: string;
  viralRubricJson: Record<string, unknown>;
  estimatedDurationBandJson: unknown;
  strongScene: string;
  coreConflict: string;
  mustCoverPreviewJson?: unknown[];
}

export async function saveCachedCandidate(
  db: DbClient,
  input: SaveCachedCandidateInput,
): Promise<CandidateCacheRecord> {
  const record: CandidateCacheRecord = {
    id: db.generateId(),
    projectId: input.projectId ?? null,
    eventRegistryEntryId: input.eventRegistryEntryId ?? null,
    fingerprint: input.fingerprint,
    oneLineAngle: input.oneLineAngle,
    familyLabel: input.familyLabel,
    scopeLabel: input.scopeLabel,
    viralRubricJson: input.viralRubricJson,
    estimatedDurationBandJson: input.estimatedDurationBandJson,
    strongScene: input.strongScene,
    coreConflict: input.coreConflict,
    mustCoverPreviewJson: input.mustCoverPreviewJson ?? [],
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

export interface ProjectRecommendationRoundCandidateRecord {
  eventRegistryEntryId: string;
  fingerprint: string;
  createdAt: Date;
}

export interface ProjectRecommendationRoundRecord {
  projectId: string;
  createdAt: Date;
  candidates: ProjectRecommendationRoundCandidateRecord[];
}

const projectRecommendationRounds = new WeakMap<
  DbClient,
  Map<string, ProjectRecommendationRoundRecord[]>
>();

function getProjectRecommendationRoundStore(db: DbClient) {
  let store = projectRecommendationRounds.get(db);
  if (!store) {
    store = new Map<string, ProjectRecommendationRoundRecord[]>();
    projectRecommendationRounds.set(db, store);
  }

  return store;
}

export async function recordProjectRecommendationRound(
  db: DbClient,
  input: {
    projectId: string;
    createdAt?: Date;
    candidates: Array<{
      eventRegistryEntryId: string;
      fingerprint: string;
    }>;
  },
): Promise<ProjectRecommendationRoundRecord> {
  const store = getProjectRecommendationRoundStore(db);
  const rounds = store.get(input.projectId) ?? [];
  const round: ProjectRecommendationRoundRecord = {
    projectId: input.projectId,
    createdAt: input.createdAt ?? new Date(),
    candidates: input.candidates.map((candidate) => ({
      eventRegistryEntryId: candidate.eventRegistryEntryId,
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
  const store = getProjectRecommendationRoundStore(db);
  const rounds = store.get(input.projectId) ?? [];

  return rounds
    .filter((round) =>
      input.createdBefore ? round.createdAt < input.createdBefore : true,
    )
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, input.limit ?? 10);
}
