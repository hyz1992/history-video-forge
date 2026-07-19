import { randomUUID } from "node:crypto";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

// ---- EventLibraryEntry ----

export interface CreateEventLibraryEntryInput {
  eventRegistryEntryId: string;
  canonicalTitle: string;
  summary: string;
  dynasty?: string | null;
  era?: string | null;
  characterTags: string[];
  eventTypeTags: string[];
  conflictTypeTags: string[];
  themeMotifs: string[];
  timeRange?: { start: string; end: string; display: string } | null;
  locationTags: string[];
  relationshipTags: string[];
  sourceAnchorRefs: string[];
  credibilityLevel: string;
  disputeNotes?: string | null;
  originKind: string;
  originRefJson?: unknown;
  libraryFingerprint: string;
  filePath: string;
  fileContentHash: string;
}

export async function findEntryByFilePath(
  prisma: AppPrismaClient,
  filePath: string,
) {
  return prisma.eventLibraryEntry.findFirst({ where: { filePath } });
}

export async function findEntryByFingerprint(
  prisma: AppPrismaClient,
  libraryFingerprint: string,
) {
  return prisma.eventLibraryEntry.findUnique({
    where: { libraryFingerprint },
  });
}

export async function createEntry(
  prisma: AppPrismaClient,
  input: CreateEventLibraryEntryInput,
) {
  return prisma.eventLibraryEntry.create({
    data: {
      id: randomUUID(),
      eventRegistryEntryId: input.eventRegistryEntryId,
      canonicalTitle: input.canonicalTitle,
      summary: input.summary,
      dynasty: input.dynasty ?? null,
      era: input.era ?? null,
      characterTagsJson: input.characterTags as never,
      eventTypeTagsJson: input.eventTypeTags as never,
      conflictTypeTagsJson: input.conflictTypeTags as never,
      themeMotifsJson: input.themeMotifs as never,
      timeRangeJson: (input.timeRange ?? null) as never,
      locationTagsJson: input.locationTags as never,
      relationshipTagsJson: input.relationshipTags as never,
      sourceAnchorRefsJson: input.sourceAnchorRefs as never,
      credibilityLevel: input.credibilityLevel,
      disputeNotes: input.disputeNotes ?? null,
      visibility: "public",
      status: "curated",
      originKind: input.originKind,
      originRefJson: (input.originRefJson ?? null) as never,
      libraryFingerprint: input.libraryFingerprint,
      filePath: input.filePath,
      fileContentHash: input.fileContentHash,
    },
  });
}

export interface UpdateEventLibraryEntryInput {
  canonicalTitle: string;
  summary: string;
  dynasty?: string | null;
  era?: string | null;
  characterTags: string[];
  eventTypeTags: string[];
  conflictTypeTags: string[];
  themeMotifs: string[];
  timeRange?: { start: string; end: string; display: string } | null;
  locationTags: string[];
  relationshipTags: string[];
  sourceAnchorRefs: string[];
  credibilityLevel: string;
  disputeNotes?: string | null;
  originKind: string;
  eventRegistryEntryId: string;
  filePath?: string;
  fileContentHash: string;
}

export async function updateEntry(
  prisma: AppPrismaClient,
  id: string,
  input: UpdateEventLibraryEntryInput,
) {
  return prisma.eventLibraryEntry.update({
    where: { id },
    data: {
      canonicalTitle: input.canonicalTitle,
      summary: input.summary,
      dynasty: input.dynasty ?? null,
      era: input.era ?? null,
      characterTagsJson: input.characterTags as never,
      eventTypeTagsJson: input.eventTypeTags as never,
      conflictTypeTagsJson: input.conflictTypeTags as never,
      themeMotifsJson: input.themeMotifs as never,
      timeRangeJson: (input.timeRange ?? null) as never,
      locationTagsJson: input.locationTags as never,
      relationshipTagsJson: input.relationshipTags as never,
      sourceAnchorRefsJson: input.sourceAnchorRefs as never,
      credibilityLevel: input.credibilityLevel,
      disputeNotes: input.disputeNotes ?? null,
      originKind: input.originKind,
      eventRegistryEntryId: input.eventRegistryEntryId,
      ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
      fileContentHash: input.fileContentHash,
      status: "curated", // restore from archived if re-synced
    },
  });
}

export async function markBuiltinAdminEntriesAsArchived(
  prisma: AppPrismaClient,
  keepFilePaths: string[],
) {
  return prisma.eventLibraryEntry.updateMany({
    where: {
      originKind: { in: ["builtin", "admin"] },
      filePath: { not: null },
      ...(keepFilePaths.length > 0
        ? { filePath: { notIn: keepFilePaths } }
        : {}),
      status: { not: "archived" },
    },
    data: { status: "archived" },
  });
}

// ---- EventLibraryAngle ----

export interface UpsertAngleInput {
  angleLabel: string;
  familyLabel: string;
  scopeLabel: string;
  angleFingerprint: string;
}

export async function upsertAngles(
  prisma: AppPrismaClient,
  eventLibraryEntryId: string,
  angles: UpsertAngleInput[],
) {
  const angleFingerprints = angles.map((a) => a.angleFingerprint);

  // Delete angles no longer in the file
  await prisma.eventLibraryAngle.deleteMany({
    where: {
      eventLibraryEntryId,
      angleFingerprint: { notIn: angleFingerprints },
    },
  });

  // Upsert each angle
  for (const angle of angles) {
    await prisma.eventLibraryAngle.upsert({
      where: {
        eventLibraryEntryId_angleFingerprint: {
          eventLibraryEntryId,
          angleFingerprint: angle.angleFingerprint,
        },
      },
      create: {
        id: randomUUID(),
        eventLibraryEntryId,
        angleLabel: angle.angleLabel,
        familyLabel: angle.familyLabel,
        scopeLabel: angle.scopeLabel,
        angleFingerprint: angle.angleFingerprint,
        riskHintsJson: [] as never,
      },
      update: {
        angleLabel: angle.angleLabel,
        familyLabel: angle.familyLabel,
        scopeLabel: angle.scopeLabel,
      },
    });
  }
}

// ---- EventRegistryEntry ----

export async function ensureEventRegistryEntry(
  prisma: AppPrismaClient,
  canonicalName: string,
  aliases: string[],
): Promise<string> {
  const existing = await prisma.eventRegistryEntry.findFirst({
    where: { canonicalName },
  });

  if (existing) {
    // Update aliases if needed
    const existingAliases = (existing.aliasesJson as string[]) ?? [];
    const newAliases = [...new Set([...existingAliases, ...aliases])];
    if (newAliases.length > existingAliases.length) {
      await prisma.eventRegistryEntry.update({
        where: { id: existing.id },
        data: { aliasesJson: newAliases as never },
      });
    }
    return existing.id;
  }

  const id = randomUUID();
  await prisma.eventRegistryEntry.create({
    data: {
      id,
      canonicalName,
      aliasesJson: aliases as never,
      canonicalQuotesJson: [] as never,
      canonicalQuoteIntentsJson: [] as never,
      sourceType: "builtin",
      isProvisional: false,
    },
  });
  return id;
}
