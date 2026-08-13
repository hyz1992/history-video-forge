-- S2-2A 生成配置与费用治理：九个新实体。
-- 设计依据：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-design.md 第 4 节。
-- 原则：只新增表、索引和必要外键，不改写 0001_v2_baseline。
-- 金额列使用 TEXT（十进制微元字符串），避免 Int 溢出，与 shared schema decimalMicrosString 一致。

-- CreateTable UserGenerationPreference
CREATE TABLE "UserGenerationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "configurationJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserGenerationPreference_userId_key" UNIQUE ("userId"),
    CONSTRAINT "UserGenerationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable ProjectGenerationConfiguration
CREATE TABLE "ProjectGenerationConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceUserPreferenceRevision" INTEGER,
    "configurationJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProjectGenerationConfiguration_projectId_key" UNIQUE ("projectId"),
    CONSTRAINT "ProjectGenerationConfiguration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable ProviderModelCatalog
-- 每个 capability 恰好一个 active+isDefault=true 项（resolver auto 硬合同，seed 保证）。
CREATE TABLE "ProviderModelCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capability" TEXT NOT NULL CHECK ("capability" IN ('llm.smart', 'llm.flash', 'image.generate', 'video.image_to_video', 'tts.synthesize')),
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelVersion" TEXT,
    "displayName" TEXT NOT NULL,
    "qualityTier" TEXT,
    "speedTier" TEXT,
    "parameterCapabilitiesJson" TEXT NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "pricingJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disabled' CHECK ("status" IN ('active', 'disabled')),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "ProviderModelCatalog_capability_status_idx" ON "ProviderModelCatalog" ("capability", "status");

-- CreateTable StoryboardSegmentOverride
-- 唯一约束为 (storyboardRecordId, segmentId)；projectId 只用于 owner scope/index。
CREATE TABLE "StoryboardSegmentOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "storyboardRecordId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "strategyOverride" TEXT CHECK ("strategyOverride" IS NULL OR "strategyOverride" IN ('api_video', 'remotion_motion')),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoryboardSegmentOverride_storyboardRecordId_segmentId_key" UNIQUE ("storyboardRecordId", "segmentId"),
    CONSTRAINT "StoryboardSegmentOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StoryboardSegmentOverride_projectId_idx" ON "StoryboardSegmentOverride" ("projectId");

-- CreateTable GenerationCostQuote
CREATE TABLE "GenerationCostQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "operation" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "quoteFingerprint" TEXT NOT NULL,
    "pricingHash" TEXT NOT NULL,
    "pricingVersionSetJson" TEXT NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "estimatedCostMicros" TEXT NOT NULL,
    "authorizationCostMicros" TEXT NOT NULL,
    "containsUnboundedItem" BOOLEAN NOT NULL DEFAULT false,
    "budgetLimitMicros" TEXT,
    "overBudget" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationCostQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GenerationCostQuote_projectId_operation_idx" ON "GenerationCostQuote" ("projectId", "operation");

-- CreateTable RunConfigurationSnapshot
-- 不可变运行快照。repository 不提供 update；重新运行创建新快照。
CREATE TABLE "RunConfigurationSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "stage" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "runId" TEXT,
    "projectConfigurationRevision" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "resolvedConfigurationJson" TEXT NOT NULL,
    "resolutionTraceJson" TEXT NOT NULL,
    "quoteId" TEXT,
    "quoteFingerprint" TEXT,
    "estimatedCostMicros" TEXT,
    "authorizationCostMicros" TEXT,
    "budgetLimitMicros" TEXT,
    "budgetOverrideAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "pricingHash" TEXT,
    "pricingVersionSetJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunConfigurationSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RunConfigurationSnapshot_projectId_idx" ON "RunConfigurationSnapshot" ("projectId");

-- CreateTable GenerationRun
-- 唯一约束 (projectId, operation, idempotencyKey) + quoteId/snapshotId 各自唯一。
CREATE TABLE "GenerationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "operation" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "quoteId" TEXT,
    "runConfigurationSnapshotId" TEXT NOT NULL,
    "dispatchPayloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('pending_dispatch', 'running', 'succeeded', 'failed', 'needs_reconciliation')),
    "dispatchLeaseOwner" TEXT,
    "dispatchLeaseExpiresAt" DATETIME,
    "dispatchClaimCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationRun_projectId_operation_idempotencyKey_key" UNIQUE ("projectId", "operation", "idempotencyKey"),
    CONSTRAINT "GenerationRun_quoteId_key" UNIQUE ("quoteId"),
    CONSTRAINT "GenerationRun_runConfigurationSnapshotId_key" UNIQUE ("runConfigurationSnapshotId"),
    CONSTRAINT "GenerationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_runConfigurationSnapshotId_fkey" FOREIGN KEY ("runConfigurationSnapshotId") REFERENCES "RunConfigurationSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "GenerationRun_projectId_status_idx" ON "GenerationRun" ("projectId", "status");

