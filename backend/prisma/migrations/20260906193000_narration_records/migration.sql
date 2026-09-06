-- 增量迁移：旧项目与关闭功能时的新项目保留估时模式。
ALTER TABLE "Project" ADD COLUMN "narrationTimingMode" TEXT NOT NULL DEFAULT 'legacy_estimated' CHECK ("narrationTimingMode" IN ('legacy_estimated','narration_first_v1'));
ALTER TABLE "Project" ADD COLUMN "activeNarrationRecordId" TEXT REFERENCES "NarrationRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD COLUMN "activeNarrationSubtitleRevisionId" TEXT REFERENCES "NarrationSubtitleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "NarrationRecord" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "scriptRecordId" TEXT NOT NULL,
 "generationRunId" TEXT NOT NULL, "configurationSnapshotId" TEXT NOT NULL,
 "schemaVersion" TEXT NOT NULL CHECK ("schemaVersion" = 'narration_record_v1'),
 "sourceTextSha256" TEXT NOT NULL, "spokenTextSha256" TEXT,
 "settingsSha256" TEXT NOT NULL, "sourceProjectTtsSettingsSha256" TEXT NOT NULL,
 "textMappingVersion" TEXT NOT NULL, "settingsJson" JSONB NOT NULL,
 "timingSource" TEXT NOT NULL CHECK ("timingSource" = 'provider_native'),
 "providerTaskId" TEXT, "providerRequestId" TEXT,
 "status" TEXT NOT NULL CHECK ("status" IN ('generating','ready','confirmed','failed','cancelled','stale','unknown')),
 "errorCode" TEXT, "confirmedAt" DATETIME, "confirmedBy" TEXT,
 "acceptedDurationBandSnapshotJson" JSONB, "outputJson" JSONB,
 "initialSubtitleRevisionId" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("scriptRecordId") REFERENCES "ScriptRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("generationRunId") REFERENCES "GenerationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("configurationSnapshotId") REFERENCES "RunConfigurationSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("initialSubtitleRevisionId") REFERENCES "NarrationSubtitleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CHECK ("status" NOT IN ('ready','confirmed') OR ("outputJson" IS NOT NULL AND "spokenTextSha256" IS NOT NULL AND "providerTaskId" IS NOT NULL AND "providerRequestId" IS NOT NULL AND "initialSubtitleRevisionId" IS NOT NULL)),
 CHECK ("status" != 'generating' OR "outputJson" IS NULL),
 CHECK (("confirmedAt" IS NULL) = ("confirmedBy" IS NULL)),
 CHECK ("status" != 'confirmed' OR ("confirmedAt" IS NOT NULL AND "acceptedDurationBandSnapshotJson" IS NOT NULL)),
 CHECK ("status" NOT IN ('failed','unknown') OR "errorCode" IS NOT NULL)
);
CREATE UNIQUE INDEX "NarrationRecord_generationRunId_key" ON "NarrationRecord"("generationRunId");
CREATE UNIQUE INDEX "NarrationRecord_initialSubtitleRevisionId_key" ON "NarrationRecord"("initialSubtitleRevisionId");
CREATE INDEX "NarrationRecord_projectId_scriptRecordId_createdAt_idx" ON "NarrationRecord"("projectId","scriptRecordId","createdAt");
CREATE TABLE "NarrationSubtitleRevision" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "narrationRecordId" TEXT NOT NULL,
 "audioHash" TEXT NOT NULL, "timingHash" TEXT NOT NULL, "subtitleSettingsSnapshotJson" JSONB NOT NULL,
 "subtitleSettingsHash" TEXT NOT NULL, "builderVersion" TEXT NOT NULL, "srtJson" JSONB NOT NULL, "vttJson" JSONB NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("narrationRecordId") REFERENCES "NarrationRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NarrationSubtitleRevision_narrationRecordId_subtitleSettingsHash_builderVersion_key" ON "NarrationSubtitleRevision"("narrationRecordId","subtitleSettingsHash","builderVersion");
CREATE INDEX "NarrationSubtitleRevision_projectId_createdAt_idx" ON "NarrationSubtitleRevision"("projectId","createdAt");

