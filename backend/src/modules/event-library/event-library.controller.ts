import { randomUUID } from "node:crypto";

import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import type { AppResponse, RouteContext } from "../../app";
import type { StoredTopicCandidate } from "../topic/topic-confirm.service";
import { getProjectById } from "../projects/project.repository";
import { requireUser } from "../../auth/authorization.js";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import {
  isProviderContentFilterError,
  recommendTopicCandidatesWithTrace,
} from "../topic/topic-recommendation.service";
import { normalizeEventInput } from "../topic/event-normalizer";

// ---- Browse / Detail / Dynasties ----

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

function jsonArrayContains(value: unknown, search: string): boolean {
  if (value == null) return false;
  // JSON.stringify handles both arrays (native) and strings (raw SQLite JSON)
  const str = typeof value === "string" ? value : JSON.stringify(value);
  return str.toLowerCase().includes(search.toLowerCase());
}

export async function listEntriesController(
  context: RouteContext,
): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const dynasty = getPayloadField(context.payload, "dynasty");
  const characterTag = getPayloadField(context.payload, "characterTag", "character_tag");
  const eventTypeTag = getPayloadField(context.payload, "eventTypeTag", "event_type_tag");
  const conflictTypeTag = getPayloadField(context.payload, "conflictTypeTag", "conflict_type_tag");
  const q = getPayloadField(context.payload, "q");
  const page = Math.max(1, getPayloadNumber(context.payload, "page") ?? 1);
  const pageSize = Math.min(100, Math.max(1, getPayloadNumber(context.payload, "pageSize", "page_size") ?? 20));

  const where: Record<string, unknown> = {
    status: "curated",
    visibility: "public",
  };
  if (dynasty) where.dynasty = dynasty;

  // Fetch all curated entries (filter in-memory for tag/q searches, since SQLite JSON filtering is limited)
  const [entries, total] = await Promise.all([
    prisma.eventLibraryEntry.findMany({
      where: where as never,
      include: { angles: true },
      orderBy: { canonicalTitle: "asc" },
    }),
    prisma.eventLibraryEntry.count({ where: where as never }),
  ]);

  // Apply in-memory filters for tags and search
  let filtered = entries;
  if (characterTag) {
    filtered = filtered.filter((e) => jsonArrayContains(e.characterTagsJson, characterTag));
    // Re-count for pagination after filtering
  }
  if (eventTypeTag) {
    filtered = filtered.filter((e) => jsonArrayContains(e.eventTypeTagsJson, eventTypeTag));
  }
  if (conflictTypeTag) {
    filtered = filtered.filter((e) => jsonArrayContains(e.conflictTypeTagsJson, conflictTypeTag));
  }
  if (q) {
    const lowerQ = q.toLowerCase();
    filtered = filtered.filter((e) =>
      e.canonicalTitle.toLowerCase().includes(lowerQ) ||
      e.summary.toLowerCase().includes(lowerQ),
    );
  }
  const filteredTotal = filtered.length;
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    statusCode: 200,
    body: {
      entries: paged.map((e) => ({
        id: e.id,
        canonical_title: e.canonicalTitle,
        summary: e.summary,
        dynasty: e.dynasty,
        era: e.era,
        character_tags: e.characterTagsJson,
        event_type_tags: e.eventTypeTagsJson,
        conflict_type_tags: e.conflictTypeTagsJson,
        theme_motifs: e.themeMotifsJson,
        location_tags: e.locationTagsJson,
        relationship_tags: e.relationshipTagsJson,
        credibility_level: e.credibilityLevel,
        origin_kind: e.originKind,
        angle_count: e.angles.length,
      })),
      total: filteredTotal,
      page,
      page_size: pageSize,
    },
  };
}

