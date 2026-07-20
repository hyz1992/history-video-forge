import { randomUUID } from "node:crypto";

import type { AppResponse, RouteContext } from "../../app";
import { createProject, getProjectById } from "../projects/project.repository";
import { demoStageGuard } from "../../shared/demo-stage-guard";
import { normalizeEventInput } from "./event-normalizer";
import { requireUser } from "../../auth/authorization.js";
import {
  isProviderContentFilterError,
  recommendTopicCandidates,
  recommendTopicCandidatesWithTrace,
} from "./topic-recommendation.service";
import {
  confirmTopicCandidate,
  type StoredTopicCandidate,
} from "./topic-confirm.service";
import { writeRefluxDraft } from "../event-library/event-library-draft.writer.js";
import { createDraft } from "../event-library/event-library-draft.repository.js";
import { refineCustomTopic } from "./topic-custom-refine.service.js";
import { validateCustomDigest } from "./topic-custom-input.service.js";

interface TopicRecommendationSeedPayload {
  canonical_name: string;
  summary: string;
  core_conflict: string;
  strong_scene: string;
  source_hint: string;
  recent_usage_hint: string;
  tags: string[];
  aliases?: string[];
  canonical_quotes?: string[];
  canonical_quote_intents?: Array<{ quote: string; intent: string }>;
}

function toResponseCandidate(candidate: StoredTopicCandidate) {
  return {
    candidate_id: candidate.candidateId,
    title: candidate.title,
    one_line_angle: candidate.oneLineAngle,
    family_label: candidate.familyLabel,
    scope_label: candidate.scopeLabel,
    strong_scene: candidate.strongScene,
    must_cover_preview: candidate.mustCoverPreview ?? [],
    why_this_now: candidate.whyThisNow ?? "",
    risk_hints: candidate.riskHints ?? [],
    core_conflict: candidate.coreConflict,
    source_hint: candidate.sourceHint,
    viral_rubric: candidate.viralRubric ?? {},
  };
}

function normalizeTopicGenerationErrorMessage(error: unknown) {
  const fallback = "topic_generate_failed";
  if (isProviderContentFilterError(error)) {
    return "上游模型安全策略拦截了本次选题推荐，系统已自动重试但仍未成功。请点击重试，或换一个更中性的事件范围再生成。";
  }

  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return fallback;
  }

  const message = error.message.trim();
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as {
        error?: {
          message?: unknown;
        };
        message?: unknown;
      };
      const providerMessage =
        typeof parsed.error?.message === "string"
          ? parsed.error.message
          : typeof parsed.message === "string"
            ? parsed.message
            : "";
      if (providerMessage.trim().length > 0) {
        return providerMessage.trim();
      }
    } catch {
      // Keep the original message when the provider body is not valid JSON.
    }
  }

  return message;
}

function readNonEmptyStringField(
  payload: Record<string, unknown>,
  field: keyof TopicRecommendationSeedPayload,
  invalidFields: string[],
) {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidFields.push(field);
    return "";
  }

  return value;
}

function validateTopicRecommendationSeed(
  payload: unknown,
):
  | {
      ok: true;
      value: TopicRecommendationSeedPayload;
    }
  | {
      ok: false;
      invalidFields: string[];
    } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      invalidFields: [
        "canonical_name",
        "summary",
        "core_conflict",
        "strong_scene",
        "source_hint",
        "recent_usage_hint",
        "tags",
      ],
    };
  }

  const record = payload as Record<string, unknown>;
  const invalidFields: string[] = [];
  const value: TopicRecommendationSeedPayload = {
    canonical_name: readNonEmptyStringField(record, "canonical_name", invalidFields),
    summary: readNonEmptyStringField(record, "summary", invalidFields),
    core_conflict: readNonEmptyStringField(record, "core_conflict", invalidFields),
    strong_scene: readNonEmptyStringField(record, "strong_scene", invalidFields),
    source_hint: readNonEmptyStringField(record, "source_hint", invalidFields),
    recent_usage_hint: readNonEmptyStringField(record, "recent_usage_hint", invalidFields),
    tags: [],
  };

  if (!Array.isArray(record.tags) || record.tags.length === 0) {
    invalidFields.push("tags");
  } else {
    const normalizedTags = record.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    if (normalizedTags.length === 0) {
      invalidFields.push("tags");
    } else {
      value.tags = normalizedTags;
    }
  }

  if (Array.isArray(record.aliases)) {
    value.aliases = record.aliases.filter(
      (alias): alias is string => typeof alias === "string" && alias.trim().length > 0,
    );
  }

  if (Array.isArray(record.canonical_quotes)) {
    value.canonical_quotes = Array.from(
      new Set(
        record.canonical_quotes
          .filter((quote): quote is string => typeof quote === "string")
          .map((quote) => quote.trim())
          .filter(Boolean),
      ),
    );
  }

  if (Array.isArray(record.canonical_quote_intents)) {
    value.canonical_quote_intents = record.canonical_quote_intents
      .filter(
        (item): item is { quote: string; intent: string } =>
          !!item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof (item as Record<string, unknown>).quote === "string" &&
          typeof (item as Record<string, unknown>).intent === "string",
      )
      .map((item) => ({
        quote: item.quote.trim(),
        intent: item.intent.trim(),
      }))
      .filter((item) => item.quote.length > 0 && item.intent.length > 0);
  }

  if (invalidFields.length > 0) {
    return {
      ok: false,
      invalidFields,
    };
  }

  return {
    ok: true,
    value,
  };
}

