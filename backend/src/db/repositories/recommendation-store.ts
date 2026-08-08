import type { TopicRecommendationFilter } from "../../../../shared/src/topic/topic-recommendation-filter.schema.js";

export interface RecommendationExposureInput {
  eventRegistryEntryId: string | null;
  eventIdentity: string | null;
  title: string | null;
  fingerprint: string;
}

export interface RecordRecommendationRoundInput {
  projectId: string;
  ownerId: string;
  filterFingerprint?: string | null;
  filterJson?: TopicRecommendationFilter | null;
  candidates: RecommendationExposureInput[];
}

export interface StoredRecommendationRound {
  id: string;
  projectId: string;
  roundIndex: number;
  filterFingerprint: string | null;
  filterJson: TopicRecommendationFilter | null;
  createdAt: Date;
  candidates: Array<RecommendationExposureInput & {
    id: string;
    filterFingerprint: string | null;
    selectedAt: Date;
  }>;
}

export interface RecommendationStore {
  recordRound(input: RecordRecommendationRoundInput): Promise<StoredRecommendationRound>;
  listRecentEventIdentities(projectId: string, ownerId: string, limit: number): Promise<string[]>;
}
