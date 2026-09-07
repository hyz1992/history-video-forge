CREATE TABLE "ScriptConfirmation" (
  "scriptRecordId" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sourceTextSha256" TEXT NOT NULL CHECK(length("sourceTextSha256") = 64 AND "sourceTextSha256" NOT GLOB '*[^0-9a-f]*'),
  "confirmedBy" TEXT NOT NULL CHECK(length(trim("confirmedBy")) > 0),
  "confirmedAt" DATETIME NOT NULL,
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("scriptRecordId") REFERENCES "ScriptRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScriptConfirmation_projectId_idx" ON "ScriptConfirmation"("projectId");
CREATE TRIGGER "ScriptConfirmation_project_insert" BEFORE INSERT ON "ScriptConfirmation"
BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "ScriptRecord" WHERE "id" = NEW."scriptRecordId" AND "projectId" = NEW."projectId") THEN RAISE(ABORT, 'script_confirmation_project_mismatch') END; END;
CREATE TRIGGER "ScriptConfirmation_project_update" BEFORE UPDATE ON "ScriptConfirmation"
BEGIN SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "ScriptRecord" WHERE "id" = NEW."scriptRecordId" AND "projectId" = NEW."projectId") THEN RAISE(ABORT, 'script_confirmation_project_mismatch') END; END;