-- CreateTable GenerationRunEvent (append-only，无 updatedAt)
CREATE TABLE "GenerationRunEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationRunId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "segmentId" TEXT,
    "eventJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GenerationRunEvent_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GenerationRunEvent_generationRunId_idx" ON "GenerationRunEvent" ("generationRunId");

-- CreateTable UsageCostRecord
-- 唯一约束 (runConfigurationSnapshotId, providerRequestKey, attemptIndex) 防重复记账。
CREATE TABLE "UsageCostRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runConfigurationSnapshotId" TEXT NOT NULL,
    "assetProviderJobRecordId" TEXT,
    "interactionId" TEXT,
    "capability" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "providerRequestKey" TEXT NOT NULL,
    "attemptIndex" INTEGER NOT NULL,
    "status" TEXT NOT NULL CHECK ("status" IN ('planned', 'submitted', 'succeeded', 'failed', 'canceled')),
    "unitType" TEXT NOT NULL CHECK ("unitType" IN ('token', 'image', 'video_second', 'tts_character', 'request')),
    "inputUnits" INTEGER,
    "outputUnits" INTEGER,
    "estimatedCostMicros" TEXT NOT NULL,
    "actualCostMicros" TEXT,
    "costBasis" TEXT NOT NULL CHECK ("costBasis" IN ('estimate', 'provider_usage', 'provider_invoice')),
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UsageCostRecord_runConfigurationSnapshotId_providerRequestKey_attemptIndex_key" UNIQUE ("runConfigurationSnapshotId", "providerRequestKey", "attemptIndex"),
    CONSTRAINT "UsageCostRecord_runConfigurationSnapshotId_fkey" FOREIGN KEY ("runConfigurationSnapshotId") REFERENCES "RunConfigurationSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UsageCostRecord_runConfigurationSnapshotId_idx" ON "UsageCostRecord" ("runConfigurationSnapshotId");

-- Seed ProviderModelCatalog：为每个 capability 恰好一个 active+isDefault=true 项。
-- S2-2A 只暴露当前真实可调用的能力；不可用能力不伪造。
-- LLM 映射来自现有 providers.json/tier resolver 的真实 provider/model；媒体为 DashScope。
INSERT INTO "ProviderModelCatalog" ("id", "capability", "providerKey", "modelId", "modelVersion", "displayName", "qualityTier", "speedTier", "parameterCapabilitiesJson", "pricingVersion", "pricingJson", "status", "isDefault", "updatedAt") VALUES
  ('llm.smart.dashscope.qwen-max', 'llm.smart', 'dashscope', 'qwen-max', NULL, '通义千问 Max（智能）', 'high', 'slow', '{}', 'dashscope-llm-2026-08-12', '{}', 'active', 1, CURRENT_TIMESTAMP),
  ('llm.flash.dashscope.qwen-flash', 'llm.flash', 'dashscope', 'qwen-flash', NULL, '通义千问 Flash（快速）', 'standard', 'fast', '{}', 'dashscope-llm-2026-08-12', '{}', 'active', 1, CURRENT_TIMESTAMP),
  ('image.generate.dashscope.wanx-v1', 'image.generate', 'dashscope', 'wanx2.1-t2i-turbo', NULL, '万相文生图', 'standard', 'standard', '{"aspect_ratios":["9:16","16:9","1:1"]}', 'dashscope-media-2026-08-12', '{}', 'active', 1, CURRENT_TIMESTAMP),
  ('video.image_to_video.dashscope.video-v1', 'video.image_to_video', 'dashscope', 'wanx2.1-i2v-plus', NULL, '万相图生视频', 'high', 'slow', '{"qualities":["standard_720p","high_1080p"]}', 'dashscope-media-2026-08-12', '{}', 'active', 1, CURRENT_TIMESTAMP),
  ('tts.synthesize.dashscope.qwen3-tts', 'tts.synthesize', 'dashscope', 'qwen3-tts-vd-2026-01-26', NULL, '通义千问 TTS', 'standard', 'standard', '{}', 'dashscope-media-2026-08-12', '{}', 'active', 1, CURRENT_TIMESTAMP);
