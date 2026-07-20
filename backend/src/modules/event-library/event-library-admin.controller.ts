import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AppResponse, RouteContext } from "../../app";
import { requireUser } from "../../auth/authorization.js";
import {
  generateLibraryFingerprint,
  generateAngleFingerprint,
  computeFileContentHash,
  type EventLibraryFile,
} from "./event-library.codec.js";
import { EVENT_LIBRARY_ROOT_DIR, toAsciiSlug } from "./event-library.path.js";
import {
  createEntry,
  findEntryByFingerprint,
  updateEntry,
  upsertAngles,
  ensureEventRegistryEntry,
} from "./event-library-entry.repository.js";
import { syncEventLibraryFromFiles } from "./event-library-sync.service.js";

// ---- Helpers ----

function getPayloadField(payload: unknown, ...keys: string[]): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getPayloadNumber(payload: unknown, ...keys: string[]): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function getPayloadArray(payload: unknown, ...keys: string[]): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return value as string[];
    }
  }
  return [];
}

function mergeUniqueStrings(existing: string[], incoming: string[]): string[] {
  const set = new Set(existing);
  for (const s of incoming) set.add(s);
  return [...set];
}

function mergeProposedTags(
  draftTags: Record<string, unknown>,
  existingTags: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existingTags };
  for (const [key, value] of Object.entries(draftTags)) {
    if (Array.isArray(value) && Array.isArray(merged[key])) {
      merged[key] = mergeUniqueStrings(merged[key] as string[], value as string[]);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function snapshotJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** 将 EventLibraryEntry 序列化为 EventLibraryFile 格式并写入磁盘，返回相对路径 */
function writeEntryToFile(
  rootDir: string,
  entry: {
    canonicalTitle: string;
    summary: string;
    dynasty: string | null;
    era: string | null;
    characterTagsJson: unknown;
    eventTypeTagsJson: unknown;
    conflictTypeTagsJson: unknown;
    themeMotifsJson: unknown;
    timeRangeJson: unknown;
    locationTagsJson: unknown;
    relationshipTagsJson: unknown;
    sourceAnchorRefsJson: unknown;
    credibilityLevel: string;
    disputeNotes: string | null;
    originKind: string;
    eventRegistryEntry: { canonicalName: string; aliasesJson: unknown } | null;
    angles: Array<{ angleLabel: string; familyLabel: string; scopeLabel: string }>;
  },
): string {
  const dynastySlug = entry.dynasty ? toAsciiSlug(entry.dynasty) : "unknown";
  const eventSlug = toAsciiSlug(entry.canonicalTitle);
  const dirPath = join(rootDir, EVENT_LIBRARY_ROOT_DIR, dynastySlug);
  mkdirSync(dirPath, { recursive: true });
  const relativePath = `${EVENT_LIBRARY_ROOT_DIR}/${dynastySlug}/${eventSlug}.json`;

  const fileContent: EventLibraryFile = {
    schemaVersion: 1,
    canonicalTitle: entry.canonicalTitle,
    summary: entry.summary,
    eventRegistryCanonicalName: entry.eventRegistryEntry?.canonicalName ?? entry.canonicalTitle,
    aliases: (entry.eventRegistryEntry?.aliasesJson as string[]) ?? [],
    dynasty: entry.dynasty ?? undefined,
    era: entry.era ?? undefined,
    characterTags: (entry.characterTagsJson as string[]) ?? [],
    eventTypeTags: (entry.eventTypeTagsJson as string[]) ?? [],
    conflictTypeTags: (entry.conflictTypeTagsJson as string[]) ?? [],
    themeMotifs: (entry.themeMotifsJson as string[]) ?? [],
    timeRange: entry.timeRangeJson
      ? (entry.timeRangeJson as { start: string; end: string; display: string })
      : undefined,
    locationTags: (entry.locationTagsJson as string[]) ?? [],
    relationshipTags: (entry.relationshipTagsJson as string[]) ?? [],
    sourceAnchorRefs: (entry.sourceAnchorRefsJson as string[]) ?? [],
    credibilityLevel: entry.credibilityLevel as EventLibraryFile["credibilityLevel"],
    disputeNotes: entry.disputeNotes,
    origin: (entry.originKind === "builtin" ? "builtin" : "admin") as "builtin" | "admin",
    angles: entry.angles.map((a) => ({
      angleLabel: a.angleLabel,
      familyLabel: a.familyLabel,
      scopeLabel: a.scopeLabel,
    })),
  };

  const json = JSON.stringify(fileContent, null, 2);
  writeFileSync(join(dirPath, `${eventSlug}.json`), json, "utf8");
  return relativePath;
}

// ---- List Drafts ----

export async function listDraftsController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const status = getPayloadField(context.payload, "status") || undefined;
  const draftKind = getPayloadField(context.payload, "draftKind", "draft_kind") || undefined;
  const page = Math.max(1, getPayloadNumber(context.payload, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(1, getPayloadNumber(context.payload, "pageSize", "page_size") ?? 20));

  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status;
  } else {
    where.status = { in: ["draft", "pending_review"] };
  }
  if (draftKind) where.draftKind = draftKind;

  const [drafts, total] = await Promise.all([
    prisma.eventLibraryDraft.findMany({
      where: where as never,
      include: { owner: { select: { id: true, username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.eventLibraryDraft.count({ where: where as never }),
  ]);

  return {
    statusCode: 200,
    body: {
      drafts: drafts.map((d) => ({
        id: d.id,
        draft_kind: d.draftKind,
        project_id: d.projectId,
        proposed_title: d.proposedTitle,
        proposed_summary: d.proposedSummary,
        proposed_angles: snapshotJson(d.proposedAnglesJson),
        proposed_tags: snapshotJson(d.proposedTagsJson),
        status: d.status,
        review_notes: d.reviewNotes,
        merged_entry_id: d.mergedEntryId,
        owner_id: d.ownerId,
        owner_username: d.owner?.username ?? null,
        created_at: d.createdAt.toISOString(),
      })),
      total,
      page,
      page_size: pageSize,
    },
  };
}

// ---- Approve Draft ----

export async function approveDraftController(context: RouteContext): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const draftId = context.params.draftId;
  if (!draftId) return { statusCode: 400, body: { error: "draft_id_required" } };

  const draft = await prisma.eventLibraryDraft.findUnique({
    where: { id: draftId },
    include: { owner: { select: { id: true, username: true } } },
  });

  if (!draft) {
    return { statusCode: 404, body: { error: "draft_not_found" } };
  }

  if (draft.status !== "draft" && draft.status !== "pending_review") {
    return { statusCode: 409, body: { error: "draft_already_reviewed", status: draft.status } };
  }

  const dynasty = getPayloadField(context.payload, "dynasty") || undefined;
  const era = getPayloadField(context.payload, "era") || undefined;

  // Generate fingerprint from proposedTitle
  const libraryFingerprint = generateLibraryFingerprint(
    draft.proposedTitle,
    dynasty ?? null,
    era ?? null,
  );

  // Check for existing entry by fingerprint
  const existingEntry = await findEntryByFingerprint(prisma, libraryFingerprint);

  let entryId: string;
  let merged = false;

  if (existingEntry) {
    // Merge: append non-duplicate angles and tags
    merged = true;

    const proposedAngles = (draft.proposedAnglesJson as Array<{
      angleLabel: string;
      familyLabel: string;
      scopeLabel?: string;
    }>) ?? [];

    // Only add angles that don't already exist (by angleFingerprint)
    const existingAngleFingerprints = new Set(
      (existingEntry.angles as Array<{ angleFingerprint: string }>).map((a) => a.angleFingerprint),
    );

    const newAngles = proposedAngles.filter((a) => {
      const fp = generateAngleFingerprint(libraryFingerprint, a.angleLabel);
      return !existingAngleFingerprints.has(fp);
    });

    if (newAngles.length > 0) {
      // 合并路径只插入新角度，不删除已有角度（upsertAngles 会删除不在列表中的角度）
      for (const a of newAngles) {
        await prisma.eventLibraryAngle.create({
          data: {
            id: randomUUID(),
            eventLibraryEntryId: existingEntry.id,
            angleLabel: a.angleLabel,
            familyLabel: a.familyLabel,
            scopeLabel: a.scopeLabel ?? "standard",
            angleFingerprint: generateAngleFingerprint(libraryFingerprint, a.angleLabel),
            riskHintsJson: [] as never,
          },
        });
      }
    }

    // Merge proposedTags into existing tags
    const existingTags = existingEntry.characterTagsJson as Record<string, unknown>;
    const draftTags = (draft.proposedTagsJson as Record<string, unknown>) ?? {};
    const mergedTags = mergeProposedTags(draftTags, existingTags || {});

    // Only update tags if they changed
    const existingEventTypeJson = existingEntry.eventTypeTagsJson as unknown[];
    const draftEventTypeTags = Array.isArray(draftTags.events) ? draftTags.events as string[] : [];
    const mergedEventType = draftEventTypeTags.length > 0
      ? mergeUniqueStrings(
          (existingEntry.eventTypeTagsJson as string[]) ?? [],
          draftEventTypeTags,
        )
      : (existingEntry.eventTypeTagsJson as string[]);

    await prisma.eventLibraryEntry.update({
      where: { id: existingEntry.id },
      data: {
        characterTagsJson: mergedTags as never,
        ...(draftEventTypeTags.length > 0
          ? { eventTypeTagsJson: mergedEventType as never }
          : {}),
      },
    });

    entryId = existingEntry.id;
  } else {
    // Create new entry from draft
    merged = false;

    const proposedAngles = (draft.proposedAnglesJson as Array<{
      angleLabel: string;
      familyLabel: string;
      scopeLabel?: string;
    }>) ?? [];

    const draftTags = (draft.proposedTagsJson as Record<string, unknown>) ?? {};

    // Ensure EventRegistryEntry
    const eventRegistryEntryId = await ensureEventRegistryEntry(
      prisma,
      draft.proposedTitle,
      [],
    );

    const entry = await createEntry(prisma, {
      eventRegistryEntryId,
      canonicalTitle: draft.proposedTitle,
      summary: draft.proposedSummary,
      dynasty: dynasty ?? null,
      era: era ?? null,
      characterTags: Array.isArray(draftTags.characterTags)
        ? draftTags.characterTags as string[]
        : [],
      eventTypeTags: Array.isArray(draftTags.events)
        ? draftTags.events as string[]
        : [],
      conflictTypeTags: Array.isArray(draftTags.conflictTypeTags)
        ? draftTags.conflictTypeTags as string[]
        : [],
      themeMotifs: Array.isArray(draftTags.themeMotifs)
        ? draftTags.themeMotifs as string[]
        : [],
      timeRange: null,
      locationTags: [],
      relationshipTags: [],
      sourceAnchorRefs: [],
      credibilityLevel: "medium",
      disputeNotes: null,
      originKind: "admin",
      originRefJson: { draftId: draft.id },
      libraryFingerprint,
      filePath: "",
      fileContentHash: "",
    });

    if (proposedAngles.length > 0) {
      await upsertAngles(prisma, entry.id, proposedAngles.map((a) => ({
        angleLabel: a.angleLabel,
        familyLabel: a.familyLabel,
        scopeLabel: a.scopeLabel ?? "standard",
        angleFingerprint: generateAngleFingerprint(libraryFingerprint, a.angleLabel),
      })));
    }

    entryId = entry.id;
  }

  // Mark draft as approved
  await prisma.eventLibraryDraft.update({
    where: { id: draft.id },
    data: {
      status: "approved",
      reviewerId: user.userId,
      reviewedAt: new Date(),
      mergedEntryId: entryId,
    },
  });

  return {
    statusCode: 200,
    body: {
      draft_id: draft.id,
      entry_id: entryId,
      merged,
    },
  };
}

// ---- Reject Draft ----

export async function rejectDraftController(context: RouteContext): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const draftId = context.params.draftId;
  if (!draftId) return { statusCode: 400, body: { error: "draft_id_required" } };

  const draft = await prisma.eventLibraryDraft.findUnique({ where: { id: draftId } });
  if (!draft) {
    return { statusCode: 404, body: { error: "draft_not_found" } };
  }

  if (draft.status !== "draft" && draft.status !== "pending_review") {
    return { statusCode: 409, body: { error: "draft_already_reviewed", status: draft.status } };
  }

  const reviewNotes = getPayloadField(context.payload, "reviewNotes", "review_notes") || null;

  await prisma.eventLibraryDraft.update({
    where: { id: draft.id },
    data: {
      status: "rejected",
      reviewerId: user.userId,
      reviewedAt: new Date(),
      reviewNotes,
    },
  });

  return {
    statusCode: 200,
    body: {
      draft_id: draft.id,
      status: "rejected",
    },
  };
}

// ---- List All Entries (Admin) ----

export async function listAdminEntriesController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const status = getPayloadField(context.payload, "status") || undefined;
  const page = Math.max(1, getPayloadNumber(context.payload, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(1, getPayloadNumber(context.payload, "pageSize", "page_size") ?? 20));

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  const [entries, total] = await Promise.all([
    prisma.eventLibraryEntry.findMany({
      where: where as never,
      include: { angles: true, eventRegistryEntry: true },
      orderBy: { canonicalTitle: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.eventLibraryEntry.count({ where: where as never }),
  ]);

  return {
    statusCode: 200,
    body: {
      entries: entries.map((e) => ({
        id: e.id,
        canonical_title: e.canonicalTitle,
        summary: e.summary,
        dynasty: e.dynasty,
        era: e.era,
        character_tags: snapshotJson(e.characterTagsJson),
        event_type_tags: snapshotJson(e.eventTypeTagsJson),
        conflict_type_tags: snapshotJson(e.conflictTypeTagsJson),
        theme_motifs: snapshotJson(e.themeMotifsJson),
        credibility_level: e.credibilityLevel,
        status: e.status,
        visibility: e.visibility,
        origin_kind: e.originKind,
        angle_count: e.angles.length,
        file_path: e.filePath,
        created_at: e.createdAt.toISOString(),
        updated_at: e.updatedAt.toISOString(),
      })),
      total,
      page,
      page_size: pageSize,
    },
  };
}

// ---- Update Entry (Admin) ----

export async function updateAdminEntryController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const entryId = context.params.entryId;
  if (!entryId) return { statusCode: 400, body: { error: "entry_id_required" } };

  const entry = await prisma.eventLibraryEntry.findUnique({
    where: { id: entryId },
    include: { angles: true, eventRegistryEntry: true },
  });
  if (!entry) {
    return { statusCode: 404, body: { error: "entry_not_found" } };
  }

  const body = context.payload as Record<string, unknown> | undefined;
  if (!body) return { statusCode: 400, body: { error: "invalid_payload" } };

  // Extract updatable fields
  const canonicalTitle = getPayloadField(body, "canonicalTitle", "canonical_title") || entry.canonicalTitle;
  const summary = getPayloadField(body, "summary") || entry.summary;
  const dynasty = getPayloadField(body, "dynasty") || entry.dynasty || null;
  const era = getPayloadField(body, "era") || entry.era || null;
  const characterTags = getPayloadArray(body, "characterTags", "character_tags");
  const eventTypeTags = getPayloadArray(body, "eventTypeTags", "event_type_tags");
  const conflictTypeTags = getPayloadArray(body, "conflictTypeTags", "conflict_type_tags");
  const themeMotifs = getPayloadArray(body, "themeMotifs", "theme_motifs");
  const locationTags = getPayloadArray(body, "locationTags", "location_tags");
  const relationshipTags = getPayloadArray(body, "relationshipTags", "relationship_tags");
  const sourceAnchorRefs = getPayloadArray(body, "sourceAnchorRefs", "source_anchor_refs");
  const credibilityLevel = getPayloadField(body, "credibilityLevel", "credibility_level") || entry.credibilityLevel;
  const disputeNotes = getPayloadField(body, "disputeNotes", "dispute_notes") || entry.disputeNotes || null;

  // Update entry in DB
  const updated = await updateEntry(prisma, entryId, {
    canonicalTitle,
    summary,
    dynasty: dynasty as string | null,
    era: era as string | null,
    characterTags: characterTags.length > 0 ? characterTags : (entry.characterTagsJson as string[]),
    eventTypeTags: eventTypeTags.length > 0 ? eventTypeTags : (entry.eventTypeTagsJson as string[]),
    conflictTypeTags: conflictTypeTags.length > 0 ? conflictTypeTags : (entry.conflictTypeTagsJson as string[]),
    themeMotifs: themeMotifs.length > 0 ? themeMotifs : (entry.themeMotifsJson as string[]),
    timeRange: (entry.timeRangeJson as { start: string; end: string; display: string } | null) ?? null,
    locationTags: locationTags.length > 0 ? locationTags : (entry.locationTagsJson as string[]),
    relationshipTags: relationshipTags.length > 0 ? relationshipTags : (entry.relationshipTagsJson as string[]),
    sourceAnchorRefs: sourceAnchorRefs.length > 0 ? sourceAnchorRefs : (entry.sourceAnchorRefsJson as string[]),
    credibilityLevel,
    disputeNotes,
    originKind: entry.originKind,
    eventRegistryEntryId: entry.eventRegistryEntryId,
    fileContentHash: entry.fileContentHash ?? "",
  });

  // Write to file
  try {
    const relativePath = writeEntryToFile(
      process.cwd(),
      {
        canonicalTitle,
        summary,
        dynasty: dynasty as string | null,
        era: era as string | null,
        characterTagsJson: updated.characterTagsJson,
        eventTypeTagsJson: updated.eventTypeTagsJson,
        conflictTypeTagsJson: updated.conflictTypeTagsJson,
        themeMotifsJson: updated.themeMotifsJson,
        timeRangeJson: updated.timeRangeJson,
        locationTagsJson: updated.locationTagsJson,
        relationshipTagsJson: updated.relationshipTagsJson,
        sourceAnchorRefsJson: updated.sourceAnchorRefsJson,
        credibilityLevel,
        disputeNotes,
        originKind: entry.originKind,
        eventRegistryEntry: entry.eventRegistryEntry,
        angles: (entry.angles as Array<{ angleLabel: string; familyLabel: string; scopeLabel: string }>),
      },
    );

    // Update filePath + fileContentHash in DB
    const raw = readFileSync(
      join(process.cwd(), relativePath),
      "utf8",
    );
    const fileContentHash = computeFileContentHash(raw);

    await prisma.eventLibraryEntry.update({
      where: { id: entryId },
      data: { filePath: relativePath, fileContentHash },
    });
  } catch (fileError) {
    // File write failed but DB update succeeded — log and continue
    console.error("event-library-admin-write-file-failed", {
      entryId,
      error: fileError instanceof Error ? fileError.message : String(fileError),
    });
  }

  return {
    statusCode: 200,
    body: {
      entry_id: entryId,
      updated: true,
    },
  };
}

// ---- Trigger Sync ----

export async function triggerSyncController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  try {
    const result = await syncEventLibraryFromFiles(prisma, process.cwd());
    return { statusCode: 200, body: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync_failed";
    return { statusCode: 500, body: { error: "sync_failed", message } };
  }
}
