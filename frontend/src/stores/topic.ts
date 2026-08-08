import { inject, reactive, readonly, type InjectionKey } from "vue";
import {
  TOPIC_RECOMMENDATION_PERIOD_GROUPS,
  expandTopicRecommendationPeriodRange,
  normalizeTopicRecommendationFilter,
  type TopicRecommendationCentralActorType,
  type TopicRecommendationEventDomain,
  type TopicRecommendationFilter,
  type TopicRecommendationPeriodId,
  type TopicRecommendationStorytellingLens,
} from "../../../shared/src";
import { apiFetch } from "../utils/api";

import type { ProjectStore } from "./project";

export type TopicTab = "system" | "library" | "custom";

export interface TopicCandidate {
  candidate_id: string;
  title: string;
  one_line_angle: string;
  family_label: string;
  scope_label: string;
  why_this_now?: string;
  why_now?: string;
  strong_scene: string;
  must_cover_preview?: string[];
  risk_hints: string[];
  core_conflict?: string;
  source_hint?: string;
  viral_rubric?: Record<string, string>;
}

export interface TopicRecommendationsResponse {
  project_id: string;
  candidates: TopicCandidate[];
  current_round?: TopicCandidateRound | null;
  history_rounds?: TopicCandidateRound[];
}

export interface TopicConfirmResponse {
  project_id: string;
  current_status: string;
  topic_package: {
    topic_package_id: string;
    canonical_title?: string;
  };
}

export interface TopicPackageSnapshot {
  topic_package_id: string;
  canonical_title?: string;
  selected_angle?: string;
  family_label?: string;
  scope_label?: string;
}

export interface TopicSnapshotResponse {
  active_topic_package: TopicPackageSnapshot | null;
  current_status: string;
  topic_candidates?: {
    candidate_rounds: Array<{
      round_id: string;
      round_index: number;
      created_at: string;
      candidates: TopicCandidate[];
    }>;
  } | null;
}

export interface TopicApi {
  generateSystemRecommendations: (
    projectId: string,
    filters: TopicRecommendationFilters,
  ) => Promise<TopicRecommendationsResponse>;
  generateFromLibrary: (
    projectId: string,
    body: { event_library_entry_id: string; angle_id?: string },
  ) => Promise<TopicRecommendationsResponse>;
  confirmCandidate: (
    projectId: string,
    candidateId: string,
  ) => Promise<TopicConfirmResponse>;
  loadSnapshot: (projectId: string) => Promise<TopicSnapshotResponse>;
}

export interface TopicCandidateRound {
  round_id: string;
  round_index?: number;
  created_at?: string;
  label?: string;
  candidates: TopicCandidate[];
}

export interface TopicStoreState {
  activeTab: TopicTab;
  candidates: TopicCandidate[];
  currentRound: TopicCandidateRound | null;
  historyRounds: TopicCandidateRound[];
  selectedCandidate: TopicCandidate | null;
  selectedRoundId: string | null;
  isGenerating: boolean;
  isConfirming: boolean;
  confirmedTopicPackageId: string | null;
  loadError: string | null;
  /** 项目快照，用于刷新后恢复 generating 状态 */
  snapshot: { current_status: string } | null;
  /** 生成来源，用于区分 loading 文案 */
  generationSource: "system" | "library" | null;
}

export interface TopicStore {
  state: Readonly<TopicStoreState>;
  selectTab: (tab: TopicTab) => void;
  generateSystemRecommendations: (filters?: TopicRecommendationFilters) => Promise<void>;
  generateFromLibrary: (entryId: string, angleId?: string) => Promise<void>;
  openCandidate: (candidate: TopicCandidate, roundId?: string | null) => void;
  closeCandidate: () => void;
  confirmSelectedCandidate: () => Promise<void>;
  loadExistingTopic: () => Promise<void>;
  loadSnapshot: () => Promise<TopicSnapshotResponse | null>;
}

export interface CreateTopicStoreInput {
  projectStore: ProjectStore;
  api: TopicApi;
}

