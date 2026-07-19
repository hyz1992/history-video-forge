import { readFileSync } from "node:fs";
import { relative } from "node:path";

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

  for (const absolutePath of files) {
    // 相对路径合同：storage/event-library/<dynasty-slug>/<event-slug>.json
    const relativePath = relative(rootDir, absolutePath).replace(/\\/g, "/");
    scannedPaths.add(relativePath);

    try {
      const raw = readFileSync(absolutePath, "utf8");
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
        // 同内容文件：若是 archived 状态则恢复为 curated
        if (existing.status === "archived") {
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
            originKind: parsed.origin,
            eventRegistryEntryId: existing.eventRegistryEntryId,
            fileContentHash,
          });
          result.updated++;
          continue;
        }

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

      const angles = parsed.angles.map((a) => ({
        angleLabel: a.angleLabel,
        familyLabel: a.familyLabel,
        scopeLabel: a.scopeLabel,
        angleFingerprint: generateAngleFingerprint(libraryFingerprint, a.angleLabel),
      }));

      if (existing) {
        // 更新已有 entry（文件为权威源，身份/来源字段同步更新）
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
          originKind: parsed.origin,
          eventRegistryEntryId,
          fileContentHash,
        });

        await upsertAngles(prisma, existing.id, angles);

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

        if (parsed.angles.length > 0) {
          await upsertAngles(prisma, entry.id, angles);
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
