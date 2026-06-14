import { env } from "./config/env";
import { createDbClient, type DbClient } from "./db/client";
import { loadDbSnapshot, recoverProjectsFromDisk, saveDbSnapshot, saveProjectMetadata } from "./db/persistence";
import { registerProjectRoutes } from "./modules/projects/project.routes";
import { registerTopicRoutes } from "./modules/topic/topic.routes";
import { registerScriptRoutes } from "./modules/script/script.routes";
import { registerStoryboardRoutes } from "./modules/storyboard/storyboard.routes";
import { registerAssetPlanningRoutes } from "./modules/asset-planning/asset-planning.routes";
import { registerAssetsRoutes } from "./modules/assets/assets.routes";
import { registerComposeRoutes } from "./modules/compose/compose.routes";
import { registerRenderRoutes } from "./modules/render/render.routes";
import type { RenderAdapter } from "./modules/render/render-adapter";
import type { StoredTopicCandidate } from "./modules/topic/topic-confirm.service";

export interface StoredTopicCandidateRound {
  roundId: string;
  roundIndex: number;
  createdAt: string;
  candidates: StoredTopicCandidate[];
}

export interface ProjectTopicCandidateState {
  candidatesById: Map<string, StoredTopicCandidate>;
  rounds: StoredTopicCandidateRound[];
}

export interface InjectRequest {
  method: string;
  url: string;
  payload?: any;
}

export interface AppResponse {
  statusCode: number;
  body: unknown;
}

export interface InjectResponse {
  statusCode: number;
  json: () => any;
}

export interface RouteContext {
  app: AppInstance;
  params: Record<string, string>;
  payload: any;
}

type RouteHandler = (context: RouteContext) => Promise<AppResponse> | AppResponse;

interface RouteRecord {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

export interface AppInstance {
  env: typeof env;
  db: DbClient;
  renderAdapter?: RenderAdapter;
  topicCandidateStore: Map<string, ProjectTopicCandidateState>;
  addRoute: (method: string, pattern: string, handler: RouteHandler) => void;
  inject: (request: InjectRequest) => Promise<InjectResponse>;
  healthcheck: () => { status: string; nodeEnv: string };
}

function matchRoute(pattern: string, url: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const urlParts = url.split("/").filter(Boolean);

  if (patternParts.length !== urlParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const urlPart = urlParts[i];

    if (!patternPart || !urlPart) {
      return null;
    }

    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(urlPart);
      continue;
    }

    if (patternPart !== urlPart) {
      return null;
    }
  }

  return params;
}

export interface BuildAppOptions {
  renderAdapter?: RenderAdapter;
}

export function buildApp(options: BuildAppOptions = {}): AppInstance {
  const routes: RouteRecord[] = [];
  const db = createDbClient();
  const topicCandidateStore = new Map<string, ProjectTopicCandidateState>();

  // Restore persisted state from disk (never under Vitest — avoids cross-test pollution)
  const isTest = !!process.env.VITEST;
  if (!isTest) {
    loadDbSnapshot(db, topicCandidateStore);
    // Also recover any projects that have on-disk metadata but aren't in the snapshot
    recoverProjectsFromDisk(db);
  }

  // Persist on shutdown (skip in test)
  function persist() {
    saveDbSnapshot(db, topicCandidateStore);
  }
  if (!isTest) {
    process.on("SIGINT", () => { persist(); process.exit(0); });
    process.on("SIGTERM", () => { persist(); process.exit(0); });
  }
  // Persist after each state-changing request (debounced via setImmediate)
  let persistPending = false;
  function schedulePersist() {
    if (isTest) return;
    if (!persistPending) {
      persistPending = true;
      setImmediate(() => { persist(); persistPending = false; });
    }
  }

  const app: AppInstance = {
    env,
    db,
    renderAdapter: options.renderAdapter,
    topicCandidateStore,
    addRoute(method, pattern, handler) {
      routes.push({
        method: method.toUpperCase(),
        pattern,
        handler,
      });
    },
    async inject(request) {
      const method = request.method.toUpperCase();

      for (const route of routes) {
        if (route.method !== method) {
          continue;
        }

        const params = matchRoute(route.pattern, request.url);
        if (!params) {
          continue;
        }

        const response = await route.handler({
          app,
          params,
          payload: request.payload ?? {},
        });

        // Persist after state-changing requests
        if (method === "POST" || method === "PUT" || method === "DELETE") {
          schedulePersist();
        }

        return {
          statusCode: response.statusCode,
          json: () => response.body,
        };
      }

      return {
        statusCode: 404,
        json: () => ({
          error: "route_not_found",
        }),
      };
    },
    healthcheck() {
      return {
        status: "ok",
        nodeEnv: env.nodeEnv,
      };
    },
  };

  registerProjectRoutes(app);
  registerTopicRoutes(app);
  registerScriptRoutes(app);
  registerStoryboardRoutes(app);
  registerAssetPlanningRoutes(app);
  registerAssetsRoutes(app);
  registerComposeRoutes(app);
  registerRenderRoutes(app);

  return app;
}
