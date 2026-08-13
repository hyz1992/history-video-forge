-- S2-2A 任务 2 审查整改：金额约束、外键、call-intent 防重、seed 对齐。
-- 原则：不改写更早的 12090000 迁移；本迁移自身在 S2-2A 上线前可修订
--（DatabaseActivation 从未记录过本迁移，checksum 无失配风险）。
-- SQLite 的 ALTER TABLE 无法新增 CHECK/FK 约束，涉及约束的表用 12 步重建法保留数据。
-- 重建期间关闭外键检查，避免已有 GenerationRun 的 RESTRICT 外键阻止 DROP；
-- 重建完成后恢复并执行 foreign_key_check，任何不一致都让迁移失败而非静默损坏。

PRAGMA foreign_keys = OFF;

-- ============================================================================
-- 1) GenerationCostQuote：金额列加非负十进制整数 CHECK。
--    金额列保持 TEXT（十进制微元字符串），与 shared decimalMicrosString 一致
--    （全数字、无前导零；无长度限制，避免与 shared 合同冲突）。
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
    "estimatedCostMicros" TEXT NOT NULL CHECK (estimatedCostMicros NOT GLOB '*[^0-9]*' AND length(estimatedCostMicros) >= 1 AND (estimatedCostMicros = '0' OR estimatedCostMicros NOT GLOB '0*')),
    "authorizationCostMicros" TEXT NOT NULL CHECK (authorizationCostMicros NOT GLOB '*[^0-9]*' AND length(authorizationCostMicros) >= 1 AND (authorizationCostMicros = '0' OR authorizationCostMicros NOT GLOB '0*')),
    "containsUnboundedItem" BOOLEAN NOT NULL DEFAULT false,
    "budgetLimitMicros" TEXT CHECK (budgetLimitMicros IS NULL OR (budgetLimitMicros NOT GLOB '*[^0-9]*' AND length(budgetLimitMicros) >= 1 AND (budgetLimitMicros = '0' OR budgetLimitMicros NOT GLOB '0*'))),
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
    "estimatedCostMicros" TEXT CHECK (estimatedCostMicros IS NULL OR (estimatedCostMicros NOT GLOB '*[^0-9]*' AND length(estimatedCostMicros) >= 1 AND (estimatedCostMicros = '0' OR estimatedCostMicros NOT GLOB '0*'))),
    "authorizationCostMicros" TEXT CHECK (authorizationCostMicros IS NULL OR (authorizationCostMicros NOT GLOB '*[^0-9]*' AND length(authorizationCostMicros) >= 1 AND (authorizationCostMicros = '0' OR authorizationCostMicros NOT GLOB '0*'))),
    "budgetLimitMicros" TEXT CHECK (budgetLimitMicros IS NULL OR (budgetLimitMicros NOT GLOB '*[^0-9]*' AND length(budgetLimitMicros) >= 1 AND (budgetLimitMicros = '0' OR budgetLimitMicros NOT GLOB '0*'))),
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
-- 5) UsageCostRecord：assetProviderJobRecordId 加外键；金额列加非负十进制整数 CHECK。
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
    "estimatedCostMicros" TEXT NOT NULL CHECK (estimatedCostMicros NOT GLOB '*[^0-9]*' AND length(estimatedCostMicros) >= 1 AND (estimatedCostMicros = '0' OR estimatedCostMicros NOT GLOB '0*')),
    "actualCostMicros" TEXT CHECK (actualCostMicros IS NULL OR (actualCostMicros NOT GLOB '*[^0-9]*' AND length(actualCostMicros) >= 1 AND (actualCostMicros = '0' OR actualCostMicros NOT GLOB '0*'))),
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
-- 7) ProviderModelCatalog：部分唯一索引防多个 active 默认项；
--    触发器防零个 active 默认项（恰好一个的 SQL 层硬约束）。
-- ============================================================================
CREATE UNIQUE INDEX "ProviderModelCatalog_capability_active_default_key"
    ON "ProviderModelCatalog" ("capability")
    WHERE "status" = 'active' AND "isDefault" = 1;

