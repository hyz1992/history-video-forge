import { env } from "./config/env";
import { createDbClient, type DbClient } from "./db/client";
import { loadLegacyFixtureState, saveLegacyFixtureState } from "./db/legacy-persistence-adapter.js";
import type { AuthContext } from "./auth/auth-context.js";
import { createAnonymousAuthContext } from "./auth/auth-context.js";
import { registerProjectRoutes } from "./modules/projects/project.routes";
import { registerTopicRoutes } from "./modules/topic/topic.routes";
import { registerScriptRoutes } from "./modules/script/script.routes";
import { registerStoryboardRoutes } from "./modules/storyboard/storyboard.routes";
import { registerAssetPlanningRoutes } from "./modules/asset-planning/asset-planning.routes";
import { registerAssetsRoutes } from "./modules/assets/assets.routes";
import { registerComposeRoutes } from "./modules/compose/compose.routes";
import { registerRenderRoutes } from "./modules/render/render.routes";
import { registerPublishRoutes } from "./modules/publish/publish.routes";
import { registerAdminRoutes } from "./modules/admin/admin.routes";
import { registerEventLibraryRoutes } from "./modules/event-library/event-library.routes";
import { registerEventLibraryAdminRoutes } from "./modules/event-library/event-library-admin.routes";
import { registerGenerationConfigRoutes } from "./modules/generation-config/generation-config.routes";
import { registerGenerationCostRoutes } from "./modules/generation-cost/generation-cost.routes";
import { createGenerationRunRepository, type GenerationRunRepository } from "./modules/generation-run/generation-run.repository";
import { createGenerationRunDispatcher, type GenerationRunDispatcher } from "./modules/generation-run/generation-run-dispatcher";
import { createAssetsDispatchHandler } from "./modules/assets/assets-run.service";
import type { QuoteReadinessInput } from "./modules/generation-cost/generation-cost.service";
import { loadMediaLibraryCatalog } from "./modules/assets/media-library-catalog.loader";
import { configureVoiceProfilePersistence } from "./modules/assets/voice/voice-profile.repository";
import { recoverInterruptedRuns } from "./runtime/recovery/interrupted-run-recovery";
import { createProjectStageLockRegistry } from "./runtime/concurrency/project-stage-lock";
import type { RenderAdapter } from "./modules/render/render-adapter";
import type { PrismaReadinessResult } from "./db/prisma-readiness.js";
import type { AppPrismaClient } from "./db/prisma-client.types.js";
import type { StoredTopicCandidate } from "./modules/topic/topic-confirm.service";
import type { PrismaFirstAggregateWriter } from "./db/repositories/prisma-first-aggregate-writer.js";
import type { PrismaSecondAggregateWriter } from "./db/repositories/prisma-second-aggregate-writer.js";
import type { PrismaThirdAggregateWriter } from "./db/repositories/prisma-third-aggregate-writer.js";
import { join } from "node:path";

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
  auth?: AuthContext;
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
  auth: AuthContext;
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
  prismaClient?: AppPrismaClient;
  topicCandidateStore: Map<string, ProjectTopicCandidateState>;
  storageBaseDir: string;
  addRoute: (method: string, pattern: string, handler: RouteHandler) => void;
  inject: (request: InjectRequest) => Promise<InjectResponse>;
  healthcheck: () => { status: string; nodeEnv: string };
  persistenceHealth: {
    loaded: boolean;
    source: "primary" | "backup" | "none";
    error: string | null;
  };
  mediaLibraryHealth: {
    loaded: boolean;
    itemCount: number;
    error: string | null;
  };
  databaseReadiness?: () => Promise<PrismaReadinessResult>;
  persistenceMode: "legacy" | "prisma";
  persist: () => { ok: boolean; error: string | null };
  stageLocks: ReturnType<typeof createProjectStageLockRegistry>;
  /** S2-2A 任务 8：GenerationRun 提交事务 repository（Map 锁 / Prisma 事务）。 */
  generationRunRepository: GenerationRunRepository;
  /** S2-2A 任务 8：可恢复 dispatcher（提交后立即派发 + 启动扫描 + 低频 sweep）。 */
  generationRunDispatcher: GenerationRunDispatcher;
  /**
   * S2-2A 任务 8：报价/提交的 readiness 输入注入点（测试用）。
   * 缺省时每请求从真实 env 推导（resolveGenerationCostBootstrapInputFromEnv）。
   */
  generationQuoteReadinessInput?: QuoteReadinessInput;
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
  storageBaseDir?: string;
  skipSnapshotLoad?: boolean;
  databaseReadiness?: () => Promise<PrismaReadinessResult>;
  firstAggregateWriter?: PrismaFirstAggregateWriter;
  secondAggregateWriter?: PrismaSecondAggregateWriter;
  thirdAggregateWriter?: PrismaThirdAggregateWriter;
  prismaClient?: AppPrismaClient;
  /** S2-2A 任务 8：报价 readiness 输入注入（缺省从真实 env 推导）。 */
  generationQuoteReadinessInput?: QuoteReadinessInput;
}

