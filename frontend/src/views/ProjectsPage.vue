<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";

import {
  useProjectStore,
  type ProjectListItem,
} from "../stores/project";

const projectStore = useProjectStore();
const router = useRouter();

const isLoading = ref(true);
const searchQuery = ref("");
const statusFilter = ref("all");
const confirmingDeleteProjectId = ref<string | null>(null);
const isDeleting = ref(false);
const sortBy = ref("time");
const sortOrder = ref<"asc" | "desc">("desc");

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "todo", label: "需处理" },
  { key: "generating", label: "生成中" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
];

onMounted(async () => {
  document.body.classList.add("projects-page-bg");
  try {
    await projectStore.loadProjects();
  } finally {
    isLoading.value = false;
  }
});

onUnmounted(() => {
  document.body.classList.remove("projects-page-bg");
});

function isCompletedStatus(status: string): boolean {
  return status === "render_completed";
}

function isFailedStatus(status: string): boolean {
  return ["script_failed", "asset_plan_failed", "render_failed", "assets_blocked"].includes(status);
}

function isGeneratingStatus(status: string): boolean {
  return ["script_generating", "storyboard_generating", "asset_plan_generating", "assets_generating", "render_rendering"].includes(status);
}

function isTodoStatus(status: string): boolean {
  return [
    "assets_ready",
    "storyboard_ready",
    "composition_ready",
    "topic_candidates_ready",
    "script_ready",
    "asset_plan_ready",
    "render_ready",
    "script_reviewing",
    "topic_pending",
    "render_failed",
  ].includes(status);
}

function matchesFilter(project: ProjectListItem, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "todo") return isTodoStatus(project.current_status);
  if (filter === "generating") return isGeneratingStatus(project.current_status);
  if (filter === "completed") return isCompletedStatus(project.current_status);
  if (filter === "failed") return isFailedStatus(project.current_status);
  return true;
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    topic_pending: "待生成选题",
    topic_generating: "选题生成中",
    topic_candidates_ready: "待确认主题",
    script_ready: "文案已就绪",
    script_generating: "文案生成中",
    script_reviewing: "文案审阅中",
    script_failed: "文案异常",
    storyboard_ready: "分镜已就绪",
    storyboard_generating: "分镜生成中",
    asset_plan_ready: "资产规划已就绪",
    asset_plan_generating: "资产规划生成中",
    asset_plan_failed: "资产规划失败",
    assets_ready: "资产已就绪",
    assets_blocked: "资产阻断",
    assets_partial: "可合成（有提醒）",
    assets_generating: "资产生成中",
    composition_ready: "合成已就绪",
    render_ready: "渲染已就绪",
    render_rendering: "渲染中",
    render_completed: "渲染完成",
    render_failed: "渲染失败",
  };
  return labels[status] ?? status;
}

function getStatusClass(status: string): string {
  if (isCompletedStatus(status)) return "status-success";
  if (isFailedStatus(status)) return "status-danger";
  if (isGeneratingStatus(status)) return "status-warning";
  if (["render_ready", "assets_ready", "composition_ready", "script_ready", "storyboard_ready", "asset_plan_ready", "topic_candidates_ready", "script_reviewing"].includes(status)) return "status-warning";
  return "status-info";
}

function getCounts() {
  const all = projectStore.state.projects;
  return {
    all: all.length,
    todo: all.filter((p) => isTodoStatus(p.current_status)).length,
    generating: all.filter((p) => isGeneratingStatus(p.current_status)).length,
    completed: all.filter((p) => isCompletedStatus(p.current_status)).length,
    failed: all.filter((p) => isFailedStatus(p.current_status)).length,
  };
}

const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  let filtered = projectStore.state.projects.filter((project) => {
    const matchesFilterResult = matchesFilter(project, statusFilter.value);
    if (!matchesFilterResult) return false;

    if (query.length === 0) return true;
    const content = `${project.display_name} ${project.dynasty ?? ""} ${getStatusLabel(project.current_status)} ${project.topic_type ?? ""}`.toLowerCase();
    return content.includes(query);
  });

  filtered.sort((a, b) => {
    let result = 0;
    if (sortBy.value === "time") result = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    if (sortBy.value === "name") result = a.display_name.localeCompare(b.display_name);
    if (sortBy.value === "dynasty") result = (a.dynasty ?? "").localeCompare(b.dynasty ?? "");
    return sortOrder.value === "desc" ? -result : result;
  });

  return filtered;
});

const hasProjects = computed(() => projectStore.state.projects.length > 0);

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(
    projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status),
  );
}

