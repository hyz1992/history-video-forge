<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import {
  useProjectStore,
  type ProjectListItem,
} from "../stores/project";

const projectStore = useProjectStore();
const router = useRouter();

const isLoading = ref(true);
const searchQuery = ref("");
const statusFilter = ref("all");

const statusOptions = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "completed", label: "已完成" },
];

onMounted(async () => {
  try {
    await projectStore.loadProjects();
  } finally {
    isLoading.value = false;
  }
});

const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const status = statusFilter.value;

  return projectStore.state.projects.filter((project) => {
    const matchesSearch =
      query.length === 0 ||
      project.display_name.toLowerCase().includes(query);

    let matchesStatus = true;
    if (status === "active") {
      matchesStatus = !isCompletedStatus(project.current_status);
    } else if (status === "completed") {
      matchesStatus = isCompletedStatus(project.current_status);
    }

    return matchesSearch && matchesStatus;
  }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
});

const hasProjects = computed(() => projectStore.state.projects.length > 0);

function isCompletedStatus(status: string): boolean {
  return status === "render_completed" || status === "render_ready";
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    topic_pending: "待生成选题",
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

function getStatusTagType(status: string): "" | "success" | "warning" | "danger" | "info" {
  if (status === "script_ready" || status === "storyboard_ready" || status === "asset_plan_ready" || status === "assets_ready" || status === "composition_ready" || status === "render_completed") return "success";
  if (status === "script_generating" || status === "script_reviewing" || status === "storyboard_generating" || status === "asset_plan_generating" || status === "assets_generating" || status === "render_ready") return "warning";
  if (status === "script_failed" || status === "asset_plan_failed" || status === "render_failed" || status === "assets_blocked") return "danger";
  if (status === "assets_partial") return "warning";
  if (status === "script_failed") return "danger";
  if (status === "topic_candidates_ready") return "";
  return "info";
}

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

async function handleDelete(projectId: string) {
  await projectStore.deleteProject(projectId);
}

function handleRowClick(row: ProjectListItem) {
  openProject(row);
}
</script>

<template>
  <section class="projects-page">
    <div class="projects-container">
      <!-- Header -->
      <header class="projects-header">
        <div class="projects-header-copy">
          <h1 data-testid="projects-heading" class="projects-title">
            我的项目
          </h1>
          <p class="projects-subtitle">
            管理你的所有创作项目，点击项目名称进入工作区。
          </p>
        </div>

        <el-button
          data-testid="create-project"
          type="primary"
          @click="handleCreateProject"
        >
          新建项目
        </el-button>
      </header>

      <!-- Toolbar -->
      <div v-if="hasProjects" class="projects-toolbar">
        <el-input
          v-model="searchQuery"
          data-testid="projects-search"
          placeholder="搜索项目名称"
          prefix-icon="Search"
          clearable
          class="projects-search"
        />

        <el-radio-group
          v-model="statusFilter"
          data-testid="projects-status-filter"
          size="default"
          class="projects-status-filter"
        >
          <el-radio-button
            v-for="opt in statusOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <!-- Table -->
      <div v-if="hasProjects" class="projects-table-wrapper">
        <el-table
          :data="filteredProjects"
          v-loading="isLoading"
          class="projects-table"
          @row-click="handleRowClick"
          highlight-current-row
          empty-text="暂无符合条件的项目"
        >
          <el-table-column
            prop="display_name"
            label="项目名称"
            min-width="240"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <span class="project-name" :data-testid="`open-project-${row.project_id}`">{{ row.display_name }}</span>
            </template>
          </el-table-column>

          <el-table-column
            prop="current_status"
            label="状态"
            width="160"
          >
            <template #default="{ row }">
              <el-tag
                :data-testid="`project-stage-${row.project_id}`"
                :type="getStatusTagType(row.current_status)"
                size="default"
                effect="light"
                round
              >
                {{ getStatusLabel(row.current_status) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column
            prop="updated_at"
            label="更新时间"
            width="200"
            sortable
          >
            <template #default="{ row }">
              <span class="project-time">{{ formatDateTime(row.updated_at) }}</span>
            </template>
          </el-table-column>

          <el-table-column
            label="操作"
            width="100"
            align="center"
          >
            <template #default="{ row }">
              <el-popconfirm
                title="确定删除该项目吗？"
                confirm-button-text="删除"
                cancel-button-text="取消"
                width="220"
                @confirm="handleDelete(row.project_id)"
              >
                <template #reference>
                  <el-button
                    :data-testid="`delete-project-${row.project_id}`"
                    type="danger"
                    link
                    size="small"
                    @click.stop
                  >
                    删除
                  </el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- Empty State (no projects at all) -->
      <div v-if="!hasProjects && !isLoading" class="projects-empty">
        <el-empty description="还没有任何项目">
          <el-button
            data-testid="create-first-project"
            type="primary"
            @click="handleCreateProject"
          >
            创建第一个项目
          </el-button>
        </el-empty>
      </div>
    </div>
  </section>
</template>

<style scoped>
.projects-page {
  min-height: 100vh;
  padding: var(--space-xl) var(--space-lg);
  background: var(--bg-base);
}

.projects-container {
  max-width: 1000px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* ── Header ── */
.projects-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.projects-header-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.projects-title {
  font-size: clamp(1.8rem, 4vw, 3rem);
  font-weight: var(--font-heading);
  color: var(--text-heading);
  letter-spacing: -0.02em;
  margin: 0;
}

.projects-subtitle {
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

/* ── Toolbar ── */
.projects-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.projects-search {
  max-width: 360px;
  min-width: 200px;
  flex: 1 1 auto;
}

.projects-status-filter {
  flex-shrink: 0;
}

/* ── Table ── */
.projects-table-wrapper {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-panel);
  overflow: hidden;
  background: var(--bg-panel);
  box-shadow: var(--shadow-card);
}

.projects-table {
  width: 100%;
  --el-table-border-color: var(--border-default);
  cursor: pointer;
}

.projects-table :deep(.el-table__row) {
  transition: background-color 0.15s ease;
}

.projects-table :deep(.el-table__row:hover) {
  cursor: pointer;
}

.project-name {
  font-weight: var(--font-subheading);
  color: var(--text-heading);
}

.project-time {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* ── Empty State ── */
.projects-empty {
  display: flex;
  justify-content: center;
  padding: var(--space-xl) 0;
}

.projects-empty :deep(.el-empty__description p) {
  color: var(--text-secondary);
}

/* ── Responsive ── */
@media (max-width: 819px) {
  .projects-page {
    padding: var(--space-lg) var(--space-md);
  }

  .projects-header {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
  }

  .projects-header-copy {
    align-items: center;
  }

  .projects-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .projects-search {
    max-width: none;
  }

  .projects-status-filter {
    align-self: center;
  }
}

@media (max-width: 479px) {
  .projects-page {
    padding: var(--space-md) var(--space-sm);
  }
}
</style>
