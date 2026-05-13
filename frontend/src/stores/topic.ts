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

export interface TopicApi {
  generateSystemRecommendations: (
    projectId: string,
    filters: TopicRecommendationFilters,
  ) => Promise<TopicRecommendationsResponse>;
  confirmCandidate: (
    projectId: string,
    candidateId: string,
  ) => Promise<TopicConfirmResponse>;
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
}

export interface TopicStore {
  state: Readonly<TopicStoreState>;
  selectTab: (tab: TopicTab) => void;
  generateSystemRecommendations: (filters?: TopicRecommendationFilters) => Promise<void>;
  openCandidate: (candidate: TopicCandidate, roundId?: string | null) => void;
  closeCandidate: () => void;
  confirmSelectedCandidate: () => Promise<void>;
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
  });

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

    try {
      const projectId = await input.projectStore.ensureProject();
      const response = await input.api.generateSystemRecommendations(projectId, filters);
      state.candidates = response.candidates;
      state.currentRound =
        response.current_round ?? {
          round_id: `topic-round-${Date.now()}`,
          candidates: response.candidates,
        };
      state.historyRounds = response.history_rounds ?? [];
      state.selectedCandidate = null;
      state.selectedRoundId = null;
    } catch (error) {
      state.loadError =
        error instanceof Error ? error.message : "topic_generation_failed";
    } finally {
      state.isGenerating = false;
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
      });
      state.confirmedTopicPackageId = response.topic_package.topic_package_id;
      state.selectedCandidate = null;
    } finally {
      state.isConfirming = false;
    }
  }

  return {
    state: readonly(state),
    selectTab,
    generateSystemRecommendations,
    openCandidate,
    closeCandidate,
    confirmSelectedCandidate,
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
      typeof body?.error === "string"
        ? body.error
        : `topic_api_request_failed:${response.status}`;
    throw new Error(errorMessage);
  }

  return body as T;
}
