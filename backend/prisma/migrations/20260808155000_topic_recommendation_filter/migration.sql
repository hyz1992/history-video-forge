-- AlterTable
ALTER TABLE "RecommendationCandidateCache" ADD COLUMN "filterFingerprint" TEXT;
ALTER TABLE "RecommendationRound" ADD COLUMN "filterFingerprint" TEXT;
ALTER TABLE "RecommendationRound" ADD COLUMN "filterJson" TEXT;
ALTER TABLE "RecommendationExposure" ADD COLUMN "filterFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "RecommendationCandidateCache_projectId_filterFingerprint_createdAt_idx"
ON "RecommendationCandidateCache"("projectId", "filterFingerprint", "createdAt");
CREATE INDEX "RecommendationRound_projectId_filterFingerprint_createdAt_idx"
ON "RecommendationRound"("projectId", "filterFingerprint", "createdAt");
CREATE INDEX "RecommendationExposure_filterFingerprint_selectedAt_idx"
ON "RecommendationExposure"("filterFingerprint", "selectedAt");
