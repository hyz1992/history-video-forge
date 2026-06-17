import type { AppInstance } from "../../app";
import { publishGenerateController, publishUpdateController } from "./publish.controller";

export function registerPublishRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects/:projectId/publish/generate", publishGenerateController);
  app.addRoute("PATCH", "/api/projects/:projectId/publish", publishUpdateController);
}
