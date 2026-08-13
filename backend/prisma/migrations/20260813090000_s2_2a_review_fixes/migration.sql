-- S2-2A 任务 2 审查整改：金额约束、外键、call-intent 防重、seed 对齐。
-- 原则：不改写已提交迁移（checksum 失配会让已激活数据库失活），全部走本增量迁移。
-- SQLite 的 ALTER TABLE 无法新增 CHECK/FK 约束，涉及约束的表用 12 步重建法保留数据。

-- ============================================================================
-- 1) GenerationCostQuote：金额列加非负十进制整数 CHECK。
--    金额列保持 TEXT（十进制微元字符串），但必须匹配 ^(0|[1-9][0-9]*)$。
-- ============================================================================
CREATE TABLE "GenerationCostQuote_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "operation" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "quoteFingerprint" TEXT NOT NULL,
    "pricingHash" TEXT NOT NULL,
    "pricingVersionSetJson" TEXT NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "estimatedCostMicros" TEXT NOT NULL CHECK (estimatedCostMicros NOT GLOB '*[^0-9]*' AND length(estimatedCostMicros) >= 1 AND length(estimatedCostMicros) <= 19 AND (estimatedCostMicros = '0' OR estimatedCostMicros NOT GLOB '0*')),
    "authorizationCostMicros" TEXT NOT NULL CHECK (authorizationCostMicros NOT GLOB '*[^0-9]*' AND length(authorizationCostMicros) >= 1 AND length(authorizationCostMicros) <= 19 AND (authorizationCostMicros = '0' OR authorizationCostMicros NOT GLOB '0*')),
    "containsUnboundedItem" BOOLEAN NOT NULL DEFAULT false,
    "budgetLimitMicros" TEXT CHECK ((budgetLimitMicros NOT GLOB '*[^0-9]*' AND length(budgetLimitMicros) >= 1 AND length(budgetLimitMicros) <= 19 AND (budgetLimitMicros = '0' OR budgetLimitMicros NOT GLOB '0*'))),
    "overBudget" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationCostQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "GenerationCostQuote_new" SELECT "id", "projectId", "userId", "operation", "configurationHash", "quoteFingerprint", "pricingHash", "pricingVersionSetJson", "itemsJson", "estimatedCostMicros", "authorizationCostMicros", "containsUnboundedItem", "budgetLimitMicros", "overBudget", "expiresAt", "consumedAt", "createdAt", "updatedAt" FROM "GenerationCostQuote";
DROP TABLE "GenerationCostQuote";
ALTER TABLE "GenerationCostQuote_new" RENAME TO "GenerationCostQuote";
CREATE INDEX "GenerationCostQuote_projectId_operation_idx" ON "GenerationCostQuote" ("projectId", "operation");

