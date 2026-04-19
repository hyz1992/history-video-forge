import { randomUUID } from "node:crypto";

import type { AppResponse, RouteContext } from "../../app";
import { createProject, getProjectById } from "../projects/project.repository";
import { normalizeEventInput } from "./event-normalizer";
import { recommendTopicCandidates } from "./topic-recommendation.service";
import {
  confirmTopicCandidate,
  type StoredTopicCandidate,
} from "./topic-confirm.service";

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

  const candidates = await recommendTopicCandidates(
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

  context.app.topicCandidateStore.set(project.id, storedCandidates);

  return {
    statusCode: 200,
    body: {
      project_id: project.id,
      event_id: normalized.event.id,
      candidates: responseCandidates,
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

  const projectCandidates = context.app.topicCandidateStore.get(project.id);
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
