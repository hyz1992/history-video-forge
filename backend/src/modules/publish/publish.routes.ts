import type { AppInstance } from "../../app";
import {
  coverGenerateController,
  coverPromptOptimizeController,
  coverUploadController,
  publishGenerateController,
  publishUpdateController,
  titleCandidatesController,
} from "./publish.controller";
import { guardOwnedRoute } from "../../auth/authorization.js";

export function registerPublishRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects/:projectId/publish/generate", guardOwnedRoute(publishGenerateController));
  app.addRoute("PATCH", "/api/projects/:projectId/publish", guardOwnedRoute(publishUpdateController));
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/prompt/optimize", guardOwnedRoute(coverPromptOptimizeController));
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/upload", guardOwnedRoute(coverUploadController));
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/generate", guardOwnedRoute(coverGenerateController));
  app.addRoute("POST", "/api/projects/:projectId/publish/title/candidates", guardOwnedRoute(titleCandidatesController));
}
