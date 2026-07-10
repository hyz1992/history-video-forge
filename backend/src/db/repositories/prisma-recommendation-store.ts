import type { AppPrismaClient } from "../prisma-client.types.js";
import type {
  RecommendationStore,
  RecordRecommendationRoundInput,
  StoredRecommendationRound,
} from "./recommendation-store.js";

export class PrismaRecommendationStore implements RecommendationStore {
  constructor(private readonly client: AppPrismaClient) {}

  async recordRound(input: RecordRecommendationRoundInput): Promise<StoredRecommendationRound> {
    return this.client.$transaction(async (transaction) => {
      const latest = await transaction.recommendationRound.aggregate({
        where: { projectId: input.projectId },
        _max: { roundIndex: true },
      });
      const selectedAt = Date.now();
      const round = await transaction.recommendationRound.create({
        data: {
          projectId: input.projectId,
          roundIndex: (latest._max.roundIndex ?? 0) + 1,
          exposures: {
            create: input.candidates.map((candidate, index) => ({
              ...candidate,
              selectedAt: new Date(selectedAt + index),
            })),
          },
        },
        include: {
          exposures: { orderBy: { selectedAt: "asc" } },
        },
      });

      return {
        id: round.id,
        projectId: round.projectId,
        roundIndex: round.roundIndex,
        createdAt: round.createdAt,
        candidates: round.exposures.map((exposure) => ({
          id: exposure.id,
          eventRegistryEntryId: exposure.eventRegistryEntryId,
          eventIdentity: exposure.eventIdentity,
          title: exposure.title,
          fingerprint: exposure.fingerprint,
          selectedAt: exposure.selectedAt,
        })),
      };
    });
  }

  async listRecentEventIdentities(projectId: string, limit: number): Promise<string[]> {
    if (limit <= 0) return [];
    const rounds = await this.client.recommendationRound.findMany({
      where: { projectId },
      orderBy: { roundIndex: "desc" },
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
