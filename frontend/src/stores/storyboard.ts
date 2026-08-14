import { inject, reactive, readonly, type InjectionKey } from "vue";
import { apiFetch } from "../utils/api";

import type { ProjectStore } from "./project";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface StoryboardSegment {
  segment_id: string;
  narrative_role: string;
  script_excerpt: string;
  visual_intent: string;
  scene_description: string;
  motion_hint: string;
  framing_hint: string;
  start_hint_sec: number;
  end_hint_sec: number;
  // S2-2A 任务 4：四档适配度（LLM/stub 输出）
  api_video_suitability?:
    | "remotion_only"
    | "remotion_sufficient"
    | "api_video_beneficial"
    | "api_video_strongly_recommended";
}

export interface StoryboardPlan {
  plan_version: string;
  segments: StoryboardSegment[];
  [key: string]: unknown;
}

export interface StoryboardValidationResult {
  stage: string;
  decision: string;
  errors: string[];
  warnings: string[];
  metrics: Record<string, unknown>;
}

export interface SegmentStrategyProjection {
  segment_id: string;
  api_video_suitability: string;
  strategy_override: "api_video" | "remotion_motion" | null;
  override_revision: number | null;
  resolved_route: string;
  reason_code: string;
}

export interface ActiveStoryboardSnapshot {
  plan: StoryboardPlan | null;
  validation_result: StoryboardValidationResult | null;
  execution_state: Record<string, unknown> | null;
  graph_trace_summary: Record<string, unknown> | null;
  runtime_diagnostics: Record<string, unknown> | null;
  /** S2-2A：分镜策略投影（suitability/override/route/reason） */
  segment_strategies?: SegmentStrategyProjection[];
}

export interface StoryboardSnapshot {
  current_status: string | null;
  active_storyboard: ActiveStoryboardSnapshot | null;
  active_storyboard_record_id: string | null;
}

/* -------------------------------------------------------------------------- */
/*  API adapter                                                               */
/* -------------------------------------------------------------------------- */

export interface StoryboardApi {
  loadSnapshot(projectId: string): Promise<StoryboardSnapshot>;
  generateStoryboard(projectId: string): Promise<void>;
  regenerateStoryboard(projectId: string, userFeedback: string): Promise<void>;
  updateSegmentStrategy(
    projectId: string,
    segmentId: string,
    strategy: "remotion_motion" | "api_video" | null,
    expectedRevision?: number | null,
  ): Promise<Record<string, unknown>>;
  regenerateSegment(
    projectId: string,
    segmentId: string,
    userFeedback: string,
  ): Promise<void>;
}

