import { randomUUID } from "node:crypto";

import type { AppResponse, RouteContext } from "../../app";
import { createProject, getProjectById } from "../projects/project.repository";
import { normalizeEventInput } from "./event-normalizer";
import { recommendTopicCandidatesWithTrace } from "./topic-recommendation.service";
import {
  confirmTopicCandidate,
  type StoredTopicCandidate,
} from "./topic-confirm.service";

function toResponseCandidate(candidate: StoredTopicCandidate) {
  return {
    candidate_id: candidate.candidateId,
    title: candidate.title,
    one_line_angle: candidate.oneLineAngle,
    family_label: candidate.familyLabel,
    scope_label: candidate.scopeLabel,
    strong_scene: candidate.strongScene,
    risk_hints: [],
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
  const project = await getProjectById(context.app.db, context.params.projectId);
  if (!project) {
    return {
      statusCode: 404,
      body: {
        error: "project_not_found",
      },
    };
  }

  const normalized = await normalizeEventInput(context.app.db, {
    rawInput: context.payload.canonical_name,
    aliases: context.payload.aliases,
    sourceType: "system_recommendation",
  });

  const recommendation = await recommendTopicCandidatesWithTrace(
    context.app.db,
    {
      canonicalName: context.payload.canonical_name,
      summary: context.payload.summary,
      coreConflict: context.payload.core_conflict,
      strongScene: context.payload.strong_scene,
      sourceHint: context.payload.source_hint,
      recentUsageHint: context.payload.recent_usage_hint,
      tags: context.payload.tags,
    },
    {
      projectId: project.id,
    },
  );
  const candidates = recommendation.candidates;

  const storedCandidates = new Map<string, StoredTopicCandidate>();
  const responseCandidates = candidates.map((candidate) => {
    const candidateId = randomUUID();
    storedCandidates.set(candidateId, {
      candidateId,
      projectId: project.id,
      event: normalized.event,
      title: candidate.title,
      oneLineAngle: candidate.one_line_angle,
      familyLabel: candidate.family_label,
      scopeLabel: candidate.scope_label,
      coreConflict: candidate.core_conflict,
      strongScene: candidate.strong_scene,
      sourceHint: candidate.source_hint,
      recentUsageHint: candidate.recent_usage_hint,
    });

    return {
      candidate_id: candidateId,
      ...candidate,
    };
  });

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
      event_id: normalized.event.id,
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