export async function getEntryController(
  context: RouteContext,
): Promise<AppResponse> {
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const entry = await prisma.eventLibraryEntry.findFirst({
    where: { id: context.params.entryId, status: "curated", visibility: "public" },
    include: { angles: true },
  });

  if (!entry) {
    return { statusCode: 404, body: { error: "entry_not_found" } };
  }

  return {
    statusCode: 200,
    body: {
      id: entry.id,
      canonical_title: entry.canonicalTitle,
      summary: entry.summary,
      dynasty: entry.dynasty,
      era: entry.era,
      character_tags: entry.characterTagsJson,
      event_type_tags: entry.eventTypeTagsJson,
      conflict_type_tags: entry.conflictTypeTagsJson,
      theme_motifs: entry.themeMotifsJson,
      time_range: entry.timeRangeJson,
      location_tags: entry.locationTagsJson,
      relationship_tags: entry.relationshipTagsJson,
      source_anchor_refs: entry.sourceAnchorRefsJson,
      credibility_level: entry.credibilityLevel,
      dispute_notes: entry.disputeNotes,
      origin_kind: entry.originKind,
      angles: (entry.angles as Array<{
        id: string;
        angleLabel: string;
        familyLabel: string;
        scopeLabel: string;
      }>).map((a) => ({
        id: a.id,
        angle_label: a.angleLabel,
        family_label: a.familyLabel,
        scope_label: a.scopeLabel,
      })),
    },
  };
}

export async function listDynastiesController(
  _context: RouteContext,
): Promise<AppResponse> {
  const prisma = _context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const rows = await prisma.eventLibraryEntry.findMany({
    where: { status: "curated", dynasty: { not: null } },
    select: { dynasty: true },
    distinct: ["dynasty"],
    orderBy: { dynasty: "asc" },
  });

  return {
    statusCode: 200,
    body: {
      dynasties: rows.map((r) => r.dynasty).filter(Boolean),
    },
  };
}

// ---- From Library: generate candidates from event library entry ----

interface FromLibraryPayload {
  event_library_entry_id: string;
  angle_id?: string;
}

function validateFromLibraryPayload(
  payload: unknown,
): { ok: true; value: FromLibraryPayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "invalid_payload" };
  }
  const record = payload as Record<string, unknown>;
  // 正式合同 camelCase；snake_case 为兼容别名
  const eventLibraryEntryId = getPayloadField(record, "eventLibraryEntryId", "event_library_entry_id");
  if (!eventLibraryEntryId) {
    return { ok: false, error: "eventLibraryEntryId is required" };
  }
  const angleId = getPayloadField(record, "angleId", "angle_id") || undefined;
  return { ok: true, value: { event_library_entry_id: eventLibraryEntryId, angle_id: angleId } };
}

