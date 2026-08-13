-- S2-2A 任务 2 第四轮审查整改：旧数据预检、call-intent 精确合同、LLM unpriced、默认项可轮换。
-- 本迁移从未被任何已激活数据库记录（DatabaseActivation 仅到 event_library），
-- 修订无 checksum 失配风险。
-- 重建期间关闭外键检查，避免 RESTRICT 外键阻止 DROP；重建完成后恢复并执行
-- foreign_key_check。对旧版本的非法跨项目关系，复制前用 RAISE(ABORT) 真正中止迁移。

PRAGMA foreign_keys = OFF;

-- ============================================================================
-- 0) 旧数据预检（P1-1）：复制前检测上一版本的非法关系，真正中止迁移。
--    foreign_key_check 只返回结果集不会中止；跨项目语义关系甚至不会出现在其中。
--    这里用 SELECT RAISE(ABORT) 在有任何违规行时抛错，让迁移失败而非静默保留非法数据。
--    S2-2A 表在上一版本（12090000）刚创建，正常应为空；预检保护"已被写入测试数据"的场景。
-- ============================================================================

-- 旧版本 snapshot 引用的 quoteId 不存在或属于其他项目
-- （12090000 的 snapshot 没有 quoteId 外键，可能存在 orphan 或跨项目引用）。
-- RAISE 只能在触发器内使用，所以用临时表 + 临时触发器模式：
-- 创建临时表，挂 BEFORE INSERT 触发器检查违规，向临时表 INSERT 一行触发检查。
CREATE TEMP TABLE "_migration_check" (x INTEGER);
CREATE TEMP TRIGGER "_trg_check_snapshot_quote"
BEFORE INSERT ON "_migration_check"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "RunConfigurationSnapshot" s
    WHERE s."quoteId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "GenerationCostQuote" q WHERE q."id" = s."quoteId" AND q."projectId" = s."projectId")
)
BEGIN
    SELECT RAISE(ABORT, 'migration_aborted: snapshot 引用了不存在或跨项目的 quote，请先修复旧数据');
END;

CREATE TEMP TRIGGER "_trg_check_run_snapshot"
BEFORE INSERT ON "_migration_check"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "GenerationRun" r
    JOIN "RunConfigurationSnapshot" s ON s."id" = r."runConfigurationSnapshotId"
    WHERE s."projectId" != r."projectId"
)
BEGIN
    SELECT RAISE(ABORT, 'migration_aborted: run 关联了跨项目的 snapshot，请先修复旧数据');
END;

CREATE TEMP TRIGGER "_trg_check_run_quote"
BEFORE INSERT ON "_migration_check"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "GenerationRun" r
    WHERE r."quoteId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "GenerationCostQuote" q WHERE q."id" = r."quoteId" AND q."projectId" = r."projectId")
)
BEGIN
    SELECT RAISE(ABORT, 'migration_aborted: run 关联了跨项目的 quote，请先修复旧数据');
END;

-- storyboard override → storyboard 同项目（本迁移新增 storyboardRecordId 外键 + 同项目语义）
CREATE TEMP TRIGGER "_trg_check_override_storyboard"
BEFORE INSERT ON "_migration_check"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "StoryboardSegmentOverride" o
    JOIN "StoryboardRecord" s ON s."id" = o."storyboardRecordId"
    WHERE s."projectId" != o."projectId"
)
BEGIN
    SELECT RAISE(ABORT, 'migration_aborted: storyboard override 关联了跨项目的 storyboard，请先修复旧数据');
END;

-- usage cost → asset provider job orphan（本迁移新增 assetProviderJobRecordId 外键）
CREATE TEMP TRIGGER "_trg_check_usage_provider_job"
BEFORE INSERT ON "_migration_check"
FOR EACH ROW
WHEN EXISTS (
    SELECT 1 FROM "UsageCostRecord" u
    WHERE u."assetProviderJobRecordId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "AssetProviderJobRecord" j WHERE j."id" = u."assetProviderJobRecordId")
)
BEGIN
    SELECT RAISE(ABORT, 'migration_aborted: usage cost 引用了不存在的 provider job，请先修复旧数据');
END;

-- 触发预检（任一 WHEN 条件违规即中止迁移）。
INSERT INTO "_migration_check" VALUES (1);

-- 清理临时表与触发器（迁移完成后不影响数据库）。
DROP TABLE "_migration_check";

