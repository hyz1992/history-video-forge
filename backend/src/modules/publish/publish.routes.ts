import type { AppInstance } from "../../app";
import {
  coverGenerateController,
  coverPromptOptimizeController,
  coverUploadController,
  publishGenerateController,
  publishUpdateController,
  titleCandidatesController,
} from "./publish.controller";

export function registerPublishRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects/:projectId/publish/generate", publishGenerateController);
  app.addRoute("PATCH", "/api/projects/:projectId/publish", publishUpdateController);
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/prompt/optimize", coverPromptOptimizeController);
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/upload", coverUploadController);
  app.addRoute("POST", "/api/projects/:projectId/publish/cover/generate", coverGenerateController);
  app.addRoute("POST", "/api/projects/:projectId/publish/title/candidates", titleCandidatesController);
}