export function createFetchStoryboardApi(baseUrl = ""): StoryboardApi {
  return {
    async loadSnapshot(projectId) {
      const data = await apiFetch<Record<string, unknown>>(`${baseUrl}/api/projects/${projectId}`);
      return {
        current_status: data.current_status ?? null,
        active_storyboard: data.active_storyboard ?? null,
        active_storyboard_record_id: data.active_storyboard_record_id ?? null,
      };
    },
    async generateStoryboard(projectId) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/storyboard/generate`, { method: "POST" });
    },
    async regenerateStoryboard(projectId, userFeedback) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/storyboard/generate`, {
        method: "POST",
        body: { user_feedback: userFeedback },
      });
    },
    async updateSegmentStrategy(projectId, segmentId, strategy, expectedRevision = null) {
      // S2-2A 任务 4：写独立 override（visual_strategy_override），带乐观锁 revision
      const response = await apiFetch<Record<string, unknown>>(`${baseUrl}/api/projects/${projectId}/storyboard/strategy`, {
        method: "PATCH",
        body: {
          segment_id: segmentId,
          visual_strategy_override: strategy,
          expected_revision: expectedRevision,
        },
      });
      return response;
    },
    async regenerateSegment(projectId, segmentId, userFeedback) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}/storyboard/segments/${segmentId}/regen`, {
        method: "POST",
        body: { user_feedback: userFeedback },
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Store state                                                               */
/* -------------------------------------------------------------------------- */

export interface StoryboardStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  loadError: string | null;
  /** 分镜策略覆盖操作错误（409 冲突等），不静默吞掉。 */
  strategyError: string | null;
  snapshot: StoryboardSnapshot | null;
}

export interface StoryboardStore {
  state: Readonly<StoryboardStoreState>;
  loadActiveStoryboardSnapshot: () => Promise<void>;
  generateStoryboard: () => Promise<void>;
  regenerateWithFeedback: (userFeedback: string) => Promise<void>;
  updateSegmentStrategyPreference: (
    segmentId: string,
    strategy: "remotion_motion" | "api_video" | null,
  ) => Promise<void>;
  regenerateSegment: (
    segmentId: string,
    userFeedback: string,
  ) => Promise<boolean>;
  retryLoad: () => Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Factory                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 从快照的 segment_strategies 投影中读取指定分镜的 override revision。
 * 无 override（null/继承）时返回 null（首建路径）。
 */
function findSegmentOverrideRevision(
  snapshot: StoryboardSnapshot | null,
  segmentId: string,
): number | null {
  const strategies = snapshot?.active_storyboard?.segment_strategies;
  if (!strategies) return null;
  const entry = strategies.find((s) => s.segment_id === segmentId);
  return entry?.override_revision ?? null;
}

export interface CreateStoryboardStoreInput {
  projectStore: ProjectStore;
  api: StoryboardApi;
}

export const storyboardStoreKey: InjectionKey<StoryboardStore> =
  Symbol("storyboard-store");

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "storyboard_snapshot_load_failed";
}

export function createStoryboardStore(
  input: CreateStoryboardStoreInput,
): StoryboardStore {
  const state = reactive<StoryboardStoreState>({
    isLoading: false,
    isGenerating: false,
    loadError: null,
    snapshot: null,
  });

  async function loadActiveStoryboardSnapshot() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      state.snapshot = null;
      state.loadError = null;
      return;
    }

    state.isLoading = true;
    try {
      const snapshot = await input.api.loadSnapshot(projectId);
      state.snapshot = snapshot;
      state.loadError = null;

      if (snapshot.current_status) {
        input.projectStore.syncProject({
          project_id: projectId,
          current_status: snapshot.current_status,
        });
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
    } finally {
      state.isLoading = false;
    }
  }

  async function generateStoryboard() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;
    return startGeneration(() => input.api.generateStoryboard(projectId));
  }

  async function regenerateWithFeedback(userFeedback: string) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;
    return startGeneration(() =>
      input.api.regenerateStoryboard(projectId, userFeedback),
    );
  }

  async function startGeneration(run: () => Promise<void>) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      return;
    }

    state.isGenerating = true;
    state.loadError = null;

    // Optimistically update status to indicate generation in progress
    const previousStatus =
      state.snapshot?.current_status ??
      input.projectStore.state.currentStatus;
    state.snapshot = {
      current_status: "storyboard_generating",
      active_storyboard: state.snapshot?.active_storyboard ?? null,
      active_storyboard_record_id:
        state.snapshot?.active_storyboard_record_id ?? null,
    };
    input.projectStore.syncProject({
      project_id: projectId,
      current_status: "storyboard_generating",
    });

    try {
      await run();
      await loadActiveStoryboardSnapshot();
      if (!state.snapshot?.active_storyboard) {
        state.loadError = "分镜生成未完成，请重试";
        state.snapshot = {
          current_status: "storyboard_failed",
          active_storyboard: null,
          active_storyboard_record_id: null,
        };
        input.projectStore.syncProject({
          project_id: projectId,
          current_status: "storyboard_failed",
        });
      }
    } catch (error) {
      state.loadError = toErrorMessage(error);
      state.snapshot = {
        current_status: previousStatus,
        active_storyboard: state.snapshot?.active_storyboard ?? null,
        active_storyboard_record_id:
          state.snapshot?.active_storyboard_record_id ?? null,
      };
      input.projectStore.syncProject({
        project_id: projectId,
        current_status: previousStatus,
      });
    } finally {
      state.isGenerating = false;
    }
  }

  async function retryLoad() {
    await loadActiveStoryboardSnapshot();
  }

  async function updateSegmentStrategyPreference(
    segmentId: string,
    strategy: "remotion_motion" | "api_video" | null,
  ) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;

    // P1：从快照读取当前 override revision（没有 override 时为 null = 首建），
    // 后续操作必须携带真实 revision，否则第二次必然 409。
    const overrideRevision = findSegmentOverrideRevision(state.snapshot, segmentId);

    state.strategyError = null;
    try {
      const response = await input.api.updateSegmentStrategy(projectId, segmentId, strategy, overrideRevision);
      // 成功：刷新快照（从后端重新读取 plan + route preview + override revision）
      await loadActiveStoryboardSnapshot();
      return response;
    } catch (error) {
      // P1：不静默吞掉——409 冲突等必须暴露给 UI
      const message = toErrorMessage(error);
      state.strategyError = message.includes("storyboard_segment_override_revision_conflict")
        ? "分镜策略已被其他操作更新，请刷新后重试"
        : message;
      // 重新加载快照，让 UI 显示数据库真实状态
      await loadActiveStoryboardSnapshot();
    }
  }

  async function regenerateSegment(
    segmentId: string,
    userFeedback: string,
  ) {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) {
      console.warn("[storyboard] regenerateSegment aborted — no active projectId");
      return false;
    }

    state.loadError = null;

    try {
      await input.api.regenerateSegment(projectId, segmentId, userFeedback);
      await loadActiveStoryboardSnapshot();
      return true;
    } catch (error) {
      state.loadError = toErrorMessage(error);
      return false;
    }
  }

  return {
    state: readonly(state),
    loadActiveStoryboardSnapshot,
    generateStoryboard,
    regenerateWithFeedback,
    updateSegmentStrategyPreference,
    regenerateSegment,
    retryLoad,
  };
}

export function useStoryboardStore(): StoryboardStore {
  const store = inject(storyboardStoreKey);
  if (!store) {
    throw new Error("storyboard_store_missing");
  }
  return store;
}