export type TopicRecommendationEraBand =
  | "unlimited"
  | (typeof TOPIC_RECOMMENDATION_PERIOD_GROUPS)[number]["id"];

export interface TopicRecommendationFilterDraft {
  era_band: TopicRecommendationEraBand;
  period_start_id: TopicRecommendationPeriodId | null;
  period_end_id: TopicRecommendationPeriodId | null;
  event_domain: TopicRecommendationEventDomain | "unlimited";
  central_actor_type: TopicRecommendationCentralActorType | "unlimited";
  storytelling_lens: TopicRecommendationStorytellingLens | "auto";
  exclude_terms: string[];
}

export type TopicRecommendationFilters = TopicRecommendationFilterDraft;

export const TOPIC_RECOMMENDATION_FILTER_STORAGE_KEY =
  "topic-recommendation-filter";

export function createDefaultTopicRecommendationFilterDraft(): TopicRecommendationFilterDraft {
  const medieval = TOPIC_RECOMMENDATION_PERIOD_GROUPS.find(
    (group) => group.id === "medieval",
  )!;
  return {
    era_band: "medieval",
    period_start_id: medieval.periods[0].id,
    period_end_id: medieval.periods[medieval.periods.length - 1].id,
    event_domain: "unlimited",
    central_actor_type: "unlimited",
    storytelling_lens: "auto",
    exclude_terms: [],
  };
}

export function buildTopicRecommendationFilters(
  draft: TopicRecommendationFilterDraft,
): TopicRecommendationFilter | undefined {
  const periodRange =
    draft.era_band !== "unlimited" &&
    draft.period_start_id &&
    draft.period_end_id
      ? {
          start_id: draft.period_start_id,
          end_id: draft.period_end_id,
          included_period_ids: expandTopicRecommendationPeriodRange(
            draft.period_start_id,
            draft.period_end_id,
          ),
        }
      : undefined;

  return normalizeTopicRecommendationFilter({
    ...(periodRange ? { period_range: periodRange } : {}),
    ...(draft.event_domain !== "unlimited"
      ? { event_domain: draft.event_domain }
      : {}),
    ...(draft.central_actor_type !== "unlimited"
      ? { central_actor_type: draft.central_actor_type }
      : {}),
    storytelling_lens: draft.storytelling_lens,
    exclude_terms: draft.exclude_terms,
  });
}

export interface TopicRecommendationSeed {
  canonical_name: string;
  summary: string;
  core_conflict: string;
  strong_scene: string;
  source_hint: string;
  recent_usage_hint: string;
  tags: string[];
}

export const topicStoreKey: InjectionKey<TopicStore> = Symbol("topic-store");

