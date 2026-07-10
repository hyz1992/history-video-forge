-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'topic_pending',
    "storageKey" TEXT NOT NULL,
    "storageDisplayName" TEXT NOT NULL,
    "storageRenameLocked" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "activeTopicPackageId" TEXT,
    "activeScriptRecordId" TEXT,
    "activeStoryboardRecordId" TEXT,
    "activeAssetPlanRecordId" TEXT,
    "activeAssetManifestRecordId" TEXT,
    "activeComposeRecordId" TEXT,
    "activeRenderJobRecordId" TEXT,
    "activePublishPackageRecordId" TEXT,
    "latestTopicRunTraceJson" JSONB,
    "latestScriptRunTraceJson" JSONB,
    "latestStoryboardRunTraceJson" JSONB,
    "latestAssetPlanRunTraceJson" JSONB,
    "latestAssetsRunTraceJson" JSONB,
    "latestComposeRunTraceJson" JSONB,
    "latestRenderRunTraceJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeTopicPackageId_fkey" FOREIGN KEY ("activeTopicPackageId") REFERENCES "TopicPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeScriptRecordId_fkey" FOREIGN KEY ("activeScriptRecordId") REFERENCES "ScriptRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeStoryboardRecordId_fkey" FOREIGN KEY ("activeStoryboardRecordId") REFERENCES "StoryboardRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeAssetPlanRecordId_fkey" FOREIGN KEY ("activeAssetPlanRecordId") REFERENCES "AssetPlanRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeAssetManifestRecordId_fkey" FOREIGN KEY ("activeAssetManifestRecordId") REFERENCES "AssetManifestRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeComposeRecordId_fkey" FOREIGN KEY ("activeComposeRecordId") REFERENCES "ComposeRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activeRenderJobRecordId_fkey" FOREIGN KEY ("activeRenderJobRecordId") REFERENCES "RenderJobRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_activePublishPackageRecordId_fkey" FOREIGN KEY ("activePublishPackageRecordId") REFERENCES "PublishPackageRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventRegistryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalName" TEXT NOT NULL,
    "aliasesJson" JSONB NOT NULL,
    "canonicalQuotesJson" JSONB NOT NULL,
    "canonicalQuoteIntentsJson" JSONB NOT NULL,
    "sourceType" TEXT NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TopicPackage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "eventRegistryEntryId" TEXT,
    "title" TEXT NOT NULL,
    "selectedAngle" TEXT NOT NULL,
    "familyLabel" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "coreConflict" TEXT NOT NULL,
    "strongScene" TEXT NOT NULL,
    "stakes" TEXT,
    "packagingSeed" TEXT NOT NULL,
    "canonicalQuotesJson" JSONB NOT NULL,
    "canonicalQuoteIntentsJson" JSONB NOT NULL,
    "durationBandJson" JSONB NOT NULL,
    "narrativeTensionMapJson" JSONB NOT NULL,
    "mustIncludeBeatsJson" JSONB NOT NULL,
    "forbiddenExpansionsJson" JSONB NOT NULL,
    "riskHintsJson" JSONB NOT NULL,
    "sourceAnchorRefsJson" JSONB NOT NULL,
    "ambiguityNotesJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TopicPackage_eventRegistryEntryId_fkey" FOREIGN KEY ("eventRegistryEntryId") REFERENCES "EventRegistryEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationCandidateCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "eventRegistryEntryId" TEXT,
    "eventIdentity" TEXT,
    "fingerprint" TEXT NOT NULL,
    "oneLineAngle" TEXT NOT NULL,
    "familyLabel" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "viralRubricJson" JSONB NOT NULL,
    "estimatedDurationBandJson" JSONB NOT NULL,
    "strongScene" TEXT NOT NULL,
    "coreConflict" TEXT NOT NULL,
    "mustCoverPreviewJson" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationCandidateCache_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecommendationCandidateCache_eventRegistryEntryId_fkey" FOREIGN KEY ("eventRegistryEntryId") REFERENCES "EventRegistryEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScriptRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "topicPackageId" TEXT NOT NULL,
    "scriptText" TEXT NOT NULL,
    "openingSpan" TEXT NOT NULL,
    "endingSpan" TEXT NOT NULL,
    "estimatedDurationSec" INTEGER NOT NULL,
    "beatTraceJson" JSONB NOT NULL,
    "quoteTraceJson" JSONB NOT NULL,
    "reviewStatus" TEXT NOT NULL,
    "validationResultJson" JSONB,
    "semanticReviewResultJson" JSONB,
    "executionStateJson" JSONB,
    "graphTraceSummaryJson" JSONB,
    "runtimeDiagnosticsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScriptRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScriptRecord_topicPackageId_fkey" FOREIGN KEY ("topicPackageId") REFERENCES "TopicPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoryboardRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "topicPackageId" TEXT NOT NULL,
    "scriptRecordId" TEXT NOT NULL,
    "planJson" JSONB NOT NULL,
    "validationResultJson" JSONB NOT NULL,
    "executionStateJson" JSONB,
    "graphTraceSummaryJson" JSONB,
    "runtimeDiagnosticsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryboardRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryboardRecord_topicPackageId_fkey" FOREIGN KEY ("topicPackageId") REFERENCES "TopicPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StoryboardRecord_scriptRecordId_fkey" FOREIGN KEY ("scriptRecordId") REFERENCES "ScriptRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetPlanRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "topicPackageId" TEXT NOT NULL,
    "scriptRecordId" TEXT NOT NULL,
    "storyboardRecordId" TEXT NOT NULL,
    "planJson" JSONB NOT NULL,
    "validationResultJson" JSONB NOT NULL,
    "executionStateJson" JSONB NOT NULL,
    "graphTraceSummaryJson" JSONB,
    "runtimeDiagnosticsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetPlanRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetPlanRecord_topicPackageId_fkey" FOREIGN KEY ("topicPackageId") REFERENCES "TopicPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetPlanRecord_scriptRecordId_fkey" FOREIGN KEY ("scriptRecordId") REFERENCES "ScriptRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetPlanRecord_storyboardRecordId_fkey" FOREIGN KEY ("storyboardRecordId") REFERENCES "StoryboardRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetManifestRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "topicPackageId" TEXT NOT NULL,
    "scriptRecordId" TEXT NOT NULL,
    "storyboardRecordId" TEXT NOT NULL,
    "assetPlanRecordId" TEXT NOT NULL,
    "manifestJson" JSONB NOT NULL,
    "validationResultJson" JSONB NOT NULL,
    "executionStateJson" JSONB,
    "graphTraceSummaryJson" JSONB,
    "runtimeDiagnosticsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetManifestRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetManifestRecord_topicPackageId_fkey" FOREIGN KEY ("topicPackageId") REFERENCES "TopicPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetManifestRecord_scriptRecordId_fkey" FOREIGN KEY ("scriptRecordId") REFERENCES "ScriptRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetManifestRecord_storyboardRecordId_fkey" FOREIGN KEY ("storyboardRecordId") REFERENCES "StoryboardRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetManifestRecord_assetPlanRecordId_fkey" FOREIGN KEY ("assetPlanRecordId") REFERENCES "AssetPlanRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComposeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "assetManifestRecordId" TEXT NOT NULL,
    "timelineJson" JSONB NOT NULL,
    "validationResultJson" JSONB NOT NULL,
    "executionStateJson" JSONB,
    "graphTraceSummaryJson" JSONB,
    "runtimeDiagnosticsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComposeRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ComposeRecord_assetManifestRecordId_fkey" FOREIGN KEY ("assetManifestRecordId") REFERENCES "AssetManifestRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RenderJobRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "composeRecordId" TEXT NOT NULL,
    "assetManifestRecordId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "profileJson" JSONB NOT NULL,
    "outputArtifactJson" JSONB,
    "validationResultJson" JSONB NOT NULL,
    "executionStateJson" JSONB,
    "graphTraceSummaryJson" JSONB,
    "runtimeDiagnosticsJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RenderJobRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RenderJobRecord_composeRecordId_fkey" FOREIGN KEY ("composeRecordId") REFERENCES "ComposeRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RenderJobRecord_assetManifestRecordId_fkey" FOREIGN KEY ("assetManifestRecordId") REFERENCES "AssetManifestRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishPackageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "renderJobRecordId" TEXT NOT NULL,
    "topicPackageId" TEXT NOT NULL,
    "scriptRecordId" TEXT NOT NULL,
    "storyboardRecordId" TEXT NOT NULL,
    "assetManifestRecordId" TEXT NOT NULL,
    "packageJson" JSONB NOT NULL,
    "validationResultJson" JSONB,
    "executionStateJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishPackageRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishPackageRecord_renderJobRecordId_fkey" FOREIGN KEY ("renderJobRecordId") REFERENCES "RenderJobRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishPackageRecord_topicPackageId_fkey" FOREIGN KEY ("topicPackageId") REFERENCES "TopicPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishPackageRecord_scriptRecordId_fkey" FOREIGN KEY ("scriptRecordId") REFERENCES "ScriptRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishPackageRecord_storyboardRecordId_fkey" FOREIGN KEY ("storyboardRecordId") REFERENCES "StoryboardRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PublishPackageRecord_assetManifestRecordId_fkey" FOREIGN KEY ("assetManifestRecordId") REFERENCES "AssetManifestRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetProviderJobRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetManifestRecordId" TEXT NOT NULL,
    "assetRunId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerJobId" TEXT,
    "status" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "rawRequestJson" JSONB,
    "rawResponseJson" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "submittedAt" DATETIME,
    "lastPolledAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssetProviderJobRecord_assetManifestRecordId_fkey" FOREIGN KEY ("assetManifestRecordId") REFERENCES "AssetManifestRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "roundIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationExposure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "eventRegistryEntryId" TEXT,
    "eventIdentity" TEXT,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT,
    "selectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationExposure_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "RecommendationRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecommendationExposure_eventRegistryEntryId_fkey" FOREIGN KEY ("eventRegistryEntryId") REFERENCES "EventRegistryEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadataJson" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataMigrationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceSha256" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reportJson" JSONB NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_storageKey_key" ON "Project"("storageKey");