export async function createProjectController(
  context: RouteContext,
): Promise<AppResponse> {
  const user = requireUser(context.auth);
  const project = await createProject(context.app.db, {
    name: context.payload?.name ?? "Untitled Project",
    ownerId: user.userId,
    createdById: user.userId,
  });

  return {
    statusCode: 201,
    body: {
      project_id: project.id,
      current_status: project.status,
    },
  };
}

export async function createTopicRecommendationsController(
  context: RouteContext,
): Promise<AppResponse> {
  const validatedPayload = validateTopicRecommendationSeed(context.payload);
  if (!validatedPayload.ok) {
    return {
      statusCode: 400,
      body: {
        error: "invalid_topic_recommendation_seed",
        invalid_fields: validatedPayload.invalidFields,
      },
    };
  }

  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "选题");
  if (demoBlock) return demoBlock;

  // Set generating state BEFORE LLM call so refresh shows progress
  project.status = "topic_generating";
  project.updatedAt = new Date();
  await context.app.db.firstAggregateWriter?.syncProject(project);

  try {
    const recommendation = await recommendTopicCandidatesWithTrace(
    context.app.db,
    {
      canonicalName: validatedPayload.value.canonical_name,
      summary: validatedPayload.value.summary,
      coreConflict: validatedPayload.value.core_conflict,
      strongScene: validatedPayload.value.strong_scene,
      sourceHint: validatedPayload.value.source_hint,
      recentUsageHint: validatedPayload.value.recent_usage_hint,
      canonicalQuotes: validatedPayload.value.canonical_quotes,
      canonicalQuoteIntents: validatedPayload.value.canonical_quote_intents,
      tags: validatedPayload.value.tags,
    },
    {
      projectId: project.id,
    },
  );
  const candidates = recommendation.candidates;

  const storedCandidates = new Map<string, StoredTopicCandidate>();
  const responseCandidates = [];

  for (const candidate of candidates) {
    const normalizedCandidate = await normalizeEventInput(context.app.db, {
      rawInput: candidate.title,
      canonicalQuotes: validatedPayload.value.canonical_quotes,
      canonicalQuoteIntents: validatedPayload.value.canonical_quote_intents,
      sourceType: "system_recommendation",
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
    });

    responseCandidates.push({
      candidate_id: candidateId,
      ...candidate,
    });
  }

  const topicRun = (recommendation as Record<string, unknown>).topic_run as Record<string, unknown> | undefined ?? {
    project_id: project.id as string,
    round_id: `topic_run_${randomUUID()}`,
    round_index:
      (context.app.topicCandidateStore.get(project.id)?.rounds.length ?? 0) + 1,
    previous_round_count:
      context.app.topicCandidateStore.get(project.id)?.rounds.length ?? 0,
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

  // 生成成功，状态转换为 candidates_ready
  project.status = "topic_candidates_ready";
  project.updatedAt = new Date();
  await context.app.db.firstAggregateWriter?.syncProject(project);

  // 推荐回流：异步写 EventLibraryDraft(recommendation_reflux)，不阻塞响应
  const prismaClient = context.app.prismaClient;
  if (prismaClient && !context.auth.anonymous) {
    const ownerId = context.auth.userId;
    setImmediate(() => {
      for (const storedCandidate of storedCandidates.values()) {
        writeRefluxDraft({
          prisma: prismaClient,
          candidate: storedCandidate,
          projectId: project.id,
          ownerId,
        });
      }
    });
  }

  const currentRound = projectTopicState.rounds.at(-1);
  const historyRounds = projectTopicState.rounds.slice(0, -1);

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      event_id: projectTopicState.rounds.at(-1)?.candidates[0]?.event.id ?? null,
      topic_run_id: (topicRun["round_id"] ?? topicRun["topic_run_id"]) as string,
      topic_run_index: (topicRun["round_index"] ?? topicRun["topic_run_index"]) as number,
      candidates: responseCandidates,
      current_round: currentRound
        ? {
            round_id: currentRound.roundId,
            round_index: currentRound.roundIndex,
            created_at: currentRound.createdAt,
            candidates: currentRound.candidates.map(toResponseCandidate),
          }
        : null,
      history_rounds: historyRounds.map((round) => ({
        round_id: round.roundId,
        round_index: round.roundIndex,
        created_at: round.createdAt,
        candidates: round.candidates.map(toResponseCandidate),
      })),
      graph_trace_summary: recommendation.trace,
      runtime_diagnostics: recommendation.diagnostics,
    },
  };
  } catch (error) {
    project.status = "topic_pending";
    project.updatedAt = new Date();
    await context.app.db.firstAggregateWriter?.syncProject(project).catch(() => undefined);
    const message = normalizeTopicGenerationErrorMessage(error);
    return {
      statusCode: 500,
      body: { error: "topic_generate_failed", message },
    };
  }
}

