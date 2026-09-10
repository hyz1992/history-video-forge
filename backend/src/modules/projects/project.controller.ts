import type { AppResponse, RouteContext } from "../../app";
import { getProjectSnapshot } from "./project-snapshot.service";
import { deleteProject } from "./project.repository";
import { listProjectSummaries } from "./project-summary.service";
import {
  guardOwnedRoute,
  guardUserRoute,
  requireOwner,
} from "../../auth/authorization.js";
import { requireAdmin, requireUser } from "../../auth/authorization.js";
import { NarrationPolicyError } from "../narration/narration-model-policy.js";
import { NarrationUpgradeError, previewNarrationModeUpgrade, upgradeProjectToNarrationFirst } from "../narration/narration-mode-upgrade.service.js";
import { ZodError } from "zod";

export const listProjectsController = guardUserRoute(
  (context: RouteContext): AppResponse => {
    const user = requireUser(context.auth);
    const ownerId = user.role === "ADMIN" ? undefined : user.userId;
    const projects = listProjectSummaries(context.app.db, ownerId);
    return { statusCode: 200, body: projects };
  },
);

export const getProjectSnapshotController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    const project = context.app.db.projects.get(context.params.projectId);
    if (!project) {
      return { statusCode: 404, body: { error: "project_not_found" } };
    }
    requireOwner(user, project.ownerId);

    const snapshot = await getProjectSnapshot(
      context.app.db,
      context.params.projectId,
      (context.app as any).topicCandidateStore,
    );
    if (!snapshot) {
      return {
        statusCode: 404,
        body: {
          error: "project_not_found",
        },
      };
    }

    return {
      statusCode: 200,
      body: snapshot,
    };
  },
);

export const previewNarrationModeUpgradeController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    try {
      const preview = await previewNarrationModeUpgrade(context.app.db, {
        projectId: context.params.projectId,
        user: { userId: user.userId, role: user.role },
      });
      return { statusCode: 200, body: preview };
    } catch (error) {
      if (error instanceof NarrationUpgradeError) return { statusCode: error.statusCode, body: error.body };
      if (error instanceof NarrationPolicyError) return { statusCode: error.statusCode, body: error.body };
      throw error;
    }
  },
);

export const upgradeNarrationModeController = guardUserRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const user = requireUser(context.auth);
    try {
      const result = await upgradeProjectToNarrationFirst(context.app.db, {
        projectId: context.params.projectId,
        user: { userId: user.userId, role: user.role },
        actorUserId: user.userId,
        request: context.payload,
      });
      return { statusCode: 200, body: result };
    } catch (error) {
      if (error instanceof ZodError) return { statusCode: 422, body: { error: "narration_request_invalid" } };
      if (error instanceof NarrationUpgradeError) return { statusCode: error.statusCode, body: error.body };
      if (error instanceof NarrationPolicyError) return { statusCode: error.statusCode, body: error.body };
      throw error;
    }
  },
);

export const deleteProjectController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const projectId = context.params.projectId;

    const deleted = await deleteProject(
      context.app.db,
      projectId,
    );
    if (deleted === null) {
      return {
        statusCode: 404,
        body: { error: "project_not_found" },
      };
    }
    if (!deleted.deleted) {
      return { statusCode: 409, body: { error: deleted.error } };
    }

    context.app.topicCandidateStore.delete(context.params.projectId);

    return {
      statusCode: 200,
      body: { deleted: true },
    };
  },
);
