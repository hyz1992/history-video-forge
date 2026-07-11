ALTER TABLE "RecommendationCandidateCache" ADD COLUMN "sourceHint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RecommendationCandidateCache" ADD COLUMN "recentUsageHint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RecommendationCandidateCache" ADD COLUMN "whyThisNow" TEXT NOT NULL DEFAULT '';
ALTER TABLE "RecommendationCandidateCache" ADD COLUMN "riskHintsJson" JSONB NOT NULL DEFAULT '[]';