async function openProject(project: ProjectListItem) {
  projectStore.syncProject(project);
  await router.push(
    projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status),
  );
}

function requestDeleteProject(projectId: string) {
  if (isDeleting.value) return;
  confirmingDeleteProjectId.value = projectId;
}

function cancelDeleteProject() {
  if (isDeleting.value) return;
  confirmingDeleteProjectId.value = null;
}

async function confirmDeleteProject() {
  const projectId = confirmingDeleteProjectId.value;
  if (!projectId || isDeleting.value) return;

  isDeleting.value = true;
  try {
    await projectStore.deleteProject(projectId);
    ElMessage.success("项目已删除");
    confirmingDeleteProjectId.value = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "project_delete_failed";
    ElMessage.error(`删除失败：${message}`);
  } finally {
    isDeleting.value = false;
  }
}

function setFilter(filter: string) {
  statusFilter.value = filter;
}

function sortTable(column: string) {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === "desc" ? "asc" : "desc";
  } else {
    sortBy.value = column;
    sortOrder.value = "desc";
  }
}

function handleGoHome() {
  router.push("/");
}

const BAD_DYNASTY_VALUES = new Set(["单事件", "—", "", "未知"]);

function cleanDynasty(raw: string | undefined): string {
  if (!raw || BAD_DYNASTY_VALUES.has(raw.trim())) return "—";
  return raw.trim();
}
</script>