export function buildApp(options: BuildAppOptions = {}): AppInstance {
  const routes: RouteRecord[] = [];
  const db = createDbClient();
  db.firstAggregateWriter = options.firstAggregateWriter;
  db.secondAggregateWriter = options.secondAggregateWriter;
  db.thirdAggregateWriter = options.thirdAggregateWriter;
  const topicCandidateStore = new Map<string, ProjectTopicCandidateState>();
  const stageLocks = createProjectStageLockRegistry();
  const runtimeStorageRoot = options.storageBaseDir ?? (process.env.VITEST ? process.env.STORAGE_ROOT_DIR : undefined) ?? process.cwd();
  const snapshotPath = options.storageBaseDir ? join(options.storageBaseDir, "storage", "db-snapshot.json") : undefined;
  const persistenceHealth: AppInstance["persistenceHealth"] = {
    loaded: Boolean(options.firstAggregateWriter),
    source: options.firstAggregateWriter ? "primary" : "none",
    error: null,
  };
  const mediaLibraryHealth: AppInstance["mediaLibraryHealth"] = {
    loaded: false,
    itemCount: 0,
    error: null,
  };
  configureVoiceProfilePersistence(db, {
    rootDir: runtimeStorageRoot,
  });

  // Restore persisted state from disk; Vitest only opts in when an isolated root is provided.
  const isTest = !!process.env.VITEST;
  const shouldLoadSnapshot = !options.firstAggregateWriter && !options.skipSnapshotLoad && (!isTest || Boolean(options.storageBaseDir));
  if (shouldLoadSnapshot) {
    const loadResult = loadLegacyFixtureState(db, topicCandidateStore, snapshotPath);
    Object.assign(persistenceHealth, {
      loaded: loadResult.ok,
      source: loadResult.source,
      error: loadResult.error,
    });
    if (loadResult.ok) {
      const recovery = recoverInterruptedRuns(db);
      if (recovery.recoveredProjectIds.length > 0 || recovery.recoveredProviderJobIds.length > 0) {
        const saveResult = saveLegacyFixtureState(db, topicCandidateStore, snapshotPath);
        if (!saveResult.ok) {
          Object.assign(persistenceHealth, { error: saveResult.error });
        }
      }
    }
  }
  Object.assign(mediaLibraryHealth, loadMediaLibraryCatalog(db, {
    storageBaseDir: runtimeStorageRoot,
  }));

  // Persist on shutdown (skip in test)
  function persist() {
    if (options.firstAggregateWriter) return { ok: true, error: null };
    const result = saveLegacyFixtureState(db, topicCandidateStore, snapshotPath);
    if (!result.ok) {
      Object.assign(persistenceHealth, {
        error: result.error,
      });
    }
    return result;
  }
  // Persist after each state-changing request before the response completes,
  // so deletes cannot be resurrected by a stale db snapshot on restart.
  function persistMutation() {
    if (isTest && !options.storageBaseDir) return;
    return persist();
  }

  // S2-2A 任务 8：GenerationRun 事务 repository + 可恢复 dispatcher（单例接线）。
  const generationRunRepository = createGenerationRunRepository(db, options.prismaClient);
  const app: AppInstance = {
    env,
    db,
    persistenceHealth,
    mediaLibraryHealth,
    databaseReadiness: options.databaseReadiness,
    persistenceMode: options.firstAggregateWriter ? "prisma" : "legacy",
    persist,
    stageLocks,
    renderAdapter: options.renderAdapter,
    prismaClient: options.prismaClient,
    topicCandidateStore,
    storageBaseDir: runtimeStorageRoot,
    generationQuoteReadinessInput: options.generationQuoteReadinessInput,
    generationRunRepository,
    generationRunDispatcher: createGenerationRunDispatcher({
      db,
      repository: generationRunRepository,
      workerId: `main-dispatcher-${process.pid}`,
      leaseDurationMs: 30_000,
      handlers: {
        "assets.generate": createAssetsDispatchHandler(),
      },
    }),
    addRoute(method, pattern, handler) {
      routes.push({
        method: method.toUpperCase(),
        pattern,
        handler,
      });
    },
    async inject(request) {
      const method = request.method.toUpperCase();

      // Separate pathname and query string so GET requests can carry filters
      // (mirrors what server.ts does at the HTTP layer for real requests).
      const queryIndex = request.url.indexOf("?");
      const pathname = queryIndex >= 0 ? request.url.slice(0, queryIndex) : request.url;
      const query: Record<string, string> = {};
      if (queryIndex >= 0) {
        const searchParams = new URLSearchParams(request.url.slice(queryIndex + 1));
        for (const [key, value] of searchParams.entries()) {
          query[key] = value;
        }
      }

      for (const route of routes) {
        if (route.method !== method) {
          continue;
        }

        const params = matchRoute(route.pattern, pathname);
        if (!params) {
          continue;
        }

        const stage = method === "POST" ? getGenerationStage(pathname) : null;
        let release: (() => void) | undefined;
        if (stage && params.projectId) {
          try {
            release = stageLocks.acquire(params.projectId, stage);
          } catch {
            return {
              statusCode: 409,
              json: () => ({
                error: "project_stage_run_in_progress",
                message: "当前阶段已有生成任务，请等待完成后再试。",
              }),
            };
          }
        }
        let response: AppResponse;
        try {
          const basePayload = request.payload ?? {};
          const mergedPayload = method === "GET" && Object.keys(query).length > 0
            ? { ...(basePayload as Record<string, unknown>), ...query }
            : basePayload;
          response = await route.handler({
            app,
            params,
            payload: mergedPayload,
            auth: request.auth ?? createAnonymousAuthContext(),
          });
        } finally {
          release?.();
        }

        // Persist after state-changing requests
        if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
          const persistenceResult = persistMutation();
          if (persistenceResult && !persistenceResult.ok) {
            return {
              statusCode: 503,
              json: () => ({ error: "persistence_failed" }),
            };
          }
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
        demoMode: env.demoMode,
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
  registerPublishRoutes(app);
  registerAdminRoutes(app);
  registerEventLibraryRoutes(app);
  registerEventLibraryAdminRoutes(app);
  registerGenerationConfigRoutes(app);
  registerGenerationCostRoutes(app);

  return app;
}

function getGenerationStage(url: string): string | null {
  const match = url.match(/^\/api\/projects\/[^/]+\/(topic|script|storyboard|asset-plan|assets|compose|render|publish)(?:\/|$)/u);
  return match?.[1] ?? null;
}
