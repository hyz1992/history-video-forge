import type { AppInstance } from "../../app";
import { deleteProjectController, getProjectSnapshotController, listProjectsController, previewNarrationModeUpgradeController, upgradeNarrationModeController } from "./project.controller";

export function registerProjectRoutes(app: AppInstance) {
  app.addRoute("GET", "/api/projects", listProjectsController);
  app.addRoute("GET", "/api/projects/:projectId", getProjectSnapshotController);
  app.addRoute("DELETE", "/api/projects/:projectId", deleteProjectController);
  app.addRoute("GET", "/api/projects/:projectId/narration-mode/upgrade/preview", previewNarrationModeUpgradeController);
  app.addRoute("POST", "/api/projects/:projectId/narration-mode/upgrade", upgradeNarrationModeController);
}