-- 删除/降级默认项后，若某 capability 不再有 active 默认项 → 拒绝（P2-1）。
CREATE TRIGGER "trg_catalog_default_never_zero_delete" AFTER DELETE ON "ProviderModelCatalog"
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM "ProviderModelCatalog" WHERE "capability" = OLD."capability" AND "status" = 'active' AND "isDefault" = 1)
BEGIN
    SELECT RAISE(ABORT, 'catalog_default_missing: capability ' || OLD."capability" || ' has no active default entry');
END;

CREATE TRIGGER "trg_catalog_default_never_zero_update" AFTER UPDATE OF "status", "isDefault" ON "ProviderModelCatalog"
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM "ProviderModelCatalog" WHERE "capability" = NEW."capability" AND "status" = 'active' AND "isDefault" = 1)
BEGIN
    SELECT RAISE(ABORT, 'catalog_default_missing: capability ' || NEW."capability" || ' has no active default entry');
END;

-- ============================================================================
-- 8) 跨项目一致性数据库触发器（P1-2 数据库层最后防线）。
--    writer 层校验之外，任何绕过 writer 的写入也会被数据库拒绝。
-- ============================================================================

-- GenerationRun.projectId 必须等于其 snapshot 的项目（INSERT/UPDATE）。
CREATE TRIGGER "trg_run_snapshot_same_project_insert" AFTER INSERT ON "GenerationRun"
FOR EACH ROW
WHEN (SELECT "projectId" FROM "RunConfigurationSnapshot" WHERE "id" = NEW."runConfigurationSnapshotId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'generation_run_project_mismatch: run and snapshot must belong to the same project');
END;

CREATE TRIGGER "trg_run_snapshot_same_project_update" AFTER UPDATE OF "projectId", "runConfigurationSnapshotId" ON "GenerationRun"
FOR EACH ROW
WHEN (SELECT "projectId" FROM "RunConfigurationSnapshot" WHERE "id" = NEW."runConfigurationSnapshotId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'generation_run_project_mismatch: run and snapshot must belong to the same project');
END;

-- GenerationRun.projectId 必须等于其 quote 的项目（INSERT/UPDATE，quoteId 非空时）。
CREATE TRIGGER "trg_run_quote_same_project_insert" AFTER INSERT ON "GenerationRun"
FOR EACH ROW
WHEN NEW."quoteId" IS NOT NULL AND (SELECT "projectId" FROM "GenerationCostQuote" WHERE "id" = NEW."quoteId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'generation_run_project_mismatch: run and quote must belong to the same project');
END;

CREATE TRIGGER "trg_run_quote_same_project_update" AFTER UPDATE OF "projectId", "quoteId" ON "GenerationRun"
FOR EACH ROW
WHEN NEW."quoteId" IS NOT NULL AND (SELECT "projectId" FROM "GenerationCostQuote" WHERE "id" = NEW."quoteId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'generation_run_project_mismatch: run and quote must belong to the same project');
END;

-- RunConfigurationSnapshot.quoteId 引用的 quote 必须属于相同项目（INSERT/UPDATE）。
CREATE TRIGGER "trg_snapshot_quote_same_project_insert" AFTER INSERT ON "RunConfigurationSnapshot"
FOR EACH ROW
WHEN NEW."quoteId" IS NOT NULL AND (SELECT "projectId" FROM "GenerationCostQuote" WHERE "id" = NEW."quoteId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'snapshot_quote_project_mismatch: snapshot and quote must belong to the same project');
END;

CREATE TRIGGER "trg_snapshot_quote_same_project_update" AFTER UPDATE OF "projectId", "quoteId" ON "RunConfigurationSnapshot"
FOR EACH ROW
WHEN NEW."quoteId" IS NOT NULL AND (SELECT "projectId" FROM "GenerationCostQuote" WHERE "id" = NEW."quoteId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'snapshot_quote_project_mismatch: snapshot and quote must belong to the same project');
END;

-- StoryboardSegmentOverride.projectId 必须等于其 storyboard 的项目。
CREATE TRIGGER "trg_override_storyboard_same_project_insert" AFTER INSERT ON "StoryboardSegmentOverride"
FOR EACH ROW
WHEN (SELECT "projectId" FROM "StoryboardRecord" WHERE "id" = NEW."storyboardRecordId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'storyboard_override_project_mismatch: override and storyboard must belong to the same project');
END;

CREATE TRIGGER "trg_override_storyboard_same_project_update" AFTER UPDATE OF "projectId", "storyboardRecordId" ON "StoryboardSegmentOverride"
FOR EACH ROW
WHEN (SELECT "projectId" FROM "StoryboardRecord" WHERE "id" = NEW."storyboardRecordId") != NEW."projectId"
BEGIN
    SELECT RAISE(ABORT, 'storyboard_override_project_mismatch: override and storyboard must belong to the same project');
END;

-- ============================================================================
-- 9) Seed 修正：active seed 与当前真实运行配置对齐。
--    媒体单价取自 frontend/src/utils/pricing.ts（仓库单一价格源）：
--    图片 ¥0.20/张 = 200000 micros；视频 720P ¥0.60/秒 = 600000 micros；
--    TTS ¥0.80/万字 = 80 micros/字符。
--    LLM 的 providers.json 注册 deepseek/zhipu，但可信 token 单价属于任务 7
--    PricingService，这里标注 estimate + pending_task7，报价服务在任务 7 前
--    不得把 LLM 价格当作可信授权上界（unbounded）。
-- ============================================================================
UPDATE "ProviderModelCatalog" SET
    "modelId" = 'wan2.6-t2i',
    "displayName" = '万相文生图（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_image_micros":"200000","currency":"CNY","unit":"image","source":"frontend/src/utils/pricing.ts","effective_from":"2026-08-13"}'
WHERE "id" = 'image.generate.dashscope.wanx-v1';

UPDATE "ProviderModelCatalog" SET
    "modelId" = 'wan2.7-i2v-2026-04-25',
    "displayName" = '万相图生视频（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_second_micros":"600000","resolution":"standard_720p","currency":"CNY","unit":"video_second","source":"frontend/src/utils/pricing.ts","effective_from":"2026-08-13"}'
WHERE "id" = 'video.image_to_video.dashscope.video-v1';

UPDATE "ProviderModelCatalog" SET
    "modelId" = 'qwen3-tts-instruct-flash',
    "displayName" = '通义千问 TTS（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_character_micros":"80","currency":"CNY","unit":"tts_character","source":"frontend/src/utils/pricing.ts","effective_from":"2026-08-13"}'
WHERE "id" = 'tts.synthesize.dashscope.qwen3-tts';

-- LLM：providers.json 只注册 deepseek/zhipu（无 dashscope），
-- 因此 LLM active 项必须映射到真实注册 provider + 当前 env 默认模型。
-- token 单价在任务 7 PricingService 落地前为 estimate，不得作为可信授权上界。
UPDATE "ProviderModelCatalog" SET
    "providerKey" = 'deepseek',
    "modelId" = 'deepseek-v4-pro',
    "displayName" = 'DeepSeek V4 Pro（Smart）',
    "pricingVersion" = 'llm-2026-08-13',
    "pricingJson" = '{"per_input_token_micros":"2","per_output_token_micros":"8","currency":"CNY","unit":"token","confidence":"estimate","note":"pending_task7_pricing_service"}'
WHERE "id" = 'llm.smart.dashscope.qwen-max';

UPDATE "ProviderModelCatalog" SET
    "providerKey" = 'zhipu',
    "modelId" = 'glm-4',
    "displayName" = '智谱 GLM-4（Flash）',
    "pricingVersion" = 'llm-2026-08-13',
    "pricingJson" = '{"per_input_token_micros":"1","per_output_token_micros":"4","currency":"CNY","unit":"token","confidence":"estimate","note":"pending_task7_pricing_service"}'
WHERE "id" = 'llm.flash.dashscope.qwen-flash';

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
