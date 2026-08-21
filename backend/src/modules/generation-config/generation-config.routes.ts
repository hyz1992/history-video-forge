import type { AppInstance } from "../../app.js";
import {
  getCreativePresetsController,
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
  // S2-2B：画风/字幕 preset 公开目录
  app.addRoute("GET", "/api/creative-presets", getCreativePresetsController);
}