<template>
  <div class="projects-page-wrapper">
    <!-- Top Bar -->
    <header class="topbar">
      <a class="brand" @click="handleGoHome">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M8 12.5C8 10.6 9.6 9 11.5 9h9c1.9 0 3.5 1.6 3.5 3.5v7.2c0 2.2-1.8 4-4 4h-8c-2.2 0-4-1.8-4-4v-7.2Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M10 9.2C10.7 6.9 12.9 5.5 16 5.5s5.3 1.4 6 3.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M15 13.1c0-.8.9-1.3 1.6-.9l4.1 2.4c.7.4.7 1.4 0 1.8l-4.1 2.4c-.7.4-1.6-.1-1.6-.9v-4.8Z" fill="currentColor"/>
            <path d="M11.2 14h1.7M11.2 17.5h1.7M19.1 14h1.7M19.1 17.5h1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <path d="M16 4v-2M12.2 6.2 10.6 4.5M19.8 6.2l1.6-1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="brand-text">
          <strong>历史短视频工坊</strong>
          <span>History Video Forge</span>
        </span>
      </a>

      <div class="topbar-right">
        <div class="account-actions">
          <button class="btn btn-subtle">我的</button>
          <button class="btn btn-subtle icon-btn" aria-label="设置" title="设置">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.86.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.04A1.7 1.7 0 0 0 4.6 8a1.7 1.7 0 0 0-.34-1.86l-.04-.04A2 2 0 1 1 7.05 3.27l.04.04A1.7 1.7 0 0 0 8.95 3a1.7 1.7 0 0 0 1.03-1.56V1a2 2 0 1 1 4 0v.44A1.7 1.7 0 0 0 15.01 3a1.7 1.7 0 0 0 1.86-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15Z"/></svg>
          </button>
        </div>
      </div>
    </header>

    <main class="page">
      <!-- Page Header -->
      <section class="page-header">
        <div>
          <div class="breadcrumb">
            <span>工坊控制台</span>
            <span>›</span>
            <b>我的项目</b>
          </div>
          <h1 class="page-title" data-testid="projects-heading">我的<em>项目</em></h1>
          <p class="page-desc">管理你创建的历史短视频项目，查看当前状态，按名称、朝代或更新时间快速找到项目。需要创建内容时，使用页面右侧的新建项目入口。</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" data-testid="create-project" @click="handleCreateProject">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            新建项目
          </button>
        </div>
      </section>

      <!-- Workspace Card -->
      <section class="workspace-card" v-if="hasProjects">
        <!-- Toolbar -->
        <div class="toolbar">
          <div class="toolbar-left">
            <div class="search-box">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input v-model="searchQuery" data-testid="projects-search" class="search-input" type="text" placeholder="搜索项目名称、朝代或状态..." />
            </div>
            <div class="filter-pills" data-testid="projects-status-filter">
              <button
                v-for="f in FILTERS"
                :key="f.key"
                class="filter-pill"
                :class="{ active: statusFilter === f.key }"
                @click="setFilter(f.key)"
              >
                {{ f.label }}<span class="filter-count">{{ getCounts()[f.key as keyof ReturnType<typeof getCounts>] }}</span>
              </button>
            </div>
          </div>
          <div class="table-meta">当前显示 {{ filteredProjects.length }} / {{ projectStore.state.projects.length }}</div>
        </div>

        <!-- Table -->
        <div class="table-wrap" v-if="filteredProjects.length > 0">
          <table class="projects-table">
            <colgroup>
              <col style="width: 45%;" />
              <col style="width: 12%;" />
              <col style="width: 18%;" />
              <col style="width: 17%;" />
              <col style="width: 8%;" />
            </colgroup>
            <thead>
              <tr>
                <th class="sortable" :class="{ sorted: sortBy === 'name' }" @click="sortTable('name')">项目名称<span v-if="sortBy === 'name'" class="sort-arrow">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span></th>
                <th class="sortable" :class="{ sorted: sortBy === 'dynasty' }" @click="sortTable('dynasty')">朝代<span v-if="sortBy === 'dynasty'" class="sort-arrow">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span></th>
                <th>状态</th>
                <th class="sortable sorted" :class="{ sorted: sortBy === 'time' }" @click="sortTable('time')">更新时间<span v-if="sortBy === 'time'" class="sort-arrow">{{ sortOrder === 'desc' ? '↓' : '↑' }}</span></th>
                <th style="text-align:right;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filteredProjects" :key="row.project_id" @click="openProject(row)">
                <td>
                  <div class="project-cell">
                    <div class="thumb" aria-hidden="true"></div>
                    <div class="project-main">
                      <div class="project-title" :data-testid="`open-project-${row.project_id}`">{{ row.display_name }}</div>
                      <div class="project-sub">
                        <span>{{ row.topic_type ?? '—' }}</span>
                        <span class="mini-sep"></span>
                        <span>{{ row.aspect_ratio ?? '9:16' }}</span>
                        <span class="mini-sep"></span>
                        <span>{{ row.duration ?? '—' }}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td><span class="dynasty-tag">{{ cleanDynasty(row.dynasty) }}</span></td>
                <td>
                  <span
                    class="status-badge"
                    :class="[getStatusClass(row.current_status), isGeneratingStatus(row.current_status) ? 'status-generating' : '']"
                    :data-testid="`project-stage-${row.project_id}`"
                  >
                    <span class="status-dot"></span>{{ getStatusLabel(row.current_status) }}
                  </span>
                </td>
                <td><span class="time">{{ formatDateTime(row.updated_at) }}</span></td>
                <td>
                  <div class="action-cell">
                    <template v-if="confirmingDeleteProjectId === row.project_id">
                      <button
                        class="delete-btn"
                        :data-testid="`confirm-delete-project-${row.project_id}`"
                        style="color: var(--danger); border-color: rgba(192, 100, 84, 0.45);"
                        @click.stop="confirmDeleteProject"
                        title="确认删除"
                      >
                        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                      </button>
                      <button
                        class="delete-btn"
                        style="color: var(--text-secondary);"
                        @click.stop="cancelDeleteProject"
                        :disabled="isDeleting"
                        title="取消"
                      >
                        <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </template>
                    <button
                      v-else
                      class="delete-btn"
                      :data-testid="`delete-project-${row.project_id}`"
                      @click.stop="requestDeleteProject(row.project_id)"
                      title="删除项目"
                    >
                      <svg viewBox="0 0 24 24">
                        <path d="M3 6h18"></path>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                        <path d="M19 6l-1 14c-.1 1.1-1 2-2.1 2H8.1C7 22 6.1 21.1 6 20L5 6"></path>
                        <path d="M10 11v6"></path>
                        <path d="M14 11v6"></path>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty State (filter yielded no results) -->
        <div class="empty-state" v-if="filteredProjects.length === 0 && !isLoading" :style="{ display: 'flex' }">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6M9 14h6"/></svg>
          </div>
          <h2>没有找到项目</h2>
          <p>可以调整筛选条件，或创建一个新的历史视频项目。</p>
          <button class="btn btn-primary" @click="handleCreateProject">新建项目</button>
        </div>

        <!-- Footer Line -->
        <div class="footer-line">
          <span>共 <strong>{{ filteredProjects.length }}</strong> 个项目</span>
          <span>默认按 <strong>更新时间</strong> 倒序排列</span>
        </div>
      </section>

      <!-- Empty State (no projects at all) -->
      <section class="workspace-card" v-if="!hasProjects && !isLoading">
        <div class="empty-state" :style="{ display: 'flex' }">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 11v6M9 14h6"/></svg>
          </div>
          <h2>还没有任何项目</h2>
          <p>开始你的第一个历史视频创作之旅吧</p>
          <button class="btn btn-primary" data-testid="create-first-project" @click="handleCreateProject">创建第一个项目</button>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
</style>