-- ============================================================================
-- 2) RunConfigurationSnapshot：quoteId 加外键；金额列加非负十进制整数 CHECK。
-- ============================================================================
CREATE TABLE "RunConfigurationSnapshot_new" (
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
    "estimatedCostMicros" TEXT CHECK ((estimatedCostMicros NOT GLOB '*[^0-9]*' AND length(estimatedCostMicros) >= 1 AND length(estimatedCostMicros) <= 19 AND (estimatedCostMicros = '0' OR estimatedCostMicros NOT GLOB '0*'))),
    "authorizationCostMicros" TEXT CHECK ((authorizationCostMicros NOT GLOB '*[^0-9]*' AND length(authorizationCostMicros) >= 1 AND length(authorizationCostMicros) <= 19 AND (authorizationCostMicros = '0' OR authorizationCostMicros NOT GLOB '0*'))),
    "budgetLimitMicros" TEXT CHECK ((budgetLimitMicros NOT GLOB '*[^0-9]*' AND length(budgetLimitMicros) >= 1 AND length(budgetLimitMicros) <= 19 AND (budgetLimitMicros = '0' OR budgetLimitMicros NOT GLOB '0*'))),
    "budgetOverrideAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "pricingHash" TEXT,
    "pricingVersionSetJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunConfigurationSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RunConfigurationSnapshot_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "GenerationCostQuote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "RunConfigurationSnapshot_new" SELECT "id", "projectId", "userId", "stage", "operation", "runId", "projectConfigurationRevision", "schemaVersion", "configurationHash", "resolvedConfigurationJson", "resolutionTraceJson", "quoteId", "quoteFingerprint", "estimatedCostMicros", "authorizationCostMicros", "budgetLimitMicros", "budgetOverrideAuthorized", "pricingHash", "pricingVersionSetJson", "createdAt", "updatedAt" FROM "RunConfigurationSnapshot";
DROP TABLE "RunConfigurationSnapshot";
ALTER TABLE "RunConfigurationSnapshot_new" RENAME TO "RunConfigurationSnapshot";
CREATE INDEX "RunConfigurationSnapshot_projectId_idx" ON "RunConfigurationSnapshot" ("projectId");

-- ============================================================================
-- 3) GenerationRun：quoteId 加外键（关联 GenerationCostQuote）。
-- ============================================================================
CREATE TABLE "GenerationRun_new" (
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
    CONSTRAINT "GenerationRun_runConfigurationSnapshotId_fkey" FOREIGN KEY ("runConfigurationSnapshotId") REFERENCES "RunConfigurationSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GenerationRun_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "GenerationCostQuote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "GenerationRun_new" SELECT "id", "projectId", "userId", "operation", "idempotencyKey", "payloadFingerprint", "quoteId", "runConfigurationSnapshotId", "dispatchPayloadJson", "status", "dispatchLeaseOwner", "dispatchLeaseExpiresAt", "dispatchClaimCount", "createdAt", "updatedAt" FROM "GenerationRun";
DROP TABLE "GenerationRun";
ALTER TABLE "GenerationRun_new" RENAME TO "GenerationRun";
CREATE INDEX "GenerationRun_projectId_status_idx" ON "GenerationRun" ("projectId", "status");

-- ============================================================================
-- 4) StoryboardSegmentOverride：storyboardRecordId 加外键。
-- ============================================================================
CREATE TABLE "StoryboardSegmentOverride_new" (
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
    CONSTRAINT "StoryboardSegmentOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryboardSegmentOverride_storyboardRecordId_fkey" FOREIGN KEY ("storyboardRecordId") REFERENCES "StoryboardRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "StoryboardSegmentOverride_new" SELECT "id", "projectId", "storyboardRecordId", "segmentId", "strategyOverride", "revision", "updatedByUserId", "createdAt", "updatedAt" FROM "StoryboardSegmentOverride";
DROP TABLE "StoryboardSegmentOverride";
ALTER TABLE "StoryboardSegmentOverride_new" RENAME TO "StoryboardSegmentOverride";
CREATE INDEX "StoryboardSegmentOverride_projectId_idx" ON "StoryboardSegmentOverride" ("projectId");

-- ============================================================================
-- 5) UsageCostRecord：assetProviderJobRecordId 加外键。
-- ============================================================================
CREATE TABLE "UsageCostRecord_new" (
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
    "estimatedCostMicros" TEXT NOT NULL CHECK (estimatedCostMicros NOT GLOB '*[^0-9]*' AND length(estimatedCostMicros) >= 1 AND length(estimatedCostMicros) <= 19 AND (estimatedCostMicros = '0' OR estimatedCostMicros NOT GLOB '0*')),
    "actualCostMicros" TEXT CHECK ((actualCostMicros NOT GLOB '*[^0-9]*' AND length(actualCostMicros) >= 1 AND length(actualCostMicros) <= 19 AND (actualCostMicros = '0' OR actualCostMicros NOT GLOB '0*'))),
    "costBasis" TEXT NOT NULL CHECK ("costBasis" IN ('estimate', 'provider_usage', 'provider_invoice')),
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UsageCostRecord_runConfigurationSnapshotId_providerRequestKey_attemptIndex_key" UNIQUE ("runConfigurationSnapshotId", "providerRequestKey", "attemptIndex"),
    CONSTRAINT "UsageCostRecord_runConfigurationSnapshotId_fkey" FOREIGN KEY ("runConfigurationSnapshotId") REFERENCES "RunConfigurationSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UsageCostRecord_assetProviderJobRecordId_fkey" FOREIGN KEY ("assetProviderJobRecordId") REFERENCES "AssetProviderJobRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "UsageCostRecord_new" SELECT "id", "runConfigurationSnapshotId", "assetProviderJobRecordId", "interactionId", "capability", "providerKey", "modelId", "providerRequestKey", "attemptIndex", "status", "unitType", "inputUnits", "outputUnits", "estimatedCostMicros", "actualCostMicros", "costBasis", "durationMs", "createdAt", "updatedAt" FROM "UsageCostRecord";
DROP TABLE "UsageCostRecord";
ALTER TABLE "UsageCostRecord_new" RENAME TO "UsageCostRecord";
CREATE INDEX "UsageCostRecord_runConfigurationSnapshotId_idx" ON "UsageCostRecord" ("runConfigurationSnapshotId");

-- ============================================================================
-- 6) AssetProviderJobRecord：加 generationRunId/providerRequestKey 列 + call-intent 部分唯一索引。
-- ============================================================================
ALTER TABLE "AssetProviderJobRecord" ADD COLUMN "generationRunId" TEXT;
ALTER TABLE "AssetProviderJobRecord" ADD COLUMN "providerRequestKey" TEXT;
-- 外部 provider call-intent 防重合同：同一 run 内同一稳定请求键同一 attempt 只能提交一次。
CREATE UNIQUE INDEX "AssetProviderJobRecord_generationRunId_providerRequestKey_attemptCount_key"
    ON "AssetProviderJobRecord" ("generationRunId", "providerRequestKey", "attemptCount")
    WHERE "generationRunId" IS NOT NULL AND "providerRequestKey" IS NOT NULL;
