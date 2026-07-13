import type { AppInstance } from "../../app";
import {
  coverGenerateController,
  coverPromptOptimizeController,
  coverUploadController,
  publishGenerateController,
  publishUpdateController,
  titleCandidatesController,
} from "./publish.controller";
import { guardUserRoute } from "../../auth/authorization.js";

export function registerPublishRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects/:projectId/publish/generate", guardUserRoute(publishGenerateController));
  app.addRoute("PATCH", "/api/projects/:projectId/publish", guardUserRoute(publishUpdateController));
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/prompt/optimize", guardUserRoute(coverPromptOptimizeController));
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/upload", guardUserRoute(coverUploadController));
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/generate", guardUserRoute(coverGenerateController));
  app.addRoute("POST", "/api/projects/:projectId/publish/title/candidates", guardUserRoute(titleCandidatesController));
}
