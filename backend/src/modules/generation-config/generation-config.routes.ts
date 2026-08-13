import type { AppInstance } from "../../app.js";
import {
  getGenerationCapabilitiesController,
  getProjectConfigController,
  getUserPreferenceController,
  patchProjectConfigController,
  patchUserPreferenceController,
} from "./generation-config.controller.js";

export function registerGenerationConfigRoutes(app: AppInstance) {
  app.addRoute("GET", "/api/me/generation-preferences", getUserPreferenceController);
  app.addRoute("PATCH", "/api/me/generation-preferences", patchUserPreferenceController);
  app.addRoute("GET", "/api/projects/:projectId/generation-configuration", getProjectConfigController);
  app.addRoute("PATCH", "/api/projects/:projectId/generation-configuration", patchProjectConfigController);
  app.addRoute("GET", "/api/generation-capabilities", getGenerationCapabilitiesController);
}
