import type { AppInstance } from "../../app";
import { guardAdminRoute } from "../../auth/authorization.js";
import {
  listDraftsController,
  reviewDraftController,
  approveDraftController,
  rejectDraftController,
  listAdminEntriesController,
  updateAdminEntryController,
  createAdminEntryController,
  archiveAdminEntryController,
  triggerSyncController,
} from "./event-library-admin.controller.js";

export function registerEventLibraryAdminRoutes(app: AppInstance) {
  // Draft review（正式合同）
  app.addRoute("GET", "/api/admin/event-library/drafts", guardAdminRoute(listDraftsController));
  app.addRoute("POST", "/api/admin/event-library/drafts", guardAdminRoute(listDraftsController));
  app.addRoute("POST", "/api/admin/event-library/drafts/:draftId/review", guardAdminRoute(reviewDraftController));

  // 兼容别名
  app.addRoute("POST", "/api/admin/event-library/drafts/:draftId/approve", guardAdminRoute(approveDraftController));
  app.addRoute("POST", "/api/admin/event-library/drafts/:draftId/reject", guardAdminRoute(rejectDraftController));

  // Entry management
  app.addRoute("GET", "/api/admin/event-library/entries", guardAdminRoute(listAdminEntriesController));
  app.addRoute("POST", "/api/admin/event-library/entries", guardAdminRoute(createAdminEntryController));
  app.addRoute("PUT", "/api/admin/event-library/entries/:entryId", guardAdminRoute(updateAdminEntryController));
  app.addRoute("PATCH", "/api/admin/event-library/entries/:entryId", guardAdminRoute(updateAdminEntryController));
  app.addRoute("DELETE", "/api/admin/event-library/entries/:entryId", guardAdminRoute(archiveAdminEntryController));

  // Sync
  app.addRoute("POST", "/api/admin/event-library/sync", guardAdminRoute(triggerSyncController));
}
