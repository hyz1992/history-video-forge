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
      { demoMode: context.app.env.demoMode },
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

export const deleteProjectController = guardOwnedRoute(
  async (context: RouteContext): Promise<AppResponse> => {
    const projectId = context.params.projectId;

    if (context.app.env.demoMode && context.app.env.protectedProjectIds.has(projectId)) {
      return {
        statusCode: 403,
        body: { error: "protected_project", message: "示例项目不允许删除" },
      };
    }

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