/** 顺序无关的浅层深等比较，避免 JSON.stringify 因字段顺序不同而误判 */
function sourceRefEquals(
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
): boolean {
  if (left === null || right === null) return left === right;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key, index) => {
    const rightKey = rightKeys[index];
    return key === rightKey && left[key] === right[rightKey];
  });
}

export async function confirmTopicCandidateController(
  context: RouteContext,
): Promise<AppResponse> {
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "选题");
  if (demoBlock) return demoBlock;

  const projectCandidates = context.app.topicCandidateStore.get(project.id)?.candidatesById;
  const candidate = projectCandidates?.get(context.params.candidateId);
  if (!candidate) {
    return {
      statusCode: 404,
      body: {
        error: "candidate_not_found",
      },
    };
  }

  // sourceMode 校验：payload 中显式传入时需与 candidate 一致
  const payloadMode = (context.payload as Record<string, unknown>)?.sourceMode as string | undefined;
  if (payloadMode !== undefined) {
    const validModes = ["recommended", "library", "custom"];
    if (!validModes.includes(payloadMode)) {
      return {
        statusCode: 400,
        body: {
          error: "invalid_source_mode",
          message: `sourceMode 必须为 recommended/library/custom 之一`,
        },
      };
    }
    const candidateMode = candidate.sourceMode ?? "recommended";
    if (payloadMode !== candidateMode) {
      return {
        statusCode: 400,
        body: {
          error: "source_mode_mismatch",
          message: `传入 sourceMode=${payloadMode} 与 candidate 的 ${candidateMode} 不匹配`,
        },
      };
    }
  }

  // sourceRef 校验：payload 中显式传入时需与 candidate 一致（顺序无关深等比较）
  const payloadRef = (context.payload as Record<string, unknown>)?.sourceRef as Record<string, unknown> | undefined;
  if (payloadRef !== undefined) {
    const candidateRef = candidate.sourceRef ?? null;
    if (!sourceRefEquals(payloadRef, candidateRef)) {
      return {
        statusCode: 400,
        body: {
          error: "source_ref_mismatch",
          message: "传入 sourceRef 与 candidate 存储的 sourceRef 不一致",
        },
      };
    }
  }

  const confirmed = await confirmTopicCandidate({
    projectDb: context.app.db,
    project,
    candidate,
  });

  return {
    statusCode: 200,
    body: confirmed,
  };
}

// ---- 自定义选题（入口 C） ----

