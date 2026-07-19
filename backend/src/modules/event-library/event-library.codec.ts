import { createHash } from "node:crypto";
import { z } from "zod";

// ---- JSON file schema ----

const timeRangeSchema = z.object({
  start: z.string(),
  end: z.string(),
  display: z.string(),
});

const angleSchema = z.object({
  angleLabel: z.string().min(1),
  familyLabel: z.string().min(1),
  scopeLabel: z.string().default("standard"),
});

export const eventLibraryFileSchema = z.object({
  schemaVersion: z.literal(1),
  canonicalTitle: z.string().min(1),
  summary: z.string().min(1),
  eventRegistryCanonicalName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  dynasty: z.string().optional(),
  era: z.string().optional(),
  characterTags: z.array(z.string()).default([]),
  eventTypeTags: z.array(z.string()).default([]),
  conflictTypeTags: z.array(z.string()).default([]),
  themeMotifs: z.array(z.string()).default([]),
  timeRange: timeRangeSchema.optional(),
  locationTags: z.array(z.string()).default([]),
  relationshipTags: z.array(z.string()).default([]),
  sourceAnchorRefs: z.array(z.string()).default([]),
  credibilityLevel: z.enum(["high", "medium", "low", "disputed"]).default("medium"),
  disputeNotes: z.string().nullable().default(null),
  origin: z.enum(["builtin", "admin"]).default("builtin"),
  angles: z.array(angleSchema).default([]),
});

export type EventLibraryFile = z.infer<typeof eventLibraryFileSchema>;

export function parseEventLibraryFile(data: unknown): EventLibraryFile {
  return eventLibraryFileSchema.parse(data);
}

// ---- Fingerprint ----

const FINGERPRINT_SEPARATOR = "|";

function normalizeFingerprintComponent(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")    // collapse whitespace
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "") // remove punctuation, keep letters/numbers/whitespace
    .replace(/\s+/g, " ")    // re-collapse after punctuation removal
    .trim();
}

export function generateLibraryFingerprint(
  canonicalTitle: string,
  dynasty: string | null | undefined,
  era: string | null | undefined,
): string {
  const parts = [
    normalizeFingerprintComponent(canonicalTitle),
    normalizeFingerprintComponent(dynasty ?? ""),
    normalizeFingerprintComponent(era ?? ""),
  ];
  return parts.join(FINGERPRINT_SEPARATOR);
}

export function generateAngleFingerprint(
  libraryFingerprint: string,
  angleLabel: string,
): string {
  return normalizeFingerprintComponent(
    `${libraryFingerprint}${FINGERPRINT_SEPARATOR}${angleLabel}`,
  );
}

// ---- File hash ----

export function computeFileContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
