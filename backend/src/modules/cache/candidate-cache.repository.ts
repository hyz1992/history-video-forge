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
