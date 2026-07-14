import type { AppInstance } from "../../app.js";
import {
  createUserController,
  disableUserController,
  enableUserController,
  listProjectsController,
  listUsersController,
  queryAuditLogsController,
  resetPasswordController,
  revokeUserSessionsController,
  transferProjectOwnerController,
} from "./admin.controller.js";

export function registerAdminRoutes(app: AppInstance) {
  app.addRoute("GET", "/api/admin/users", listUsersController);
  app.addRoute("POST", "/api/admin/users", createUserController);
  app.addRoute("POST", "/api/admin/users/:userId/disable", disableUserController);
  app.addRoute("POST", "/api/admin/users/:userId/enable", enableUserController);
  app.addRoute("POST", "/api/admin/users/:userId/reset-password", resetPasswordController);
  app.addRoute("POST", "/api/admin/users/:userId/sessions/revoke", revokeUserSessionsController);
  app.addRoute("GET", "/api/admin/projects", listProjectsController);
  app.addRoute("POST", "/api/admin/projects/:projectId/transfer-owner", transferProjectOwnerController);
  app.addRoute("POST", "/api/admin/audit-logs/query", queryAuditLogsController);
}