-- CreateIndex
CREATE INDEX "Project_ownerId_updatedAt_idx" ON "Project"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Project_status_archivedAt_idx" ON "Project"("status", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistryEntry_canonicalName_key" ON "EventRegistryEntry"("canonicalName");

-- CreateIndex
CREATE INDEX "TopicPackage_projectId_createdAt_idx" ON "TopicPackage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TopicPackage_eventRegistryEntryId_idx" ON "TopicPackage"("eventRegistryEntryId");

-- CreateIndex
CREATE INDEX "RecommendationCandidateCache_projectId_eventIdentity_createdAt_idx" ON "RecommendationCandidateCache"("projectId", "eventIdentity", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationCandidateCache_eventRegistryEntryId_idx" ON "RecommendationCandidateCache"("eventRegistryEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationCandidateCache_projectId_fingerprint_key" ON "RecommendationCandidateCache"("projectId", "fingerprint");

-- CreateIndex
CREATE INDEX "ScriptRecord_projectId_createdAt_idx" ON "ScriptRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScriptRecord_topicPackageId_idx" ON "ScriptRecord"("topicPackageId");

-- CreateIndex
CREATE INDEX "StoryboardRecord_projectId_createdAt_idx" ON "StoryboardRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "StoryboardRecord_topicPackageId_idx" ON "StoryboardRecord"("topicPackageId");

-- CreateIndex
CREATE INDEX "StoryboardRecord_scriptRecordId_idx" ON "StoryboardRecord"("scriptRecordId");

-- CreateIndex
CREATE INDEX "AssetPlanRecord_projectId_createdAt_idx" ON "AssetPlanRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetPlanRecord_topicPackageId_idx" ON "AssetPlanRecord"("topicPackageId");

-- CreateIndex
CREATE INDEX "AssetPlanRecord_scriptRecordId_idx" ON "AssetPlanRecord"("scriptRecordId");

-- CreateIndex
CREATE INDEX "AssetPlanRecord_storyboardRecordId_idx" ON "AssetPlanRecord"("storyboardRecordId");

-- CreateIndex
CREATE INDEX "AssetManifestRecord_projectId_createdAt_idx" ON "AssetManifestRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetManifestRecord_topicPackageId_idx" ON "AssetManifestRecord"("topicPackageId");

-- CreateIndex
CREATE INDEX "AssetManifestRecord_scriptRecordId_idx" ON "AssetManifestRecord"("scriptRecordId");

-- CreateIndex
CREATE INDEX "AssetManifestRecord_storyboardRecordId_idx" ON "AssetManifestRecord"("storyboardRecordId");

-- CreateIndex
CREATE INDEX "AssetManifestRecord_assetPlanRecordId_idx" ON "AssetManifestRecord"("assetPlanRecordId");

-- CreateIndex
CREATE INDEX "ComposeRecord_projectId_createdAt_idx" ON "ComposeRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ComposeRecord_assetManifestRecordId_idx" ON "ComposeRecord"("assetManifestRecordId");

-- CreateIndex
CREATE INDEX "RenderJobRecord_projectId_createdAt_idx" ON "RenderJobRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RenderJobRecord_composeRecordId_idx" ON "RenderJobRecord"("composeRecordId");

-- CreateIndex
CREATE INDEX "RenderJobRecord_assetManifestRecordId_idx" ON "RenderJobRecord"("assetManifestRecordId");

-- CreateIndex
CREATE INDEX "PublishPackageRecord_projectId_createdAt_idx" ON "PublishPackageRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishPackageRecord_renderJobRecordId_idx" ON "PublishPackageRecord"("renderJobRecordId");

-- CreateIndex
CREATE INDEX "AssetProviderJobRecord_assetManifestRecordId_status_idx" ON "AssetProviderJobRecord"("assetManifestRecordId", "status");

-- CreateIndex
CREATE INDEX "AssetProviderJobRecord_providerName_providerJobId_idx" ON "AssetProviderJobRecord"("providerName", "providerJobId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetProviderJobRecord_assetRunId_executionId_taskId_attemptCount_key" ON "AssetProviderJobRecord"("assetRunId", "executionId", "taskId", "attemptCount");

-- CreateIndex
CREATE INDEX "RecommendationRound_projectId_createdAt_idx" ON "RecommendationRound"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationRound_projectId_roundIndex_key" ON "RecommendationRound"("projectId", "roundIndex");

-- CreateIndex
CREATE INDEX "RecommendationExposure_eventIdentity_selectedAt_idx" ON "RecommendationExposure"("eventIdentity", "selectedAt");

-- CreateIndex
CREATE INDEX "RecommendationExposure_eventRegistryEntryId_idx" ON "RecommendationExposure"("eventRegistryEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationExposure_roundId_fingerprint_key" ON "RecommendationExposure"("roundId", "fingerprint");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "DataMigrationRun_sourceSha256_key" ON "DataMigrationRun"("sourceSha256");

-- CreateIndex
CREATE INDEX "DataMigrationRun_status_startedAt_idx" ON "DataMigrationRun"("status", "startedAt");
