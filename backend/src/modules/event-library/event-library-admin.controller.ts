import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AppPrismaClient } from "../../db/prisma-client.types.js";
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

function snapshotJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** 将 EventLibraryEntry 数据写为 JSON 文件，并回填 filePath + fileContentHash。
 *  若 targetPath 给出（合并场景），写入该路径并清理重名旧文件；
 *  否则按 dynasty/title 生成新路径。 */
async function persistEntryToFile(
  prisma: AppPrismaClient,
  storageBaseDir: string,
  entry: {
    id: string;
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
  targetPath?: string | null,
): Promise<void> {
  const dynastySlug = entry.dynasty ? toAsciiSlug(entry.dynasty) : "unknown";
  const eventSlug = toAsciiSlug(entry.canonicalTitle);

  // 默认按 dynasty/title 生成路径
  let relativePath = `${EVENT_LIBRARY_ROOT_DIR}/${dynastySlug}/${eventSlug}.json`;

  // 合并场景：沿用已有文件路径，避免 sync 归档
  if (targetPath) {
    relativePath = targetPath;
  }

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
  const fileContentHash = computeFileContentHash(json);

  const absTargetPath = join(storageBaseDir, relativePath);
  const absGeneratedPath = join(storageBaseDir, EVENT_LIBRARY_ROOT_DIR, dynastySlug, `${eventSlug}.json`);

  // 如果沿用已有路径但生成路径不同，先写临时文件再 rename 确保原子性
  if (targetPath && absTargetPath !== absGeneratedPath) {
    mkdirSync(join(storageBaseDir, EVENT_LIBRARY_ROOT_DIR, dynastySlug), { recursive: true });
    writeFileSync(absGeneratedPath, json, "utf8");
    mkdirSync(join(absTargetPath, ".."), { recursive: true });
    try { renameSync(absGeneratedPath, absTargetPath); } catch {
      // cross-device fallback
      writeFileSync(absTargetPath, json, "utf8");
      unlinkSync(absGeneratedPath);
    }
  } else {
    const dirPath = join(storageBaseDir, EVENT_LIBRARY_ROOT_DIR, dynastySlug);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(absTargetPath, json, "utf8");
  }

  await prisma.eventLibraryEntry.update({
    where: { id: entry.id },
    data: { filePath: relativePath, fileContentHash },
  });
}

// ---- List Drafts ----

export async function listDraftsController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const status = getPayloadField(context.payload, "status") || undefined;
  const draftKind = getPayloadField(context.payload, "draftKind", "draft_kind") || undefined;
  const search = getPayloadField(context.payload, "search") || undefined;
  const page = Math.max(1, getPayloadNumber(context.payload, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(1, getPayloadNumber(context.payload, "pageSize", "page_size") ?? 20));

  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status;
  } else {
    where.status = { in: ["draft", "pending_review"] };
  }
  if (draftKind) where.draftKind = draftKind;
  if (search) {
    where.OR = [
      { proposedTitle: { contains: search } },
      { proposedSummary: { contains: search } },
    ];
  }

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

// ---- Unified Review (正式合同) ----

async function executeApprove(
  context: RouteContext,
  draftId: string,
  adminUserId: string,
  dynasty?: string,
  era?: string,
): Promise<AppResponse> {
  const prisma = context.app.prismaClient!;

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

  // 朝代/时期回退：管理员未显式指定时，优先取草稿自带的结构化字段
  // （recommendation_reflux 的 scopeLabel，或 custom 的 LLM refined.dynasty）。
  const draftTags = (draft.proposedTagsJson as Record<string, unknown>) ?? {};
  const resolvedDynasty = dynasty
    || (typeof draftTags.dynasty === "string" && draftTags.dynasty.trim() ? draftTags.dynasty.trim() : undefined);
  const resolvedEra = era
    || (typeof draftTags.era === "string" && draftTags.era.trim() ? draftTags.era.trim() : undefined);

  const libraryFingerprint = generateLibraryFingerprint(
    draft.proposedTitle,
    resolvedDynasty ?? null,
    resolvedEra ?? null,
  );

  const existingEntry = await findEntryByFingerprint(prisma, libraryFingerprint);

  let entryId: string;
  let merged = false;

  if (existingEntry) {
    merged = true;

    const proposedAngles = (draft.proposedAnglesJson as Array<{
      angleLabel: string;
      familyLabel: string;
      scopeLabel?: string;
    }>) ?? [];

    const existingAngleFingerprints = new Set(
      (existingEntry.angles as Array<{ angleFingerprint: string }>).map((a) => a.angleFingerprint),
    );

    const newAngles = proposedAngles.filter((a) => {
      const fp = generateAngleFingerprint(libraryFingerprint, a.angleLabel);
      return !existingAngleFingerprints.has(fp);
    });

    if (newAngles.length > 0) {
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

    // 只合并 draftTags.events 到 eventTypeTagsJson；不覆盖 characterTagsJson
    // （文件来源 entry 的 characterTagsJson 为 string[]，非 Record）
    const draftTags = (draft.proposedTagsJson as Record<string, unknown>) ?? {};
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
        ...(draftEventTypeTags.length > 0
          ? { eventTypeTagsJson: mergedEventType as never }
          : {}),
      },
    });

    entryId = existingEntry.id;

    // 合并后重写文件（角度和标签可能已变），沿用已有的 filePath
    const reloaded = await prisma.eventLibraryEntry.findUnique({
      where: { id: entryId },
      include: { angles: true, eventRegistryEntry: true },
    });
    if (reloaded) {
      await persistEntryToFile(prisma, context.app.storageBaseDir, {
        id: reloaded.id,
        canonicalTitle: reloaded.canonicalTitle,
        summary: reloaded.summary,
        dynasty: reloaded.dynasty,
        era: reloaded.era,
        characterTagsJson: reloaded.characterTagsJson,
        eventTypeTagsJson: reloaded.eventTypeTagsJson,
        conflictTypeTagsJson: reloaded.conflictTypeTagsJson,
        themeMotifsJson: reloaded.themeMotifsJson,
        timeRangeJson: reloaded.timeRangeJson,
        locationTagsJson: reloaded.locationTagsJson,
        relationshipTagsJson: reloaded.relationshipTagsJson,
        sourceAnchorRefsJson: reloaded.sourceAnchorRefsJson,
        credibilityLevel: reloaded.credibilityLevel,
        disputeNotes: reloaded.disputeNotes,
        originKind: reloaded.originKind,
        eventRegistryEntry: reloaded.eventRegistryEntry,
        angles: (reloaded.angles as Array<{ angleLabel: string; familyLabel: string; scopeLabel: string }>),
      }, existingEntry.filePath);
    }
  } else {
    merged = false;

    const proposedAngles = (draft.proposedAnglesJson as Array<{
      angleLabel: string;
      familyLabel: string;
      scopeLabel?: string;
    }>) ?? [];

    const draftTags = (draft.proposedTagsJson as Record<string, unknown>) ?? {};

    const eventRegistryEntryId = await ensureEventRegistryEntry(
      prisma,
      draft.proposedTitle,
      [],
    );

    const entry = await createEntry(prisma, {
      eventRegistryEntryId,
      canonicalTitle: draft.proposedTitle,
      summary: draft.proposedSummary,
      dynasty: resolvedDynasty ?? null,
      era: resolvedEra ?? null,
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

    // 写文件并回填 filePath + fileContentHash
    const reloaded = await prisma.eventLibraryEntry.findUnique({
      where: { id: entryId },
      include: { angles: true, eventRegistryEntry: true },
    });
    if (reloaded) {
      await persistEntryToFile(prisma, context.app.storageBaseDir, {
        id: reloaded.id,
        canonicalTitle: reloaded.canonicalTitle,
        summary: reloaded.summary,
        dynasty: reloaded.dynasty,
        era: reloaded.era,
        characterTagsJson: reloaded.characterTagsJson,
        eventTypeTagsJson: reloaded.eventTypeTagsJson,
        conflictTypeTagsJson: reloaded.conflictTypeTagsJson,
        themeMotifsJson: reloaded.themeMotifsJson,
        timeRangeJson: reloaded.timeRangeJson,
        locationTagsJson: reloaded.locationTagsJson,
        relationshipTagsJson: reloaded.relationshipTagsJson,
        sourceAnchorRefsJson: reloaded.sourceAnchorRefsJson,
        credibilityLevel: reloaded.credibilityLevel,
        disputeNotes: reloaded.disputeNotes,
        originKind: reloaded.originKind,
        eventRegistryEntry: reloaded.eventRegistryEntry,
        angles: (reloaded.angles as Array<{ angleLabel: string; familyLabel: string; scopeLabel: string }>),
      });
    }
  }

  await prisma.eventLibraryDraft.update({
    where: { id: draft.id },
    data: {
      status: "approved",
      reviewerId: adminUserId,
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

async function executeReject(
  context: RouteContext,
  draftId: string,
  adminUserId: string,
  reviewNotes?: string | null,
): Promise<AppResponse> {
  const prisma = context.app.prismaClient!;

  const draft = await prisma.eventLibraryDraft.findUnique({ where: { id: draftId } });
  if (!draft) {
    return { statusCode: 404, body: { error: "draft_not_found" } };
  }

  if (draft.status !== "draft" && draft.status !== "pending_review") {
    return { statusCode: 409, body: { error: "draft_already_reviewed", status: draft.status } };
  }

  await prisma.eventLibraryDraft.update({
    where: { id: draft.id },
    data: {
      status: "rejected",
      reviewerId: adminUserId,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes ?? null,
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

/** 正式合同：POST /api/admin/event-library/drafts/:draftId/review */
export async function reviewDraftController(context: RouteContext): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const draftId = context.params.draftId;
  if (!draftId) return { statusCode: 400, body: { error: "draft_id_required" } };

  const decision = getPayloadField(context.payload, "decision");
  if (decision !== "approve" && decision !== "reject") {
    return { statusCode: 400, body: { error: "decision 必须为 approve 或 reject" } };
  }

  if (decision === "approve") {
    const dynasty = getPayloadField(context.payload, "dynasty") || undefined;
    const era = getPayloadField(context.payload, "era") || undefined;
    return executeApprove(context, draftId, user.userId, dynasty, era);
  }

  const reviewNotes = getPayloadField(context.payload, "reviewNotes", "review_notes") || null;
  return executeReject(context, draftId, user.userId, reviewNotes);
}

// ---- 兼容别名 ----

export async function approveDraftController(context: RouteContext): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const draftId = context.params.draftId;
  if (!draftId) return { statusCode: 400, body: { error: "draft_id_required" } };
  const dynasty = getPayloadField(context.payload, "dynasty") || undefined;
  const era = getPayloadField(context.payload, "era") || undefined;
  return executeApprove(context, draftId, user.userId, dynasty, era);
}

export async function rejectDraftController(context: RouteContext): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const draftId = context.params.draftId;
  if (!draftId) return { statusCode: 400, body: { error: "draft_id_required" } };
  const reviewNotes = getPayloadField(context.payload, "reviewNotes", "review_notes") || null;
  return executeReject(context, draftId, user.userId, reviewNotes);
}

// ---- List All Entries (Admin) ----

export async function listAdminEntriesController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const status = getPayloadField(context.payload, "status") || undefined;
  const dynasty = getPayloadField(context.payload, "dynasty") || undefined;
  const search = getPayloadField(context.payload, "search") || undefined;
  const page = Math.max(1, getPayloadNumber(context.payload, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(1, getPayloadNumber(context.payload, "pageSize", "page_size") ?? 20));

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (dynasty) where.dynasty = dynasty;
  if (search) {
    where.OR = [
      { canonicalTitle: { contains: search } },
      { summary: { contains: search } },
    ];
  }

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

  await updateEntry(prisma, entryId, {
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

  const reloaded = await prisma.eventLibraryEntry.findUnique({
    where: { id: entryId },
    include: { angles: true, eventRegistryEntry: true },
  });
  if (reloaded) {
    await persistEntryToFile(prisma, context.app.storageBaseDir, {
      id: reloaded.id,
      canonicalTitle: reloaded.canonicalTitle,
      summary: reloaded.summary,
      dynasty: reloaded.dynasty,
      era: reloaded.era,
      characterTagsJson: reloaded.characterTagsJson,
      eventTypeTagsJson: reloaded.eventTypeTagsJson,
      conflictTypeTagsJson: reloaded.conflictTypeTagsJson,
      themeMotifsJson: reloaded.themeMotifsJson,
      timeRangeJson: reloaded.timeRangeJson,
      locationTagsJson: reloaded.locationTagsJson,
      relationshipTagsJson: reloaded.relationshipTagsJson,
      sourceAnchorRefsJson: reloaded.sourceAnchorRefsJson,
      credibilityLevel: reloaded.credibilityLevel,
      disputeNotes: reloaded.disputeNotes,
      originKind: reloaded.originKind,
      eventRegistryEntry: reloaded.eventRegistryEntry,
      angles: (reloaded.angles as Array<{ angleLabel: string; familyLabel: string; scopeLabel: string }>),
    }, entry.filePath || null);
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

// ---- Create Entry (Admin) ----

export async function createAdminEntryController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const body = context.payload as Record<string, unknown> | undefined;
  if (!body) return { statusCode: 400, body: { error: "invalid_payload" } };

  const canonicalTitle = getPayloadField(body, "canonicalTitle", "canonical_title");
  const summary = getPayloadField(body, "summary");
  if (!canonicalTitle || !summary) {
    return { statusCode: 400, body: { error: "title_and_summary_required" } };
  }

  const dynasty = getPayloadField(body, "dynasty") || null;
  const era = getPayloadField(body, "era") || null;
  const characterTags = getPayloadArray(body, "characterTags", "character_tags");
  const eventTypeTags = getPayloadArray(body, "eventTypeTags", "event_type_tags");
  const conflictTypeTags = getPayloadArray(body, "conflictTypeTags", "conflict_type_tags");
  const themeMotifs = getPayloadArray(body, "themeMotifs", "theme_motifs");
  const locationTags = getPayloadArray(body, "locationTags", "location_tags");
  const relationshipTags = getPayloadArray(body, "relationshipTags", "relationship_tags");
  const sourceAnchorRefs = getPayloadArray(body, "sourceAnchorRefs", "source_anchor_refs");
  const credibilityLevel = getPayloadField(body, "credibilityLevel", "credibility_level") || "medium";
  const disputeNotes = getPayloadField(body, "disputeNotes", "dispute_notes") || null;

  const libraryFingerprint = generateLibraryFingerprint(
    canonicalTitle as string,
    dynasty as string | undefined,
    era as string | undefined,
  );

  const eventRegistryEntryId = await ensureEventRegistryEntry(prisma, canonicalTitle as string, []);

  const dynastySlug = dynasty ? toAsciiSlug(dynasty as string) : "unknown";
  const eventSlug = toAsciiSlug(canonicalTitle as string);
  const filePath = `${EVENT_LIBRARY_ROOT_DIR}/${dynastySlug}/${eventSlug}.json`;

  const fileContent: EventLibraryFile = {
    schemaVersion: 1,
    canonicalTitle: canonicalTitle as string,
    summary: summary as string,
    eventRegistryCanonicalName: canonicalTitle as string,
    aliases: [],
    dynasty: (dynasty as string) ?? undefined,
    era: (era as string) ?? undefined,
    characterTags,
    eventTypeTags,
    conflictTypeTags,
    themeMotifs,
    timeRange: undefined,
    locationTags,
    relationshipTags,
    sourceAnchorRefs,
    credibilityLevel: credibilityLevel as EventLibraryFile["credibilityLevel"],
    disputeNotes: disputeNotes as string | null,
    origin: "admin",
    angles: [],
  };
  const json = JSON.stringify(fileContent, null, 2);
  const fileContentHash = computeFileContentHash(json);

  const created = await createEntry(prisma, {
    eventRegistryEntryId,
    canonicalTitle: canonicalTitle as string,
    summary: summary as string,
    dynasty: dynasty as string | null,
    era: era as string | null,
    characterTags,
    eventTypeTags,
    conflictTypeTags,
    themeMotifs,
    locationTags,
    relationshipTags,
    sourceAnchorRefs,
    credibilityLevel: credibilityLevel as string,
    disputeNotes: disputeNotes as string | null,
    originKind: "admin",
    libraryFingerprint,
    filePath,
    fileContentHash,
  });

  // 写入文件
  const absFilePath = join(context.app.storageBaseDir, filePath);
  mkdirSync(join(absFilePath, ".."), { recursive: true });
  writeFileSync(absFilePath, json, "utf8");

  return { statusCode: 201, body: { entry_id: created.id, created: true } };
}

// ---- Archive Entry (Admin) ----

export async function archiveAdminEntryController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const entryId = context.params.entryId;
  if (!entryId) return { statusCode: 400, body: { error: "entry_id_required" } };

  const entry = await prisma.eventLibraryEntry.findUnique({ where: { id: entryId } });
  if (!entry) return { statusCode: 404, body: { error: "entry_not_found" } };

  await prisma.eventLibraryEntry.update({
    where: { id: entryId },
    data: { status: "archived" },
  });

  // 归档源文件：重命名为 .json.archived，使 sync 不再扫描到
  // 不物理删除，满足设计"不物理删"约束
  if (entry.filePath) {
    const absPath = join(context.app.storageBaseDir, entry.filePath);
    try {
      renameSync(absPath, absPath + ".archived");
    } catch {
      // 文件可能已不存在（如从未写过文件的新建 entry）
    }
  }

  return { statusCode: 200, body: { entry_id: entryId, archived: true } };
}

// ---- Trigger Sync ----

export async function triggerSyncController(context: RouteContext): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  try {
    const result = await syncEventLibraryFromFiles(prisma, context.app.storageBaseDir);
    return { statusCode: 200, body: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync_failed";
    return { statusCode: 500, body: { error: "sync_failed", message } };
  }
}
