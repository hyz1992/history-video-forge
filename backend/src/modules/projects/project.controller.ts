import type { AppResponse, RouteContext } from "../../app";
import { getProjectSnapshot } from "./project-snapshot.service";

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
