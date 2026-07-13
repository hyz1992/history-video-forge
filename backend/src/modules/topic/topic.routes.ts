import type { AppInstance } from "../../app";
import {
  confirmTopicCandidateController,
  createProjectController,
  createTopicRecommendationsController,
} from "./topic.controller";
import { guardUserRoute } from "../../auth/authorization.js";

export function registerTopicRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects", guardUserRoute(createProjectController));
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/recommendations",
    guardUserRoute(createTopicRecommendationsController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/candidates/:candidateId/confirm",
    guardUserRoute(confirmTopicCandidateController),
  );
}