CREATE TRIGGER "narration_source_insert" BEFORE INSERT ON "NarrationRecord" BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "ScriptRecord" WHERE id=NEW.scriptRecordId AND projectId=NEW.projectId)
 OR NOT EXISTS (SELECT 1 FROM "GenerationRun" WHERE id=NEW.generationRunId AND projectId=NEW.projectId AND runConfigurationSnapshotId=NEW.configurationSnapshotId)
 OR NOT EXISTS (SELECT 1 FROM "RunConfigurationSnapshot" WHERE id=NEW.configurationSnapshotId AND projectId=NEW.projectId)
 THEN RAISE(ABORT, 'narration_source_project_mismatch') END; END;

CREATE TRIGGER "narration_source_update" BEFORE UPDATE ON "NarrationRecord" BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "ScriptRecord" WHERE id=NEW.scriptRecordId AND projectId=NEW.projectId)
 OR NOT EXISTS (SELECT 1 FROM "GenerationRun" WHERE id=NEW.generationRunId AND projectId=NEW.projectId AND runConfigurationSnapshotId=NEW.configurationSnapshotId)
 OR NOT EXISTS (SELECT 1 FROM "RunConfigurationSnapshot" WHERE id=NEW.configurationSnapshotId AND projectId=NEW.projectId)
 THEN RAISE(ABORT, 'narration_source_project_mismatch') END; END;

CREATE TRIGGER "project_active_narration_insert" BEFORE INSERT ON "Project" BEGIN SELECT CASE WHEN NEW.activeNarrationRecordId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "NarrationRecord" WHERE id=NEW.activeNarrationRecordId AND projectId=NEW.id AND outputJson IS NOT NULL)
 THEN RAISE(ABORT, 'project_active_narration_mismatch') END;
 SELECT CASE WHEN NEW.activeNarrationSubtitleRevisionId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "NarrationSubtitleRevision" AS subtitle JOIN "NarrationRecord" AS narration ON narration.id=subtitle.narrationRecordId
 WHERE subtitle.id=NEW.activeNarrationSubtitleRevisionId AND subtitle.projectId=NEW.id AND subtitle.narrationRecordId=NEW.activeNarrationRecordId
 AND subtitle.audioHash=json_extract(narration.outputJson,'$.audio.sha256') AND subtitle.timingHash=json_extract(narration.outputJson,'$.timingMap.sha256'))
 THEN RAISE(ABORT, 'project_active_narration_subtitle_mismatch') END; END;

CREATE TRIGGER "project_active_narration_update" BEFORE UPDATE ON "Project" BEGIN SELECT CASE WHEN NEW.activeNarrationRecordId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "NarrationRecord" WHERE id=NEW.activeNarrationRecordId AND projectId=NEW.id AND outputJson IS NOT NULL)
 THEN RAISE(ABORT, 'project_active_narration_mismatch') END;
 SELECT CASE WHEN NEW.activeNarrationSubtitleRevisionId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "NarrationSubtitleRevision" AS subtitle JOIN "NarrationRecord" AS narration ON narration.id=subtitle.narrationRecordId
 WHERE subtitle.id=NEW.activeNarrationSubtitleRevisionId AND subtitle.projectId=NEW.id AND subtitle.narrationRecordId=NEW.activeNarrationRecordId
 AND subtitle.audioHash=json_extract(narration.outputJson,'$.audio.sha256') AND subtitle.timingHash=json_extract(narration.outputJson,'$.timingMap.sha256'))
 THEN RAISE(ABORT, 'project_active_narration_subtitle_mismatch') END; END;

