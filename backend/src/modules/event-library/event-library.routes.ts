import type { AppInstance } from "../../app";
import {
  listEntriesController,
  getEntryController,
  listDynastiesController,
  createTopicFromLibraryController,
} from "./event-library.controller";
import { guardOwnedRoute } from "../../auth/authorization.js";

export function registerEventLibraryRoutes(app: AppInstance) {
  // 正式合同 GET；POST 为兼容别名（payload 筛选）
  app.addRoute("GET", "/api/event-library/entries", listEntriesController);
  app.addRoute("POST", "/api/event-library/entries", listEntriesController);
  app.addRoute("GET", "/api/event-library/entries/:entryId", getEntryController);
  app.addRoute("GET", "/api/event-library/dynasties", listDynastiesController);
  app.addRoute(
    "POST",
    "/api/projects/:projectId/topic/from-library",
    guardOwnedRoute(createTopicFromLibraryController),
  );
}
