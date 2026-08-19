import type { AppInstance } from "../../app.js";
import {
  createGenerationQuoteController,
  getProjectCostRecordsController,
  getProjectCostSummaryController,
  getRunConfigurationController,
} from "./generation-cost.controller.js";

export function registerGenerationCostRoutes(app: AppInstance) {
  app.addRoute("POST", "/api/projects/:projectId/generation-cost-quotes", createGenerationQuoteController);
  app.addRoute("GET", "/api/projects/:projectId/costs/summary", getProjectCostSummaryController);
  app.addRoute("GET", "/api/projects/:projectId/costs/records", getProjectCostRecordsController);
  app.addRoute("GET", "/api/projects/:projectId/runs/:runId/configuration", getRunConfigurationController);
}
