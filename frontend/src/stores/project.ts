import { inject, reactive, readonly, type InjectionKey } from "vue";

export interface ProjectSnapshot {
  project_id: string;
  current_status: string;
}

export interface CreateProjectInput {
  name?: string;
}

export interface ProjectApi {
  createProject(input?: CreateProjectInput): Promise<ProjectSnapshot>;
}

export interface ProjectStoreState {
  projectId: string | null;
  currentStatus: string;
}

export interface ProjectStore {
  state: Readonly<ProjectStoreState>;
  ensureProject: () => Promise<string>;
  syncProject: (snapshot: ProjectSnapshot) => void;
}

export const projectStoreKey: InjectionKey<ProjectStore> = Symbol("project-store");

export function createFetchProjectApi(baseUrl = ""): ProjectApi {
  return {
    async createProject(input) {
      const response = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: input?.name ?? "主题页最小闭环",
        }),
      });

      return response.json();
    },
  };
}

export function createProjectStore(api: ProjectApi): ProjectStore {
  const state = reactive<ProjectStoreState>({
    projectId: null,
    currentStatus: "topic_pending",
  });

  function syncProject(snapshot: ProjectSnapshot) {
    state.projectId = snapshot.project_id;
    state.currentStatus = snapshot.current_status;
  }

  async function ensureProject() {
    if (state.projectId) {
      return state.projectId;
    }

    const snapshot = await api.createProject();
    syncProject(snapshot);
    return snapshot.project_id;
  }

  return {
    state: readonly(state),
    ensureProject,
    syncProject,
  };
}

export function useProjectStore() {
  const store = inject(projectStoreKey);
  if (!store) {
    throw new Error("project_store_missing");
  }

  return store;
}
