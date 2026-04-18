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
  ) => Promise<TopicRecommendationsResponse>;
  confirmCandidate: (
    projectId: string,
    candidateId: string,
  ) => Promise<TopicConfirmResponse>;
}

export interface TopicStoreState {
  activeTab: TopicTab;
  candidates: TopicCandidate[];
  selectedCandidate: TopicCandidate | null;
  isGenerating: boolean;
  isConfirming: boolean;
  confirmedTopicPackageId: string | null;
}

export interface TopicStore {
  state: Readonly<TopicStoreState>;
  selectTab: (tab: TopicTab) => void;
  generateSystemRecommendations: () => Promise<void>;
  openCandidate: (candidate: TopicCandidate) => void;
  closeCandidate: () => void;
  confirmSelectedCandidate: () => Promise<void>;
}

export interface CreateTopicStoreInput {
  projectStore: ProjectStore;
  api: TopicApi;
}

export const topicStoreKey: InjectionKey<TopicStore> = Symbol("topic-store");

const defaultRecommendationSeed = {
  canonical_name: "晏子使楚",
  summary: "楚王试图在公开场合羞辱晏子，晏子只能当场顶回去。",
  core_conflict: "对方不断压场，晏子不能退。",
  strong_scene: "楚王连番压场，晏子一句句顶回去。",
  source_hint: "《晏子春秋》",
  recent_usage_hint: "近期未出现同 event_id",
  tags: ["diplomacy", "court", "humiliation", "showdown"],
};

export function createFetchTopicApi(baseUrl = ""): TopicApi {
  return {
    async generateSystemRecommendations(projectId) {
      const response = await fetch(
        `${baseUrl}/api/projects/${projectId}/topic/recommendations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(defaultRecommendationSeed),
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
    selectedCandidate: null,
    isGenerating: false,
    isConfirming: false,
    confirmedTopicPackageId: null,
  });

  function selectTab(tab: TopicTab) {
    state.activeTab = tab;
  }

  async function generateSystemRecommendations() {
    state.isGenerating = true;

    try {
      const projectId = await input.projectStore.ensureProject();
      const response = await input.api.generateSystemRecommendations(projectId);
      state.candidates = response.candidates;
      state.selectedCandidate = null;
    } finally {
      state.isGenerating = false;
    }
  }

  function openCandidate(candidate: TopicCandidate) {
    state.selectedCandidate = candidate;
  }

  function closeCandidate() {
    state.selectedCandidate = null;
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
