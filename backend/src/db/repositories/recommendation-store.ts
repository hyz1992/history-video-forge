export interface RecommendationExposureInput {
  eventRegistryEntryId: string | null;
  eventIdentity: string | null;
  title: string | null;
  fingerprint: string;
}

export interface RecordRecommendationRoundInput {
  projectId: string;
  candidates: RecommendationExposureInput[];
}

export interface StoredRecommendationRound {
  id: string;
  projectId: string;
  roundIndex: number;
  createdAt: Date;
  candidates: Array<RecommendationExposureInput & { id: string; selectedAt: Date }>;
}

export interface RecommendationStore {
  recordRound(input: RecordRecommendationRoundInput): Promise<StoredRecommendationRound>;
  listRecentEventIdentities(projectId: string, limit: number): Promise<string[]>;
}