-- 来源在创建时冻结；状态/确认信息由后续事务编排单独更新。
CREATE TRIGGER "narration_source_immutable" BEFORE UPDATE ON "NarrationRecord"
WHEN NEW.id IS NOT OLD.id OR NEW.projectId IS NOT OLD.projectId OR NEW.scriptRecordId IS NOT OLD.scriptRecordId
 OR NEW.generationRunId IS NOT OLD.generationRunId OR NEW.configurationSnapshotId IS NOT OLD.configurationSnapshotId
 OR NEW.schemaVersion IS NOT OLD.schemaVersion OR NEW.sourceTextSha256 IS NOT OLD.sourceTextSha256
 OR NEW.settingsSha256 IS NOT OLD.settingsSha256 OR NEW.sourceProjectTtsSettingsSha256 IS NOT OLD.sourceProjectTtsSettingsSha256
 OR NEW.textMappingVersion IS NOT OLD.textMappingVersion OR NEW.settingsJson IS NOT OLD.settingsJson
 OR NEW.timingSource IS NOT OLD.timingSource OR NEW.createdAt IS NOT OLD.createdAt
BEGIN SELECT RAISE(ABORT, 'narration_source_immutable'); END;
CREATE TRIGGER "narration_output_immutable" BEFORE UPDATE ON "NarrationRecord"
WHEN OLD.outputJson IS NOT NULL AND (NEW.outputJson IS NOT OLD.outputJson OR NEW.initialSubtitleRevisionId IS NOT OLD.initialSubtitleRevisionId
 OR NEW.spokenTextSha256 IS NOT OLD.spokenTextSha256 OR NEW.providerTaskId IS NOT OLD.providerTaskId OR NEW.providerRequestId IS NOT OLD.providerRequestId)
BEGIN SELECT RAISE(ABORT, 'narration_output_immutable'); END;
CREATE TRIGGER "narration_subtitle_immutable" BEFORE UPDATE ON "NarrationSubtitleRevision"
BEGIN SELECT RAISE(ABORT, 'narration_subtitle_immutable'); END;
CREATE TRIGGER "narration_subtitle_source_insert" BEFORE INSERT ON "NarrationSubtitleRevision"
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "NarrationRecord" WHERE id=NEW.narrationRecordId AND projectId=NEW.projectId)
 THEN RAISE(ABORT, 'narration_subtitle_source_mismatch') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM "NarrationRecord" WHERE id=NEW.narrationRecordId AND outputJson IS NOT NULL
 AND (json_extract(outputJson,'$.audio.sha256') IS NOT NEW.audioHash OR json_extract(outputJson,'$.timingMap.sha256') IS NOT NEW.timingHash))
 THEN RAISE(ABORT, 'narration_subtitle_source_mismatch') END;
END;
CREATE TRIGGER "narration_initial_subtitle_update" BEFORE UPDATE ON "NarrationRecord"
WHEN OLD.outputJson IS NULL AND NEW.outputJson IS NOT NULL
BEGIN
 SELECT CASE WHEN json_extract(NEW.outputJson,'$.initialSubtitleRevisionId') IS NOT NEW.initialSubtitleRevisionId
 OR NOT EXISTS (SELECT 1 FROM "NarrationSubtitleRevision" WHERE id=NEW.initialSubtitleRevisionId AND projectId=NEW.projectId AND narrationRecordId=NEW.id
 AND audioHash=json_extract(NEW.outputJson,'$.audio.sha256') AND timingHash=json_extract(NEW.outputJson,'$.timingMap.sha256'))
 THEN RAISE(ABORT, 'narration_initial_subtitle_mismatch') END;
 -- 先前暂存的非initial行同样受最终输出约束，不能因写入顺序变为错误来源字幕。
 SELECT CASE WHEN EXISTS (SELECT 1 FROM "NarrationSubtitleRevision" WHERE narrationRecordId=NEW.id
 AND (projectId IS NOT NEW.projectId OR audioHash IS NOT json_extract(NEW.outputJson,'$.audio.sha256') OR timingHash IS NOT json_extract(NEW.outputJson,'$.timingMap.sha256')))
 THEN RAISE(ABORT, 'narration_subtitle_source_mismatch') END;
END;

-- 完整bundle必须经过同事务「候选→字幕→ready」，禁止INSERT绕过初始字幕归属校验。
CREATE TRIGGER "narration_initial_subtitle_insert" BEFORE INSERT ON "NarrationRecord"
WHEN NEW.outputJson IS NOT NULL OR NEW.initialSubtitleRevisionId IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'narration_initial_subtitle_requires_ready_transaction'); END;