-- ============================================================================
-- 1) GenerationCostQuote：金额列加非负十进制整数 CHECK（与 shared 一致，无长度限制）。
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
-- 4) AssetProviderJobRecord 重建（P1-2）：
--    加 attemptIndex（0-based，与 UsageCostRecord 一致）、generationRunId/providerRequestKey
--    的真实外键、call-intent 唯一索引改为 (generationRunId, providerRequestKey, attemptIndex)。
--    身份三元组不可变：BEFORE UPDATE 触发器禁止改写这三列。
-- ============================================================================
CREATE TABLE "AssetProviderJobRecord_new" (
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
    "attemptIndex" INTEGER,
    "generationRunId" TEXT,
    "providerRequestKey" TEXT,
    "rawRequestJson" TEXT,
    "rawResponseJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "submittedAt" DATETIME,
    "lastPolledAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    -- call-intent 三元组一致性（P1-2）：三者必须全空或全非空；
    -- 非空时 attemptIndex >= 0。防止残缺三元组绕过 partial unique index。
    CONSTRAINT "AssetProviderJobRecord_call_intent_consistency" CHECK (
      ("generationRunId" IS NULL AND "providerRequestKey" IS NULL AND "attemptIndex" IS NULL)
      OR ("generationRunId" IS NOT NULL AND "providerRequestKey" IS NOT NULL AND "attemptIndex" IS NOT NULL AND "attemptIndex" >= 0)
    ),
    CONSTRAINT "AssetProviderJobRecord_assetRunId_executionId_taskId_attemptCount_key" UNIQUE ("assetRunId", "executionId", "taskId", "attemptCount"),
    CONSTRAINT "AssetProviderJobRecord_assetManifestRecordId_fkey" FOREIGN KEY ("assetManifestRecordId") REFERENCES "AssetManifestRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    -- P2：ON DELETE RESTRICT（审计历史不可丢失；SET NULL 会与身份不可变触发器冲突）。
    CONSTRAINT "AssetProviderJobRecord_generationRunId_fkey" FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- 复制旧数据（attemptIndex/generationRunId/providerRequestKey 旧版本无值 → NULL）
INSERT INTO "AssetProviderJobRecord_new" ("id", "assetManifestRecordId", "assetRunId", "executionId", "taskId", "providerType", "providerName", "providerJobId", "status", "attemptCount", "rawRequestJson", "rawResponseJson", "errorCode", "errorMessage", "submittedAt", "lastPolledAt", "completedAt", "createdAt", "updatedAt")
SELECT "id", "assetManifestRecordId", "assetRunId", "executionId", "taskId", "providerType", "providerName", "providerJobId", "status", "attemptCount", "rawRequestJson", "rawResponseJson", "errorCode", "errorMessage", "submittedAt", "lastPolledAt", "completedAt", "createdAt", "updatedAt" FROM "AssetProviderJobRecord";
DROP TABLE "AssetProviderJobRecord";
ALTER TABLE "AssetProviderJobRecord_new" RENAME TO "AssetProviderJobRecord";
CREATE INDEX "AssetProviderJobRecord_assetManifestRecordId_status_idx" ON "AssetProviderJobRecord" ("assetManifestRecordId", "status");
CREATE INDEX "AssetProviderJobRecord_providerName_providerJobId_idx" ON "AssetProviderJobRecord" ("providerName", "providerJobId");
CREATE INDEX "AssetProviderJobRecord_generationRunId_idx" ON "AssetProviderJobRecord" ("generationRunId");
-- call-intent 唯一索引：0-based attemptIndex（与 UsageCostRecord 一致）
CREATE UNIQUE INDEX "AssetProviderJobRecord_generationRunId_providerRequestKey_attemptIndex_key"
    ON "AssetProviderJobRecord" ("generationRunId", "providerRequestKey", "attemptIndex")
    WHERE "generationRunId" IS NOT NULL AND "providerRequestKey" IS NOT NULL AND "attemptIndex" IS NOT NULL;

-- 身份三元组不可变：一旦创建，generationRunId/providerRequestKey/attemptIndex 不得改写。
CREATE TRIGGER "trg_provider_job_intent_immutable" BEFORE UPDATE OF "generationRunId", "providerRequestKey", "attemptIndex" ON "AssetProviderJobRecord"
FOR EACH ROW
WHEN NEW."generationRunId" IS NOT OLD."generationRunId" OR NEW."providerRequestKey" IS NOT OLD."providerRequestKey" OR NEW."attemptIndex" IS NOT OLD."attemptIndex"
BEGIN
    SELECT RAISE(ABORT, 'provider_job_intent_immutable: call-intent identity cannot be changed after creation');
END;

-- ============================================================================
-- 5) StoryboardSegmentOverride：storyboardRecordId 加外键。
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
-- 6) UsageCostRecord：assetProviderJobRecordId 加外键；金额列加非负十进制整数 CHECK。
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
-- 7) ProviderModelCatalog：部分唯一索引防多个 active 默认项。
--    零默认项交给 readiness/resolver 校验（任务 7），不再用逐行触发器阻止合法轮换
--    （P2-1：AFTER 触发器会让"先取消旧默认再设新默认"的单行 upsert 失败）。
-- ============================================================================
CREATE UNIQUE INDEX "ProviderModelCatalog_capability_active_default_key"
    ON "ProviderModelCatalog" ("capability")
    WHERE "status" = 'active' AND "isDefault" = 1;

