-- CreateTable EventLibraryEntry
CREATE TABLE "EventLibraryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventRegistryEntryId" TEXT NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "dynasty" TEXT,
    "era" TEXT,
    "characterTagsJson" TEXT NOT NULL DEFAULT '[]',
    "eventTypeTagsJson" TEXT NOT NULL DEFAULT '[]',
    "conflictTypeTagsJson" TEXT NOT NULL DEFAULT '[]',
    "themeMotifsJson" TEXT NOT NULL DEFAULT '[]',
    "timeRangeJson" TEXT,
    "locationTagsJson" TEXT NOT NULL DEFAULT '[]',
    "relationshipTagsJson" TEXT NOT NULL DEFAULT '[]',
    "sourceAnchorRefsJson" TEXT NOT NULL DEFAULT '[]',
    "credibilityLevel" TEXT NOT NULL DEFAULT 'medium' CHECK ("credibilityLevel" IN ('high', 'medium', 'low', 'disputed')),
    "disputeNotes" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public' CHECK ("visibility" IN ('public', 'private')),
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('curated', 'pending_review', 'rejected', 'draft', 'archived')),
    "ownerId" TEXT,
    "originKind" TEXT NOT NULL DEFAULT 'builtin' CHECK ("originKind" IN ('builtin', 'admin', 'recommendation_reflux', 'custom')),
    "originRefJson" TEXT,
    "libraryFingerprint" TEXT NOT NULL,
    "filePath" TEXT,
    "fileContentHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventLibraryEntry_libraryFingerprint_key" UNIQUE ("libraryFingerprint"),
    CONSTRAINT "EventLibraryEntry_eventRegistryEntryId_fkey" FOREIGN KEY ("eventRegistryEntryId") REFERENCES "EventRegistryEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventLibraryEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable EventLibraryAngle
CREATE TABLE "EventLibraryAngle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventLibraryEntryId" TEXT NOT NULL,
    "angleLabel" TEXT NOT NULL,
    "familyLabel" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL DEFAULT 'standard',
    "angleFingerprint" TEXT NOT NULL,
    "riskHintsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventLibraryAngle_eventLibraryEntryId_angleFingerprint_key" UNIQUE ("eventLibraryEntryId", "angleFingerprint"),
    CONSTRAINT "EventLibraryAngle_eventLibraryEntryId_fkey" FOREIGN KEY ("eventLibraryEntryId") REFERENCES "EventLibraryEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable EventLibraryDraft
CREATE TABLE "EventLibraryDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftKind" TEXT NOT NULL CHECK ("draftKind" IN ('recommendation_reflux', 'custom')),
    "projectId" TEXT NOT NULL,
    "candidateFingerprint" TEXT,
    "eventRegistryEntryId" TEXT,
    "proposedTitle" TEXT NOT NULL,
    "proposedSummary" TEXT NOT NULL,
    "proposedAnglesJson" TEXT NOT NULL DEFAULT '[]',
    "proposedTagsJson" TEXT NOT NULL DEFAULT '[]',
    "rawCustomDigest" TEXT,
    "customRefinedEventJson" TEXT,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'pending_review', 'approved', 'rejected')),
    "reviewerId" TEXT,
    "reviewedAt" DATETIME,
    "reviewNotes" TEXT,
    "mergedEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventLibraryDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventLibraryDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventLibraryDraft_mergedEntryId_fkey" FOREIGN KEY ("mergedEntryId") REFERENCES "EventLibraryEntry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EventLibraryDraft_reflux_fingerprint_required" CHECK ("draftKind" != 'recommendation_reflux' OR "candidateFingerprint" IS NOT NULL)
);

-- CreateIndex
CREATE INDEX "EventLibraryEntry_status_visibility_idx" ON "EventLibraryEntry"("status", "visibility");
CREATE INDEX "EventLibraryEntry_dynasty_idx" ON "EventLibraryEntry"("dynasty");
CREATE INDEX "EventLibraryEntry_status_ownerId_idx" ON "EventLibraryEntry"("status", "ownerId");
CREATE INDEX "EventLibraryEntry_originKind_status_idx" ON "EventLibraryEntry"("originKind", "status");
CREATE INDEX "EventLibraryDraft_status_ownerId_idx" ON "EventLibraryDraft"("status", "ownerId");
CREATE INDEX "EventLibraryDraft_projectId_idx" ON "EventLibraryDraft"("projectId");
CREATE INDEX "EventLibraryDraft_draftKind_status_idx" ON "EventLibraryDraft"("draftKind", "status");

-- AlterTable TopicPackage: add sourceMode and sourceRefJson
ALTER TABLE "TopicPackage" ADD COLUMN "sourceMode" TEXT NOT NULL DEFAULT 'recommended';
ALTER TABLE "TopicPackage" ADD COLUMN "sourceRefJson" TEXT;
