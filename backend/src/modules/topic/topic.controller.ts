import { randomUUID } from "node:crypto";

import type { AppResponse, RouteContext } from "../../app";
import { createProject, getProjectById } from "../projects/project.repository";
import { normalizeEventInput } from "./event-normalizer";
import { recommendTopicCandidatesWithTrace } from "./topic-recommendation.service";
import {
  confirmTopicCandidate,
  type StoredTopicCandidate,
} from "./topic-confirm.service";

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
    risk_hints: [],
  };
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
  const project = await createProject(context.app.db, {
    name: context.payload?.name ?? "Untitled Project",
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
    });

    responseCandidates.push({
      candidate_id: candidateId,
      ...candidate,
    });
  }

  const topicRun = recommendation.topic_run ?? {
    project_id: project.id,
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
    roundId: topicRun.round_id,
    roundIndex: topicRun.round_index,
    createdAt: new Date().toISOString(),
    candidates: [...storedCandidates.values()],
  });
  context.app.topicCandidateStore.set(project.id, projectTopicState);

  const currentRound = projectTopicState.rounds.at(-1);
  const historyRounds = projectTopicState.rounds.slice(0, -1);

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      event_id: projectTopicState.rounds.at(-1)?.candidates[0]?.event.id ?? null,
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