export async function createTopicFromLibraryController(
  context: RouteContext,
): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const prisma = context.app.prismaClient;
  if (!prisma) return { statusCode: 503, body: { error: "database_unavailable" } };

  const validated = validateFromLibraryPayload(context.payload);
  if (!validated.ok) {
    return { statusCode: 400, body: { error: validated.error } };
  }

  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "选题");
  if (demoBlock) return demoBlock;

  // 2026-08-23（报价体系移除）：事件库入口不再封口，恢复本地直连执行
  // （不建 run/不记账，登记已知限制：辅助入口费用不入项目成本清单）

  // Look up event library entry
  const entry = await prisma.eventLibraryEntry.findFirst({
    where: { id: validated.value.event_library_entry_id, status: "curated", visibility: "public" },
    include: { angles: true },
  });
  if (!entry) {
    return { statusCode: 404, body: { error: "event_library_entry_not_found" } };
  }

  // Resolve angle if specified
  let selectedAngle: { angleLabel: string; familyLabel: string; scopeLabel: string } | undefined;
  if (validated.value.angle_id) {
    selectedAngle = (entry.angles as Array<{
      id: string;
      angleLabel: string;
      familyLabel: string;
      scopeLabel: string;
    }>).find((a) => a.id === validated.value.angle_id);
    if (!selectedAngle) {
      return { statusCode: 400, body: { error: "angle_not_found" } };
    }
  }

  // Build focus seed from entry
  const entryTags = Array.isArray(entry.eventTypeTagsJson)
    ? (entry.eventTypeTagsJson as string[])
    : [];
  const seedTitle = selectedAngle
    ? `${entry.canonicalTitle}：${selectedAngle.angleLabel}`
    : entry.canonicalTitle;

  // Set generating state
  project.status = "topic_generating";
  project.updatedAt = new Date();
  await context.app.db.firstAggregateWriter?.syncProject(project);

  try {
    // from-library 差异化合同（2026-07-24）：
    // - 3→1：用户已从事件库锁定单一 curated entry，不需要 8 个发散候选，
    //   builder 围绕该 entry 生成 3 个候选，selector 选 1 个返回。
    // - disableFallback=true：entry 已锁定 event_identity，不需要从
    //   topic-candidate-library 捞外部候选补位（与 from-custom 逻辑一致）。
    // - angle_hint：用户选了角度时透传给 builder prompt，作为硬约束角度锚
    //   （builder 必须围绕该角度的不同侧面生成，详见 candidate-builder.prompt.md）。
    const recommendation = await recommendTopicCandidatesWithTrace(
      context.app.db,
      {
        canonicalName: seedTitle,
        summary: entry.summary,
        coreConflict: selectedAngle?.familyLabel ?? entry.canonicalTitle,
        strongScene: selectedAngle?.angleLabel ?? entry.summary.slice(0, 50),
        sourceHint: "事件库",
        recentUsageHint: "首次从事件库选取",
        tags: entryTags.length > 0 ? entryTags : [entry.canonicalTitle],
        target_candidate_count: 3,
        final_candidate_count: 1,
        ...(selectedAngle
          ? {
              angle_hint: {
                label: selectedAngle.angleLabel,
                family: selectedAngle.familyLabel,
              },
            }
          : {}),
      },
      {
        projectId: project.id,
        rawCandidateTargetCount: 3,
        finalCandidateCount: 1,
        disableFallback: true,
      },
    );
    const candidates = recommendation.candidates;

    // Build sourceRef for traceability
    const sourceRef: Record<string, unknown> = { eventLibraryEntryId: entry.id };
    if (validated.value.angle_id) sourceRef.angleId = validated.value.angle_id;

    const storedCandidates = new Map<string, StoredTopicCandidate>();
    const responseCandidates = [];

    for (const candidate of candidates) {
      const normalizedCandidate = await normalizeEventInput(context.app.db, {
        rawInput: candidate.title,
        sourceType: "event_library",
      });
      const candidateId = randomUUID();
      storedCandidates.set(candidateId, {
        candidateId,
        projectId: project.id,
        event: normalizedCandidate.event,
        title: candidate.title,
        oneLineAngle: candidate.one_line_angle,
        familyLabel: candidate.family_label,
        scopeLabel: candidate.scope_label,
        coreConflict: candidate.core_conflict,
        strongScene: candidate.strong_scene,
        mustCoverPreview: candidate.must_cover_preview,
        sourceHint: candidate.source_hint,
        recentUsageHint: candidate.recent_usage_hint,
        whyThisNow: candidate.why_this_now,
        riskHints: [...candidate.risk_hints],
        viralRubric: candidate.viral_rubric
          ? { ...(candidate.viral_rubric as Record<string, string>) }
          : {},
        sourceMode: "library",
        sourceRef,
      });

      responseCandidates.push({
        candidate_id: candidateId,
        ...candidate,
      });
    }

    // Write to topicCandidateStore
    const topicRun = (recommendation as Record<string, unknown>).topic_run as Record<string, unknown> | undefined ?? {
      project_id: project.id,
      round_id: `topic_run_${randomUUID()}`,
      round_index: (context.app.topicCandidateStore.get(project.id)?.rounds.length ?? 0) + 1,
    };
    const projectTopicState = context.app.topicCandidateStore.get(project.id) ?? {
      candidatesById: new Map<string, StoredTopicCandidate>(),
      rounds: [],
    };

    for (const [candidateId, storedCandidate] of storedCandidates.entries()) {
      projectTopicState.candidatesById.set(candidateId, storedCandidate);
    }

    projectTopicState.rounds.push({
      roundId: String(topicRun.round_id),
      roundIndex: Number(topicRun.round_index),
      createdAt: new Date().toISOString(),
      candidates: [...storedCandidates.values()],
    } as never);
    context.app.topicCandidateStore.set(project.id, projectTopicState);

    project.status = "topic_candidates_ready";
    project.updatedAt = new Date();
    await context.app.db.firstAggregateWriter?.syncProject(project);

    return {
      statusCode: 200,
      body: {
        project_id: project.id,
        source_mode: "library",
        source_ref: sourceRef,
        candidates: responseCandidates,
      },
    };
  } catch (error) {
    project.status = "topic_pending";
    project.updatedAt = new Date();
    await context.app.db.firstAggregateWriter?.syncProject(project).catch(() => undefined);
    const message = error instanceof Error ? error.message : "topic_generate_failed";
    return {
      statusCode: 500,
      body: { error: "topic_generate_failed", message },
    };
  }
}