export function createFetchTopicApi(baseUrl = ""): TopicApi {
  return {
    async loadSnapshot(projectId) {
      try {
        const data = await apiFetch<Record<string, unknown>>(`${baseUrl}/api/projects/${projectId}`);
        return {
          active_topic_package: data.active_topic_package ?? null,
          current_status: (data.current_status ?? "") as string,
          topic_candidates: data.topic_candidates ?? null,
        };
      } catch {
        return {
          active_topic_package: null,
          current_status: "",
          topic_candidates: null,
        };
      }
    },
    async generateSystemRecommendations(projectId, filters) {
      const normalizedFilters = buildTopicRecommendationFilters(filters);
      return await apiFetch<TopicRecommendationsResponse>(
        `${baseUrl}/api/projects/${projectId}/topic/recommendations`,
        {
          method: "POST",
          body: {
            ...buildRecommendationSeed(filters),
            ...(normalizedFilters ? { filters: normalizedFilters } : {}),
          },
        },
      );
    },
    async generateFromLibrary(projectId, body) {
      return await apiFetch<TopicRecommendationsResponse>(
        `${baseUrl}/api/projects/${projectId}/topic/from-library`,
        { method: "POST", body },
      );
    },
    async confirmCandidate(projectId, candidateId) {
      return await apiFetch<TopicConfirmResponse>(
        `${baseUrl}/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
        { method: "POST", body: { confirm_reason: "topic_page_confirm" } },
      );
    },
  };
}

export function createTopicStore(input: CreateTopicStoreInput): TopicStore {
  const state = reactive<TopicStoreState>({
    activeTab: "system",
    candidates: [],
    currentRound: null,
    historyRounds: [],
    selectedCandidate: null,
    selectedRoundId: null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
    loadError: null,
    snapshot: null,
    generationSource: null,
  });

  let loadedProjectId: string | null = null;

  function resetForProject(projectId: string) {
    if (loadedProjectId === projectId) return;

    loadedProjectId = projectId;
    state.candidates = [];
    state.currentRound = null;
    state.historyRounds = [];
    state.selectedCandidate = null;
    state.selectedRoundId = null;
    state.confirmedTopicPackageId = null;
    state.loadError = null;
    state.snapshot = null;
  }

  function selectTab(tab: TopicTab) {
    state.activeTab = tab;
  }

  async function generateSystemRecommendations(
    filters: TopicRecommendationFilters = createDefaultTopicRecommendationFilterDraft(),
  ) {
    state.isGenerating = true;
    state.loadError = null;
    state.generationSource = "system";
    state.snapshot = { current_status: "topic_generating" };
    const previousCandidates = state.candidates;
    const previousCurrentRound = state.currentRound;
    const previousSelectedCandidate = state.selectedCandidate;
    const previousSelectedRoundId = state.selectedRoundId;
    state.candidates = [];
    state.currentRound = null;

    try {
      const projectId = await input.projectStore.ensureProject();
      resetForProject(projectId);
      state.isGenerating = true;
      state.snapshot = { current_status: "topic_generating" };
      const response = await input.api.generateSystemRecommendations(projectId, filters);
      loadedProjectId = response.project_id ?? projectId;
      state.candidates = response.candidates;
      state.currentRound =
        response.current_round ?? {
          round_id: `topic-round-${Date.now()}`,
          candidates: response.candidates,
        };
      state.historyRounds = response.history_rounds ?? [];
      state.selectedCandidate = response.candidates[0] ?? null;
      state.selectedRoundId = state.currentRound?.round_id ?? null;
    } catch (error) {
      state.loadError =
        error instanceof Error ? error.message : "topic_generation_failed";
      state.candidates = previousCandidates;
      state.currentRound = previousCurrentRound;
      state.selectedCandidate = previousSelectedCandidate;
      state.selectedRoundId = previousSelectedRoundId;
    } finally {
      state.isGenerating = false;
      if (!state.loadError) {
        state.snapshot = { current_status: "topic_candidates_ready" };
      }
    }
  }

  async function generateFromLibrary(entryId: string, angleId?: string) {
    state.isGenerating = true;
    state.loadError = null;
    state.generationSource = "library";
    state.snapshot = { current_status: "topic_generating" };
    const previousCandidates = state.candidates;
    const previousCurrentRound = state.currentRound;
    const previousSelectedCandidate = state.selectedCandidate;
    const previousSelectedRoundId = state.selectedRoundId;
    state.candidates = [];
    state.currentRound = null;

    try {
      const projectId = await input.projectStore.ensureProject();
      resetForProject(projectId);
      state.isGenerating = true;
      state.snapshot = { current_status: "topic_generating" };
      const response = await input.api.generateFromLibrary(projectId, {
        event_library_entry_id: entryId,
        ...(angleId ? { angle_id: angleId } : {}),
      });
      loadedProjectId = response.project_id ?? projectId;
      state.candidates = response.candidates;
      state.currentRound =
        response.current_round ?? {
          round_id: `topic-round-${Date.now()}`,
          candidates: response.candidates,
        };
      state.historyRounds = response.history_rounds ?? [];
      state.selectedCandidate = response.candidates[0] ?? null;
      state.selectedRoundId = state.currentRound?.round_id ?? null;
    } catch (error) {
      state.loadError =
        error instanceof Error ? error.message : "topic_generation_failed";
      state.candidates = previousCandidates;
      state.currentRound = previousCurrentRound;
      state.selectedCandidate = previousSelectedCandidate;
      state.selectedRoundId = previousSelectedRoundId;
    } finally {
      state.isGenerating = false;
      if (!state.loadError) {
        state.snapshot = { current_status: "topic_candidates_ready" };
      }
    }
  }

  function openCandidate(candidate: TopicCandidate, roundId?: string | null) {
    state.selectedCandidate = candidate;
    state.selectedRoundId = roundId ?? state.currentRound?.round_id ?? null;
  }

  function closeCandidate() {
    state.selectedCandidate = null;
    state.selectedRoundId = null;
  }

  async function confirmSelectedCandidate() {
    if (!state.selectedCandidate) {
      return;
    }

    state.isConfirming = true;

    try {
      const projectId = await input.projectStore.ensureProject();
      const response = await input.api.confirmCandidate(
        projectId,
        state.selectedCandidate.candidate_id,
      );
      input.projectStore.syncProject({
        project_id: response.project_id,
        current_status: response.current_status,
        display_name: response.topic_package.canonical_title,
      });
      state.confirmedTopicPackageId = response.topic_package.topic_package_id;
      state.selectedCandidate = null;
    } finally {
      state.isConfirming = false;
    }
  }

  async function loadExistingTopic() {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return;
    resetForProject(projectId);
    if (state.currentRound || state.candidates.length > 0) return;

    try {
      const snapshot = await input.api.loadSnapshot(projectId);
      state.snapshot = snapshot;
      input.projectStore.syncProject({
        project_id: projectId,
        current_status: snapshot.current_status,
        display_name: snapshot.active_topic_package?.canonical_title,
      });

      const pkg = snapshot.active_topic_package;
      if (pkg) {
        state.confirmedTopicPackageId = pkg.topic_package_id;
        const candidate: TopicCandidate = {
          candidate_id: pkg.topic_package_id,
          title: pkg.canonical_title ?? "",
          one_line_angle: pkg.selected_angle ?? "",
          family_label: pkg.family_label ?? "",
          scope_label: pkg.scope_label ?? "",
          strong_scene: "",
          risk_hints: [],
        };
        state.selectedCandidate = candidate;
        state.candidates = [candidate];
        state.currentRound = {
          round_id: "confirmed",
          candidates: [candidate],
        };
      }

      // 从快照恢复候选 rounds（F5 恢复）
      const tc = snapshot.topic_candidates;
      if (tc?.candidate_rounds?.length) {
        const lastRound = tc.candidate_rounds[tc.candidate_rounds.length - 1]!;
        const restoredCandidates = lastRound.candidates.map((c) => ({
          candidate_id: c.candidate_id,
          title: c.title,
          one_line_angle: c.one_line_angle,
          family_label: c.family_label,
          scope_label: c.scope_label,
          why_this_now: c.why_this_now ?? "",
          strong_scene: c.strong_scene,
          risk_hints: c.risk_hints ?? [],
          core_conflict: c.core_conflict ?? "",
          source_hint: c.source_hint ?? "",
          viral_rubric: c.viral_rubric ?? {},
          must_cover_preview: c.must_cover_preview ?? [],
        }));
        state.candidates = restoredCandidates;
        state.currentRound = {
          round_id: lastRound.round_id,
          round_index: lastRound.round_index,
          created_at: lastRound.created_at,
          candidates: restoredCandidates,
        };
        state.historyRounds = tc.candidate_rounds.slice(0, -1).map((r) => ({
          round_id: r.round_id,
          round_index: r.round_index,
          created_at: r.created_at,
          candidates: r.candidates.map((c) => ({
            candidate_id: c.candidate_id,
            title: c.title,
            one_line_angle: c.one_line_angle,
            family_label: c.family_label,
            scope_label: c.scope_label,
            why_this_now: c.why_this_now ?? "",
            strong_scene: c.strong_scene,
            risk_hints: c.risk_hints ?? [],
            core_conflict: c.core_conflict ?? "",
            source_hint: c.source_hint ?? "",
            viral_rubric: c.viral_rubric ?? {},
            must_cover_preview: c.must_cover_preview ?? [],
          })),
        }));
        const confirmedCandidate = pkg
          ? restoredCandidates.find((candidate) =>
              candidate.title === pkg.canonical_title &&
              candidate.one_line_angle === pkg.selected_angle)
          : undefined;
        if (confirmedCandidate) {
          state.selectedCandidate = confirmedCandidate;
          state.selectedRoundId = lastRound.round_id;
        } else if (!pkg && restoredCandidates[0]) {
          state.selectedCandidate = restoredCandidates[0];
          state.selectedRoundId = lastRound.round_id;
        }
      }
    } catch {
      // Silently fail — the empty state will prompt the user to generate
    }
  }

  async function loadSnapshot(): Promise<TopicSnapshotResponse | null> {
    const projectId = input.projectStore.state.projectId;
    if (!projectId) return null;
    resetForProject(projectId);
    try {
      const snapshot = await input.api.loadSnapshot(projectId);
      if (state.isGenerating && snapshot.current_status === "topic_pending") {
        const generatingSnapshot: TopicSnapshotResponse = {
          ...snapshot,
          current_status: "topic_generating",
        };
        state.snapshot = generatingSnapshot;
        return generatingSnapshot;
      }
      state.snapshot = snapshot;
      input.projectStore.syncProject({
        project_id: projectId,
        current_status: snapshot.current_status,
        display_name: snapshot.active_topic_package?.canonical_title,
      });
      return snapshot;
    } catch {
      // 保留上次有效 snapshot
      return state.snapshot;
    }
  }

  return {
    state: readonly(state),
    selectTab,
    generateSystemRecommendations,
    generateFromLibrary,
    openCandidate,
    closeCandidate,
    confirmSelectedCandidate,
    loadExistingTopic,
    loadSnapshot,
  };
}

export function useTopicStore() {
  const store = inject(topicStoreKey);
  if (!store) {
    throw new Error("topic_store_missing");
  }

  return store;
}

function buildRecommendationSeed(
  filters: TopicRecommendationFilters,
): TopicRecommendationSeed {
  const periodLabel = describeDraftPeriod(filters);

  return {
    canonical_name: `${periodLabel}历史事件推荐`,
    summary: `请围绕${periodLabel}内的具体历史事件生成候选，禁止返回“王朝更迭”“古代战争”“百家争鸣”这类泛主题。结构化筛选条件以 filters 为准，优先推荐适合直接进入文案阶段的单事件主题。`,
    core_conflict: "优先选择冲突关系清晰、人物立场可辨、叙事推进明确的具体历史事件。",
    strong_scene: `优先寻找发生在${periodLabel}内、具有明确人物行动与局势变化的关键历史瞬间。`,
    source_hint: `仅使用${periodLabel}范围内相关史事与人物记载。`,
    recent_usage_hint: `优先选择${periodLabel}范围内近期未重复的具体事件。`,
    tags: [
      filters.era_band,
      "system_recommendation",
      "single_event",
      "concrete_scene",
      "strict_era_boundary",
    ],
  };
}

function describeDraftPeriod(filters: TopicRecommendationFilterDraft) {
  if (
    filters.era_band === "unlimited" ||
    !filters.period_start_id ||
    !filters.period_end_id
  ) {
    return "不限时期";
  }
  const periods = TOPIC_RECOMMENDATION_PERIOD_GROUPS.flatMap(
    (group) => group.periods,
  );
  const start = periods.find((period) => period.id === filters.period_start_id);
  const end = periods.find((period) => period.id === filters.period_end_id);
  if (!start || !end) return "所选时期";
  return start.id === end.id ? start.label : `${start.label}至${end.label}`;
}