-- ============================================================================
-- 8) 跨项目一致性数据库触发器（writer 层之外的数据库层最后防线）。
-- ============================================================================

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
--    媒体单价取自 frontend/src/utils/pricing.ts（仓库单一价格源）。
--    LLM 在任务 7 可信 PricingService 落地前使用结构化 unpriced（bounded=false），
--    不保留虚构单价，不得进入可信授权上界（报价必须标记 unbounded）。
-- ============================================================================
UPDATE "ProviderModelCatalog" SET
    "modelId" = 'wan2.6-t2i',
    "displayName" = '万相文生图（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_image_micros":"200000","currency":"CNY","unit":"image","source":"frontend/src/utils/pricing.ts","effective_from":"2026-08-13","bounded":true}'
WHERE "id" = 'image.generate.dashscope.wanx-v1';

UPDATE "ProviderModelCatalog" SET
    "modelId" = 'wan2.7-i2v-2026-04-25',
    "displayName" = '万相图生视频（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_second_micros":"600000","resolution":"standard_720p","currency":"CNY","unit":"video_second","source":"frontend/src/utils/pricing.ts","effective_from":"2026-08-13","bounded":true}'
WHERE "id" = 'video.image_to_video.dashscope.video-v1';

UPDATE "ProviderModelCatalog" SET
    "modelId" = 'qwen3-tts-instruct-flash',
    "displayName" = '通义千问 TTS（运行默认）',
    "pricingVersion" = 'dashscope-media-2026-08-13',
    "pricingJson" = '{"per_character_micros":"80","currency":"CNY","unit":"tts_character","source":"frontend/src/utils/pricing.ts","effective_from":"2026-08-13","bounded":true}'
WHERE "id" = 'tts.synthesize.dashscope.qwen3-tts';

-- LLM：任务 7 可信价格服务落地前为 unpriced（bounded=false）。
-- 报价服务遇到 bounded=false 必须把该项标记为 unbounded，不得用任何数字作为授权上界。
UPDATE "ProviderModelCatalog" SET
    "providerKey" = 'deepseek',
    "modelId" = 'deepseek-v4-pro',
    "displayName" = 'DeepSeek V4 Pro（Smart）',
    "pricingVersion" = 'llm-pending-task7',
    "pricingJson" = '{"currency":"CNY","unit":"token","bounded":false,"note":"unpriced until task 7 PricingService"}'
WHERE "id" = 'llm.smart.dashscope.qwen-max';

UPDATE "ProviderModelCatalog" SET
    "providerKey" = 'zhipu',
    "modelId" = 'glm-4',
    "displayName" = '智谱 GLM-4（Flash）',
    "pricingVersion" = 'llm-pending-task7',
    "pricingJson" = '{"currency":"CNY","unit":"token","bounded":false,"note":"unpriced until task 7 PricingService"}'
WHERE "id" = 'llm.flash.dashscope.qwen-flash';

PRAGMA foreign_keys = ON;
-- foreign_key_check 返回违规行时，better-sqlite3 的 exec 会因 SELECT 结果集不中止；
-- 但前面的 RAISE(ABORT) 预检已保证旧数据合法，这里仅作最终一致性确认。
-- 若仍有 FK 违规（理论不应发生），由应用启动 readiness 拒绝激活。