export async function createTopicFromCustomController(
  context: RouteContext,
): Promise<AppResponse> {
  // 1. 输入校验（10-500 字）
  const rawDigest = (context.payload as Record<string, unknown>)?.rawDigest;
  const digestResult = validateCustomDigest(rawDigest);
  if (!digestResult.ok) {
    return { statusCode: 400, body: { error: "invalid_custom_digest", message: digestResult.error } };
  }

  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return { statusCode: 404, body: { error: "project_not_found" } };
  }

  const demoBlock = demoStageGuard(project, context.app.env.demoMode, "选题");
  if (demoBlock) return demoBlock;

  // 2. set generating state
  project.status = "topic_generating";
  project.updatedAt = new Date();
  await context.app.db.firstAggregateWriter?.syncProject(project);

  try {
    // 3. LLM 提炼结构化事件
    const { refined } = await refineCustomTopic({ rawDigest: digestResult.value });

    // 4. normalize（走身份账本去重）
    const normalized = await normalizeEventInput(context.app.db, {
      rawInput: refined.canonicalName,
      aliases: refined.characterTags,
      sourceType: "custom",
    });

    // 5. 先同步创建 EventLibraryDraft(draftKind=custom)，拿到 draft.id
    //    （合同要求：draft 先于 candidate，避免 draft 失败污染 store）
    let customDraftId: string | null = null;
    const prismaClient = context.app.prismaClient;
    if (prismaClient && !context.auth.anonymous) {
      const draft = await createDraft(prismaClient, {
        draftKind: "custom",
        projectId: project.id,
        proposedTitle: refined.canonicalName,
        proposedSummary: refined.summary,
        proposedAngles: [],
        proposedTags: { events: [refined.canonicalName] },
        rawCustomDigest: digestResult.value,
        customRefinedEvent: refined,
        ownerId: context.auth.userId,
      });
      customDraftId = draft.id;
    }

    // 6. 生成 candidate
    const candidates = await recommendTopicCandidates(
      context.app.db,
      {
        canonicalName: refined.canonicalName,
        summary: refined.summary,
        coreConflict: refined.summary.slice(0, 50),
        strongScene: refined.summary.slice(0, 50),
        sourceHint: "自定义输入",
        recentUsageHint: "首次从自定义输入选取",
        tags: refined.eventTypeTags,
      },
    );

    // 7. 构建 candidate 对象（写入 store + response）
    const storedCandidates = new Map<string, StoredTopicCandidate>();
    const responseCandidates: Array<Record<string, unknown>> = [];

    for (const candidate of candidates) {
      const normalizedCandidate = await normalizeEventInput(context.app.db, {
        rawInput: candidate.title,
        sourceType: "custom",
      });
      const candidateId = randomUUID();

      const sourceRef: Record<string, unknown> = { customDraftId };

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
        sourceMode: "custom",
        sourceRef,
      });

      responseCandidates.push({
        candidate_id: candidateId,
        ...candidate,
      });
    }

    // 8. write to topicCandidateStore
    const projectTopicState = context.app.topicCandidateStore.get(project.id) ?? {
      candidatesById: new Map<string, StoredTopicCandidate>(),
      rounds: [],
    };
    for (const [candidateId, storedCandidate] of storedCandidates.entries()) {
      projectTopicState.candidatesById.set(candidateId, storedCandidate);
    }
    projectTopicState.rounds.push({
      roundId: `topic_run_${randomUUID()}`,
      roundIndex: (projectTopicState.rounds.length) + 1,
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
        source_mode: "custom",
        source_ref: { customDraftId },
        candidates: responseCandidates,
        refined,
      },
    };
  } catch (error) {
    project.status = "topic_pending";
    project.updatedAt = new Date();
    await context.app.db.firstAggregateWriter?.syncProject(project).catch(() => undefined);

    // ZodError → 422（LLM 输出结构不符合 schema）
    if (error instanceof Error && error.name === "ZodError") {
      return {
        statusCode: 422,
        body: { error: "custom_refine_failed", message: "无法从输入中提炼出合格事件" },
      };
    }

    // LLM / 网关调用失败 → 503 重试友好提示
    return {
      statusCode: 503,
      body: { error: "custom_refine_unavailable", message: "提炼服务暂时不可用，请稍后重试" },
    };
  }
}
