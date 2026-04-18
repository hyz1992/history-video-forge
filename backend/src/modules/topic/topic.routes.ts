import type { AppInstance } from "../../app";
import {
  confirmTopicCandidateController,
  createProjectController,
  createTopicRecommendationsController,
} from "./topic.controller";

export function registerTopicRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects", createProjectController);
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/recommendations",
    createTopicRecommendationsController,
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/candidates/:candidateId/confirm",
    confirmTopicCandidateController,
  );
}