CREATE INDEX "AssetProviderJobRecord_generationRunId_idx" ON "AssetProviderJobRecord" ("generationRunId");

-- ============================================================================
-- 7) ProviderModelCatalog：partial unique index 防多个 active 默认项。
--    每个 capability 至多一个 active+isDefault=true 项（SQL 层硬约束）。
-- ============================================================================
CREATE UNIQUE INDEX "ProviderModelCatalog_capability_active_default_key"
    ON "ProviderModelCatalog" ("capability")
    WHERE "status" = 'active' AND "isDefault" = 1;

-- ============================================================================
-- 8) Seed 修正：active seed 与当前真实运行配置对齐。
--    媒体模型取自 assets-run.service.ts 当前默认；LLM provider 取自 providers.json
--    注册的真实 provider（deepseek/zhipu），model 取自当前 env 默认。
--    pricingJson 填入真实单价（微元/单位），pricingVersion 与任务 7 种子一致。
-- ============================================================================
UPDATE "ProviderModelCatalog" SET
    "modelId" = 'wan2.6-t2i',
    "displayName" = '万相文生图（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_image_micros":"10000","currency":"CNY","unit":"image"}'
WHERE "id" = 'image.generate.dashscope.wanx-v1';

UPDATE "ProviderModelCatalog" SET
    "modelId" = 'wan2.7-i2v-2026-04-25',
    "displayName" = '万相图生视频（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_second_micros":"5000","currency":"CNY","unit":"video_second"}'
WHERE "id" = 'video.image_to_video.dashscope.video-v1';

UPDATE "ProviderModelCatalog" SET
    "modelId" = 'qwen3-tts-instruct-flash',
    "displayName" = '通义千问 TTS（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_character_micros":"200","currency":"CNY","unit":"tts_character"}'
WHERE "id" = 'tts.synthesize.dashscope.qwen3-tts';

-- LLM：providers.json 只注册 deepseek/zhipu（无 dashscope），
-- 因此 LLM active 项必须映射到真实注册 provider + 当前 env 默认模型。
UPDATE "ProviderModelCatalog" SET
    "providerKey" = 'deepseek',
    "modelId" = 'deepseek-v4-pro',
    "displayName" = 'DeepSeek V4 Pro（Smart）',
    "pricingVersion" = 'llm-2026-08-13',
    "pricingJson" = '{"per_input_token_micros":"2","per_output_token_micros":"8","currency":"CNY","unit":"token"}'
WHERE "id" = 'llm.smart.dashscope.qwen-max';

UPDATE "ProviderModelCatalog" SET
    "providerKey" = 'zhipu',
    "modelId" = 'glm-4',
    "displayName" = '智谱 GLM-4（Flash）',
    "pricingVersion" = 'llm-2026-08-13',
    "pricingJson" = '{"per_input_token_micros":"1","per_output_token_micros":"4","currency":"CNY","unit":"token"}'
WHERE "id" = 'llm.flash.dashscope.qwen-flash';
