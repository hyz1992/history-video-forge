import type { AppInstance } from "../../app";
import { getProjectSnapshotController } from "./project.controller";

export function registerProjectRoutes(app: AppInstance) {
  app.addRoute("GET", "/api/projects/:projectId", getProjectSnapshotController);
}
