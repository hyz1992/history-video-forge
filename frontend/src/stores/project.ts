import { inject, reactive, readonly, type InjectionKey } from "vue";

export interface ProjectSnapshot {
  project_id: string;
  current_status: string;
  display_name?: string;
  is_draft?: boolean;
  updated_at?: string;
}

export interface CreateProjectInput {
  name?: string;
}

export interface ProjectListItem extends ProjectSnapshot {
  display_name: string;
  is_draft: boolean;
  updated_at: string;
}

export interface ProjectApi {
  listProjects?: () => Promise<ProjectListItem[]>;
  createProject(input?: CreateProjectInput): Promise<ProjectSnapshot>;
}

export interface ProjectStoreState {
  projectId: string | null;
  currentStatus: string;
  projects: ProjectListItem[];
}

export interface ProjectStore {
  state: Readonly<ProjectStoreState>;
  createProject: (input?: CreateProjectInput) => Promise<ProjectListItem>;
  ensureProject: () => Promise<string>;
  loadProjects: () => Promise<ProjectListItem[]>;
  resolveProjectWorkspacePath: (projectId: string, currentStatus: string) => string;
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
          name: input?.name ?? "未命名项目",
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
    projects: [],
  });

  function isDraftStatus(currentStatus: string) {
    return currentStatus.startsWith("topic");
  }

  function toProjectListItem(snapshot: ProjectSnapshot): ProjectListItem {
    return {
      project_id: snapshot.project_id,
      current_status: snapshot.current_status,
      display_name: snapshot.display_name ?? "未命名项目",
      is_draft: snapshot.is_draft ?? isDraftStatus(snapshot.current_status),
      updated_at: snapshot.updated_at ?? new Date().toISOString(),
    };
  }

  function upsertProject(snapshot: ProjectSnapshot) {
    const nextProject = toProjectListItem(snapshot);
    const projectIndex = state.projects.findIndex(
      (project) => project.project_id === nextProject.project_id,
    );

    if (projectIndex >= 0) {
      state.projects.splice(projectIndex, 1, nextProject);
      return nextProject;
    }

    state.projects.unshift(nextProject);
    return nextProject;
  }

  function syncProject(snapshot: ProjectSnapshot) {
    state.projectId = snapshot.project_id;
    state.currentStatus = snapshot.current_status;
    upsertProject(snapshot);
  }

  async function loadProjects() {
    if (!api.listProjects) {
      return state.projects;
    }

    const projects = await api.listProjects();
    state.projects = projects.map((project) => toProjectListItem(project));
    return state.projects;
  }

  async function createProject(input?: CreateProjectInput) {
    const snapshot = await api.createProject(input);
    syncProject(snapshot);
    return toProjectListItem(snapshot);
  }

  function resolveProjectWorkspacePath(projectId: string, currentStatus: string) {
    return isDraftStatus(currentStatus)
      ? `/projects/${projectId}/topic`
      : `/projects/${projectId}/script`;
  }

  async function ensureProject() {
    if (state.projectId) {
      return state.projectId;
    }

    const project = await createProject();
    return project.project_id;
  }

  return {
    state: readonly(state),
    createProject,
    ensureProject,
    loadProjects,
    resolveProjectWorkspacePath,
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
