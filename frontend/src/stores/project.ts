import { inject, reactive, readonly, type InjectionKey } from "vue";
import type { NarrationSelection } from '../../../shared/src/narration/narration-model-policy.schema';
import { apiFetch, ApiError } from "../utils/api";

export interface ProjectSnapshot {
  project_id: string;
  current_status: string;
  owner_id?: string;
  display_name?: string;
  is_draft?: boolean;
  updated_at?: string;
  scope_label?: string | null;
  family_label?: string | null;
  duration_sec?: number | null;
  aspect_ratio?: string | null;
  thumbnail_url?: string | null;
  /** S2-2A：项目冻结的生成配置快照（只读）。 */
  generation_configuration?: {
    configuration: Record<string, unknown>;
    revision: number;
    source: "stored" | "backfilled_default";
    source_user_preference_revision: number | null;
    updated_at: string;
  } | null;
  /** S2-2A：配置版本（便于快速判断是否需要刷新）。 */
  generation_configuration_version?: number;
  /** S2-2A：配置失效预览。 */
  configuration_invalidation_preview?: {
    affected_stages: string[];
    note: string;
  };
  /** S2-2A：只读成本摘要占位。 */
  cost_summary?: {
    total_estimated_cost_micros: string;
    total_actual_cost_micros: string;
    record_count: number;
  };
}

export interface CreateProjectInput {
  name?: string;
  /** 任务11C：创建不兼容恢复时用户选定的合格口播组合。 */
  narrationSelection?: NarrationSelection;
}

/** 任务11C：创建资格/策略/开关错误的类型化承载（不引用 Vue 组件）。 */
export class NarrationCreationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: "narration_selection_required" | "narration_creation_context_changed" | "narration_policy_changed" | "narration_mode_unavailable",
    readonly reason: string,
    readonly policyVersion: string,
    readonly options: NarrationSelectionOption[],
  ) {
    super(code);
    this.name = "NarrationCreationError";
  }
}

export interface NarrationSelectionOption {
  provider_model_id: string;
  voice_profile_id: string;
  model: string;
  voice: string;
  region: string;
  protocol: string;
  parameters_version: string;
}

const NARRATION_CREATION_ERROR_CODES = new Set([
  "narration_selection_required",
  "narration_creation_context_changed",
  "narration_policy_changed",
  "narration_mode_unavailable",
]);

function toNarrationCreationError(error: unknown): NarrationCreationError | null {
  if (!(error instanceof ApiError) || !NARRATION_CREATION_ERROR_CODES.has(error.code)) return null;
  const body = (error.body ?? {}) as {
    reason?: unknown;
    policy_version?: unknown;
    options?: unknown;
  };
  const options = Array.isArray(body.options)
    ? (body.options as NarrationSelectionOption[]).filter(
        (option) =>
          option &&
          typeof option.provider_model_id === "string" &&
          typeof option.voice_profile_id === "string" &&
          typeof option.model === "string" &&
          typeof option.voice === "string",
      )
    : [];
  return new NarrationCreationError(
    error.status,
    error.code as NarrationCreationError["code"],
    typeof body.reason === "string" ? body.reason : error.code,
    typeof body.policy_version === "string" ? body.policy_version : "",
    options,
  );
}

export interface ProjectListItem extends ProjectSnapshot {
  display_name: string;
  is_draft: boolean;
  updated_at: string;
  dynasty?: string;
  topic_type?: string;
  duration?: string;
  aspect_ratio?: string;
  thumbnail_url?: string;
  publish_ready?: boolean;
}

export interface ProjectApi {
  listProjects?: () => Promise<ProjectListItem[]>;
  getProject?: (projectId: string) => Promise<ProjectSnapshot>;
  deleteProject?: (projectId: string) => Promise<void>;
  createProject(input?: CreateProjectInput): Promise<ProjectSnapshot>;
}

export interface ProjectStoreState {
  projectId: string | null;
  projectOwnerId: string | null;
  currentStatus: string;
  publishIsReady: boolean;
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
  setPublishReady: (ready: boolean) => void;
}

export const projectStoreKey: InjectionKey<ProjectStore> = Symbol("project-store");

