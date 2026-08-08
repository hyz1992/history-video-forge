import type { AppPrismaClient } from "../prisma-client.types.js";
import type { RecommendationStore, RecordRecommendationRoundInput, StoredRecommendationRound } from "./recommendation-store.js";

function isRetryableConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["P1008", "P2002", "P2028"].includes(code)
    || message.includes("Unique constraint")
    || message.includes("SQLITE_BUSY")
    || message.includes("Unable to start a transaction")
    || message.includes("Transaction API error");
}

const projectQueues = new Map<string, Promise<void>>();

async function withProjectLock<T>(projectId: string, work: () => Promise<T>): Promise<T> {
  const previous = projectQueues.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => gate);
  projectQueues.set(projectId, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (projectQueues.get(projectId) === current) projectQueues.delete(projectId);
  }
}

export class PrismaRecommendationStore implements RecommendationStore {
  constructor(private readonly client: AppPrismaClient) {}

  async recordRound(input: RecordRecommendationRoundInput): Promise<StoredRecommendationRound> {
    return withProjectLock(input.projectId, async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.client.$transaction(async (transaction) => {
          const locked = await transaction.project.updateMany({
            where: { id: input.projectId, ownerId: input.ownerId },
            data: { updatedAt: new Date() },
          });
          if (locked.count !== 1) throw new Error("project_scope_denied");
          const latest = await transaction.recommendationRound.aggregate({
            where: { projectId: input.projectId }, _max: { roundIndex: true },
          });
          const selectedAt = Date.now();
          const round = await transaction.recommendationRound.create({
            data: {
              projectId: input.projectId,
              roundIndex: (latest._max.roundIndex ?? 0) + 1,
              filterFingerprint: input.filterFingerprint ?? null,
              filterJson: input.filterJson ? input.filterJson as never : undefined,
              exposures: { create: input.candidates.map((candidate, index) => ({
                ...candidate,
                filterFingerprint: candidate.filterFingerprint ?? input.filterFingerprint ?? null,
                selectedAt: new Date(selectedAt + index),
              })) },
            },
            include: { exposures: { orderBy: { selectedAt: "asc" } } },
          });
          return {
            id: round.id, projectId: round.projectId, roundIndex: round.roundIndex,
            filterFingerprint: round.filterFingerprint,
            filterJson: round.filterJson as StoredRecommendationRound["filterJson"],
            createdAt: round.createdAt,
            candidates: round.exposures.map((exposure) => ({
              id: exposure.id, eventRegistryEntryId: exposure.eventRegistryEntryId,
              eventIdentity: exposure.eventIdentity, title: exposure.title,
              fingerprint: exposure.fingerprint, filterFingerprint: exposure.filterFingerprint,
              selectedAt: exposure.selectedAt,
            })),
          };
        });
      } catch (error) {
        if (error instanceof Error && error.message === "project_scope_denied") throw error;
        if (!isRetryableConflict(error)) throw new Error("recommendation_round_persistence_failed");
        if (attempt === 3) throw new Error("recommendation_round_conflict");
      }
    }
    throw new Error("recommendation_round_conflict");
    });
  }

  async listRecentEventIdentities(projectId: string, ownerId: string, limit: number): Promise<string[]> {
    const project = await this.client.project.findFirst({ where: { id: projectId, ownerId }, select: { id: true } });
    if (!project) throw new Error("project_scope_denied");
    if (limit <= 0) return [];
    const rounds = await this.client.recommendationRound.findMany({
      where: { projectId }, orderBy: { roundIndex: "desc" },
      include: { exposures: { orderBy: { selectedAt: "asc" } } },
    });
    const identities: string[] = [];
    const seen = new Set<string>();
    for (const round of rounds) {
      for (const exposure of round.exposures) {
        if (!exposure.eventIdentity || seen.has(exposure.eventIdentity)) continue;
        seen.add(exposure.eventIdentity);
        identities.push(exposure.eventIdentity);
        if (identities.length >= limit) return identities;
      }
    }
    return identities;
  }
}
