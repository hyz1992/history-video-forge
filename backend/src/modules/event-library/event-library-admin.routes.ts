import type { AppInstance } from "../../app";
import { guardAdminRoute } from "../../auth/authorization.js";
import {
  listDraftsController,
  approveDraftController,
  rejectDraftController,
  listAdminEntriesController,
  updateAdminEntryController,
  triggerSyncController,
} from "./event-library-admin.controller.js";

export function registerEventLibraryAdminRoutes(app: AppInstance) {
  // Draft review
  app.addRoute("GET", "/api/admin/event-library/drafts", guardAdminRoute(listDraftsController));
  app.addRoute("POST", "/api/admin/event-library/drafts", guardAdminRoute(listDraftsController));
  app.addRoute("POST", "/api/admin/event-library/drafts/:draftId/approve", guardAdminRoute(approveDraftController));
  app.addRoute("POST", "/api/admin/event-library/drafts/:draftId/reject", guardAdminRoute(rejectDraftController));

  // Entry management
  app.addRoute("GET", "/api/admin/event-library/entries", guardAdminRoute(listAdminEntriesController));
  app.addRoute("PUT", "/api/admin/event-library/entries/:entryId", guardAdminRoute(updateAdminEntryController));

  // Sync
  app.addRoute("POST", "/api/admin/event-library/sync", guardAdminRoute(triggerSyncController));
}
