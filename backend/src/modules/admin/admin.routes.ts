import type { AppInstance } from "../../app.js";
import {
  listProjectsController,
  listUsersController,
  queryAuditLogsController,
} from "./admin.controller.js";

export function registerAdminRoutes(app: AppInstance) {
  app.addRoute("GET", "/api/admin/users", listUsersController);
  app.addRoute("GET", "/api/admin/projects", listProjectsController);
  app.addRoute("POST", "/api/admin/audit-logs/query", queryAuditLogsController);
}
