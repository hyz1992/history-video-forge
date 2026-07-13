import type { AppInstance } from "../../app";
import {
  confirmTopicCandidateController,
  createProjectController,
  createTopicRecommendationsController,
} from "./topic.controller";
import { guardOwnedRoute, guardUserRoute } from "../../auth/authorization.js";

export function registerTopicRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects", guardUserRoute(createProjectController));
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/recommendations",
    guardOwnedRoute(createTopicRecommendationsController),
  );
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/candidates/:candidateId/confirm",
    guardOwnedRoute(confirmTopicCandidateController),
  );
}