export function createFetchProjectApi(baseUrl = ""): ProjectApi {
  return {
    async listProjects() {
      try {
        return await apiFetch<ProjectListItem[]>(`${baseUrl}/api/projects`);
      } catch {
        return [];
      }
    },
    async getProject(projectId) {
      const data = await apiFetch<Record<string, unknown>>(`${baseUrl}/api/projects/${projectId}`);
      const topicPkg = data.active_topic_package as Record<string, unknown> | null | undefined;
      const rawName = data.display_name ?? topicPkg?.canonical_title ?? data.name ?? undefined;
      const generationConfig = data.generation_configuration as ProjectSnapshot["generation_configuration"];
      const invalidationPreview = data.configuration_invalidation_preview as ProjectSnapshot["configuration_invalidation_preview"];
      const costSummary = data.cost_summary as ProjectSnapshot["cost_summary"];
      return {
        project_id: (data.project_id ?? projectId) as string,
        current_status: (data.current_status ?? "") as string,
        owner_id: typeof data.owner_id === "string" ? data.owner_id : undefined,
        display_name: typeof rawName === "string" ? rawName : undefined,
        generation_configuration: generationConfig ?? null,
        generation_configuration_version:
          typeof data.generation_configuration_version === "number" ? data.generation_configuration_version : undefined,
        configuration_invalidation_preview: invalidationPreview,
        cost_summary: costSummary,
      };
    },
    async deleteProject(projectId) {
      await apiFetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" });
    },
    async createProject(input) {
      return await apiFetch<ProjectSnapshot>(`${baseUrl}/api/projects`, {
        method: "POST",
        body: {
          name: input?.name ?? "未命名项目",
          ...(input?.narrationSelection ? { narration_selection: input.narrationSelection } : {}),
        },
      });
    },
  };
}

export function createProjectStore(api: ProjectApi): ProjectStore {
  const state = reactive<ProjectStoreState>({
    projectId: null,
    projectOwnerId: null,
    currentStatus: "topic_pending",
    publishIsReady: false,
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
      dynasty: snapshot.scope_label ?? undefined,
      topic_type: snapshot.family_label ?? undefined,
      duration: formatDurationSec(snapshot.duration_sec ?? undefined),
      aspect_ratio: snapshot.aspect_ratio ?? undefined,
      thumbnail_url: snapshot.thumbnail_url ?? undefined,
      // S2-2A：生成配置快照字段。与 display_name 相同的保持语义：
      // incoming 为 undefined（如 script/storyboard/assets 的状态型 syncProject）
      // 时保留 existingProject 的值；generation_configuration 明确传 null 才清空。
      generation_configuration:
        snapshot.generation_configuration !== undefined
          ? snapshot.generation_configuration
          : existingProject?.generation_configuration ?? undefined,
      generation_configuration_version:
        snapshot.generation_configuration_version !== undefined
          ? snapshot.generation_configuration_version
          : existingProject?.generation_configuration_version,
      configuration_invalidation_preview:
        snapshot.configuration_invalidation_preview !== undefined
          ? snapshot.configuration_invalidation_preview
          : existingProject?.configuration_invalidation_preview,
      cost_summary:
        snapshot.cost_summary !== undefined
          ? snapshot.cost_summary
          : existingProject?.cost_summary,
    };
  }

  function formatDurationSec(sec: number | undefined): string | undefined {
    if (sec == null) return undefined;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    // Preserve existing owner when the incoming snapshot omits it (e.g.
    // status-only syncs from downstream stores). This keeps the admin
    // deputizing banner stable across panel reloads / tab switches.
    state.projectOwnerId = snapshot.owner_id ?? state.projectOwnerId ?? null;
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
    let snapshot: ProjectSnapshot;
    try {
      snapshot = await api.createProject(input);
    } catch (error) {
      const narrationError = toNarrationCreationError(error);
      if (narrationError) throw narrationError;
      throw error;
    }
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
    const index = state.projects.findIndex(
      (p) => p.project_id === projectId,
    );
    const removedProject = index >= 0 ? state.projects[index] : null;

    if (index >= 0) {
      state.projects.splice(index, 1);
    }

    try {
      if (api.deleteProject) {
        await api.deleteProject(projectId);
      }
    } catch (error) {
      if (removedProject && !state.projects.some((p) => p.project_id === projectId)) {
        state.projects.splice(index >= 0 ? index : 0, 0, removedProject);
      }
      throw error;
    }

    if (state.projectId === projectId) {
      state.projectId = null;
      state.projectOwnerId = null;
      state.currentStatus = "topic_pending";
    }
  }

  function setPublishReady(ready: boolean) {
    state.publishIsReady = ready;
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
    if (status.startsWith("compos") || status.startsWith("render")) return "compose-render";
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
    setPublishReady,
  };
}

export function useProjectStore() {
  const store = inject(projectStoreKey);
  if (!store) {
    throw new Error("project_store_missing");
  }

  return store;
}
