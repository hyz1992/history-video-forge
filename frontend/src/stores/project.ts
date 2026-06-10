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
  getProject?: (projectId: string) => Promise<ProjectSnapshot>;
  deleteProject?: (projectId: string) => Promise<void>;
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
  deleteProject: (projectId: string) => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
  loadProjects: () => Promise<ProjectListItem[]>;
  resolveProjectWorkspacePath: (projectId: string, currentStatus: string) => string;
  syncProject: (snapshot: ProjectSnapshot) => void;
}

export const projectStoreKey: InjectionKey<ProjectStore> = Symbol("project-store");

export function createFetchProjectApi(baseUrl = ""): ProjectApi {
  return {
    async listProjects() {
      const response = await fetch(`${baseUrl}/api/projects`);
      if (!response.ok) return [];
      return response.json();
    },
    async getProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`);
      if (!response.ok) throw new Error(`project_load_failed:${response.status}`);
      const data = await response.json();
      return {
        project_id: data.project_id ?? projectId,
        current_status: data.current_status ?? "",
        display_name:
          data.display_name ??
          data.active_topic_package?.canonical_title ??
          undefined,
      };
    },
    async deleteProject(projectId) {
      const response = await fetch(`${baseUrl}/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`project_delete_failed:${response.status}`);
    },
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

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : `project_create_failed:${response.status}`,
        );
      }

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

  function isDraftStatus(currentStatus: string | undefined) {
    return !!currentStatus?.startsWith("topic");
  }

  function toProjectListItem(snapshot: ProjectSnapshot): ProjectListItem {
    // Preserve an existing non-default display_name when the incoming
    // snapshot does not carry one (e.g. status-only sync from downstream
    // stores like script / storyboard / assets / compose / render).
    const existingProject = state.projects.find(
      (p) => p.project_id === snapshot.project_id,
    );
    const displayName =
      snapshot.display_name ??
      (existingProject && existingProject.display_name !== "未命名项目"
        ? existingProject.display_name
        : undefined) ??
      "未命名项目";

    return {
      project_id: snapshot.project_id,
      current_status: snapshot.current_status,
      display_name: displayName,
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

  async function loadProject(projectId: string) {
    if (!api.getProject) return;

    try {
      const snapshot = await api.getProject(projectId);
      syncProject(snapshot);
    } catch {
      // Silently fail — local data will be used as fallback
    }
  }

  async function deleteProject(projectId: string) {
    if (api.deleteProject) {
      await api.deleteProject(projectId);
    }
    const index = state.projects.findIndex(
      (p) => p.project_id === projectId,
    );
    if (index >= 0) {
      state.projects.splice(index, 1);
    }
    if (state.projectId === projectId) {
      state.projectId = null;
      state.currentStatus = "topic_pending";
    }
  }

  function resolveProjectWorkspacePath(projectId: string, currentStatus: string) {
    const step = resolveStatusStep(currentStatus);
    return `/projects/${projectId}/${step}`;
  }

  function resolveStatusStep(status: string): string {
    if (status.startsWith("topic")) return "topic";
    if (status.startsWith("script")) return "script";
    if (status.startsWith("storyboard")) return "storyboard";
    if (status.startsWith("asset_plan") || status.startsWith("assets")) return "asset";
    if (status.startsWith("compos")) return "compose";
    if (status.startsWith("render")) return "render";
    return "topic";
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
    deleteProject,
    loadProject,
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
