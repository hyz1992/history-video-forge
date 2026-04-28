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

      return response.json();
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

      return response.json();
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

function buildRecommendationSeed(filters: TopicRecommendationFilters) {
  const eraLabel = mapEraLabel(filters.era);
  const tensionLabel = mapTensionLabel(filters.tension);

  return {
    canonical_name: `${eraLabel}：${tensionLabel}历史事件推荐`,
    summary: `请围绕${eraLabel}中具备${tensionLabel}特征的历史事件，优先推荐适合直接进入文案阶段的主题。`,
    core_conflict: `重点筛选能体现${tensionLabel}、并且冲突关系清晰的历史事件。`,
    strong_scene: `优先寻找发生在${eraLabel}、能够快速建立场面压迫感或戏剧反转的关键场景。`,
    source_hint: `${eraLabel}相关史事与人物记载`,
    recent_usage_hint: `${eraLabel}范围内近期未重复的候选优先`,
    tags: [normalizeTag(filters.era), normalizeTag(filters.tension), "system_recommendation"],
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

function normalizeTag(value: string) {
  return value.replace(/-/g, "_");
}
