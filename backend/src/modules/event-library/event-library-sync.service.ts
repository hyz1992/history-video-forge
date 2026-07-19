import { readFileSync } from "node:fs";

import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import {
  type EventLibraryFile,
  computeFileContentHash,
  generateAngleFingerprint,
  generateLibraryFingerprint,
  parseEventLibraryFile,
} from "./event-library.codec.js";
import {
  createEntry,
  findEntryByFilePath,
  markBuiltinAdminEntriesAsArchived,
  updateEntry,
  upsertAngles,
  ensureEventRegistryEntry,
} from "./event-library-entry.repository.js";
import { scanEventLibraryFiles } from "./event-library.path.js";

export interface SyncResult {
  created: number;
  updated: number;
  skipped: number;
  archived: number;
  errors: string[];
}

export async function syncEventLibraryFromFiles(
  prisma: AppPrismaClient,
  rootDir: string,
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    archived: 0,
    errors: [],
  };

  const files = scanEventLibraryFiles(rootDir);
  const scannedPaths = new Set<string>();

  for (const filePath of files) {
    // Resolve relative path for storage in DB
    const relativePath = filePath.replace(/\\/g, "/");
    scannedPaths.add(relativePath);

    try {
      const raw = readFileSync(filePath, "utf8");
      const fileContentHash = computeFileContentHash(raw);

      let parsed: EventLibraryFile;
      try {
        parsed = parseEventLibraryFile(JSON.parse(raw));
      } catch {
        result.errors.push(`${relativePath}: schema 校验失败`);
        continue;
      }

      const existing = await findEntryByFilePath(prisma, relativePath);

      if (existing && existing.fileContentHash === fileContentHash) {
        result.skipped++;
        continue;
      }

      // Ensure EventRegistryEntry exists
      const eventRegistryEntryId = await ensureEventRegistryEntry(
        prisma,
        parsed.eventRegistryCanonicalName,
        parsed.aliases,
      );

      const libraryFingerprint = generateLibraryFingerprint(
        parsed.canonicalTitle,
        parsed.dynasty,
        parsed.era,
      );

      if (existing) {
        // Update existing entry, keep libraryFingerprint
        await updateEntry(prisma, existing.id, {
          canonicalTitle: parsed.canonicalTitle,
          summary: parsed.summary,
          dynasty: parsed.dynasty ?? null,
          era: parsed.era ?? null,
          characterTags: parsed.characterTags,
          eventTypeTags: parsed.eventTypeTags,
          conflictTypeTags: parsed.conflictTypeTags,
          themeMotifs: parsed.themeMotifs,
          timeRange: parsed.timeRange ?? null,
          locationTags: parsed.locationTags,
          relationshipTags: parsed.relationshipTags,
          sourceAnchorRefs: parsed.sourceAnchorRefs,
          credibilityLevel: parsed.credibilityLevel,
          disputeNotes: parsed.disputeNotes,
          fileContentHash,
        });

        // Upsert angles
        await upsertAngles(prisma, existing.id, parsed.angles.map((a) => ({
          angleLabel: a.angleLabel,
          familyLabel: a.familyLabel,
          scopeLabel: a.scopeLabel,
          angleFingerprint: generateAngleFingerprint(libraryFingerprint, a.angleLabel),
        })));

        result.updated++;
      } else {
        // Create new entry
        const entry = await createEntry(prisma, {
          eventRegistryEntryId,
          canonicalTitle: parsed.canonicalTitle,
          summary: parsed.summary,
          dynasty: parsed.dynasty ?? null,
          era: parsed.era ?? null,
          characterTags: parsed.characterTags,
          eventTypeTags: parsed.eventTypeTags,
          conflictTypeTags: parsed.conflictTypeTags,
          themeMotifs: parsed.themeMotifs,
          timeRange: parsed.timeRange ?? null,
          locationTags: parsed.locationTags,
          relationshipTags: parsed.relationshipTags,
          sourceAnchorRefs: parsed.sourceAnchorRefs,
          credibilityLevel: parsed.credibilityLevel,
          disputeNotes: parsed.disputeNotes,
          originKind: parsed.origin,
          libraryFingerprint,
          filePath: relativePath,
          fileContentHash,
        });

        // Create angles
        if (parsed.angles.length > 0) {
          await upsertAngles(prisma, entry.id, parsed.angles.map((a) => ({
            angleLabel: a.angleLabel,
            familyLabel: a.familyLabel,
            scopeLabel: a.scopeLabel,
            angleFingerprint: generateAngleFingerprint(libraryFingerprint, a.angleLabel),
          })));
        }

        result.created++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      result.errors.push(`${relativePath}: ${message}`);
    }
  }

  // Archive entries whose files no longer exist (only builtin/admin origin)
  const archiveResult = await markBuiltinAdminEntriesAsArchived(
    prisma,
    [...scannedPaths],
  );
  result.archived = archiveResult.count;

  return result;
}
