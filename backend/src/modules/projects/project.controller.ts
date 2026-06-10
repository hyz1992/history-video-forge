import type { AppResponse, RouteContext } from "../../app";
import { getProjectSnapshot } from "./project-snapshot.service";
import { deleteProject } from "./project.repository";
import { listProjectSummaries } from "./project-summary.service";

export async function listProjectsController(
  _context: RouteContext,
): Promise<AppResponse> {
  const projects = listProjectSummaries(_context.app.db);
  return { statusCode: 200, body: projects };
}

export async function getProjectSnapshotController(
  context: RouteContext,
): Promise<AppResponse> {
  const snapshot = await getProjectSnapshot(
    context.app.db,
    context.params.projectId,
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
}

export async function deleteProjectController(
  context: RouteContext,
): Promise<AppResponse> {
  const deleted = await deleteProject(
    context.app.db,
    context.params.projectId,
  );
  if (!deleted) {
    return {
      statusCode: 404,
      body: { error: "project_not_found" },
    };
  }

  return {
    statusCode: 200,
    body: { deleted: true },
  };
}
