import { inject, reactive, readonly, type InjectionKey } from "vue";

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
}

export interface TopicStore {
  state: Readonly<TopicStoreState>;
  selectTab: (tab: TopicTab) => void;
  generateSystemRecommendations: (filters?: TopicRecommendationFilters) => Promise<void>;
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

export interface TopicRecommendationFilters {
  era: "ancient" | "medieval" | "late-imperial";
  tension: "high" | "balanced" | "hook-first";
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
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      const data = await response.json();
      return {
        active_topic_package: data.active_topic_package ?? null,
        current_status: data.current_status ?? "",
        topic_candidates: data.topic_candidates ?? null,
      };
    },
    async generateSystemRecommendations(projectId, filters) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/topic/recommendations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(buildRecommendationSeed(filters)),
        },
      );

      return readJsonResponse<TopicRecommendationsResponse>(response);
    },
    async confirmCandidate(projectId, candidateId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/topic/candidates/${candidateId}/confirm`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            confirm_reason: "topic_page_confirm",
          }),
        },
      );

      return readJsonResponse<TopicConfirmResponse>(response);
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
    filters: TopicRecommendationFilters = {
      era: "ancient",
      tension: "high",
    },
  ) {
    state.isGenerating = true;
    state.loadError = null;
    state.snapshot = { current_status: "topic_generating" };

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
    } finally {
      state.isGenerating = false;
      // 成功后清除 generating 状态，防止刷新或轮询竞态卡在 loading
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
          })),
        }));
        if (!pkg && restoredCandidates[0]) {
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
  const eraLabel = mapEraLabel(filters.era);
  const tensionLabel = mapTensionLabel(filters.tension);
  const outOfRangeExamples = mapEraOutOfRangeExamples(filters.era);

  return {
    canonical_name: `${eraLabel}·${tensionLabel}历史事件推荐`,
    summary: `请围绕${eraLabel}中具备${tensionLabel}特征的具体历史事件生成候选，禁止返回“王朝更迭”“古代战争”“百家争鸣”这类泛主题，不得超出${eraLabel}范围。像${outOfRangeExamples}这类超出时段的题目一律排除。优先推荐适合直接进入文案阶段的单事件主题。`,
    core_conflict: `重点筛选能体现${tensionLabel}、并且冲突关系清晰、人物立场可对撞的具体历史事件。`,
    strong_scene: `优先寻找发生在${eraLabel}、具备宫廷裁决、当众对抗、临阵翻盘、焚毁文献、政变处决等强场景的关键历史瞬间，所有场景必须发生在${eraLabel}范围内。`,
    source_hint: `仅使用${eraLabel}范围内相关史事与人物记载；超出${eraLabel}的事件不得采用。`,
    recent_usage_hint: `优先选择${eraLabel}范围内近期未重复的具体事件，严格排除超出${eraLabel}范围的候选。`,
    tags: [
      normalizeTag(filters.era),
      normalizeTag(filters.tension),
      "system_recommendation",
      "single_event",
      "concrete_scene",
      "strict_era_boundary",
    ],
  };
}

function mapEraLabel(era: TopicRecommendationFilters["era"]) {
  switch (era) {
    case "ancient":
      return "先秦至两汉";
    case "medieval":
      return "魏晋至唐宋";
    case "late-imperial":
      return "元明清";
  }
}

function mapTensionLabel(tension: TopicRecommendationFilters["tension"]) {
  switch (tension) {
    case "high":
      return "高张力";
    case "balanced":
      return "均衡叙事";
    case "hook-first":
      return "传播切口优先";
  }
}

function mapEraOutOfRangeExamples(era: TopicRecommendationFilters["era"]) {
  switch (era) {
    case "ancient":
      return "三国、魏晋、隋唐、宋元、明清";
    case "medieval":
      return "先秦、两汉、元明清";
    case "late-imperial":
      return "先秦、两汉、魏晋、隋唐、宋元";
  }
}

function normalizeTag(value: string) {
  return value.replace(/-/g, "_");
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json();

  if (response.ok === false) {
    const errorMessage =
      typeof body?.message === "string" && body.message.trim().length > 0
        ? body.message
        : typeof body?.error === "string" && body.error.trim().length > 0
          ? body.error
          : `topic_api_request_failed:${response.status}`;
    throw new Error(errorMessage);
  }

  return body as T;
}
