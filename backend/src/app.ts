import { env } from "./config/env";
import { createDbClient, type DbClient } from "./db/client";
import { registerProjectRoutes } from "./modules/projects/project.routes";
import { registerTopicRoutes } from "./modules/topic/topic.routes";
import { registerScriptRoutes } from "./modules/script/script.routes";
import type { StoredTopicCandidate } from "./modules/topic/topic-confirm.service";

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
  topicCandidateStore: Map<string, Map<string, StoredTopicCandidate>>;
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

export function buildApp(): AppInstance {
  const routes: RouteRecord[] = [];

  const app: AppInstance = {
    env,
    db: createDbClient(),
    topicCandidateStore: new Map<string, Map<string, StoredTopicCandidate>>(),
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

  return app;
}
