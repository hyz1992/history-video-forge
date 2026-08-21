-- S2-2B：音色库迁入数据库（详细设计 §6.4，外部审查 P1-4）
-- 公共（preset/system）与用户私有（generated）档案分离；SQL 层硬约束 kind/visibility/providerStatus。

CREATE TABLE "VoiceProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('preset','generated','system')),
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public' CHECK ("visibility" IN ('public','private')),
    "providerName" TEXT NOT NULL,
    "providerVoiceId" TEXT,
    "providerStatus" TEXT NOT NULL CHECK ("providerStatus" IN ('missing','creating','ready','failed','deleted')),
    "targetModel" TEXT NOT NULL,
    "previewAudioUri" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" DATETIME,
    "qualityScore" REAL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "VoiceProfile_ownerId_visibility_idx" ON "VoiceProfile"("ownerId", "visibility");
