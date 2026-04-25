<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import {
  useProjectStore,
  type ProjectListItem,
} from "../stores/project";

type MainSortKey = "updated_at" | "stage";
type SortDirection = "asc" | "desc";
type DraftSortKey = "generated" | "updated";

interface VirtualRow {
  item: ProjectListItem;
  top: number;
}

const TABLE_ROW_HEIGHT = 64;
const TABLE_VIEWPORT_HEIGHT = 448;
const TABLE_OVERSCAN = 5;
const DEFAULT_STAGE = "all";

const projectStore = useProjectStore();
const router = useRouter();

const searchQuery = ref("");
const stageFilter = ref(DEFAULT_STAGE);
const sortState = reactive<{
  key: MainSortKey;
  direction: SortDirection;
}>({
  key: "updated_at",
  direction: "desc",
});
const draftSearchQuery = ref("");
const draftSortKey = ref<DraftSortKey>("generated");
const isDraftDrawerOpen = ref(false);
const tableScrollTop = ref(0);

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());
const normalizedDraftSearch = computed(() => draftSearchQuery.value.trim().toLowerCase());

const draftProjects = computed(() =>
  projectStore.state.projects.filter((project) => project.current_status === "topic_candidates_ready"),
);

const mainProjects = computed(() =>
  projectStore.state.projects.filter((project) => project.current_status !== "topic_candidates_ready"),
);

const availableStages = computed(() => {
  const stages = new Set(mainProjects.value.map((project) => project.current_status));
  return [
    { value: DEFAULT_STAGE, label: "全部阶段" },
    ...Array.from(stages).map((status) => ({
      value: status,
      label: getStageLabel(status),
    })),
  ];
});

const filteredMainProjects = computed(() => {
  const stageValue = stageFilter.value;

  return sortProjects(
    mainProjects.value.filter((project) => {
      const matchesSearch =
        normalizedSearchQuery.value.length === 0 ||
        project.display_name.toLowerCase().includes(normalizedSearchQuery.value);
      const matchesStage = stageValue === DEFAULT_STAGE || project.current_status === stageValue;
      return matchesSearch && matchesStage;
    }),
    sortState.key,
    sortState.direction,
  );
});

const filteredDraftProjects = computed(() =>
  draftProjects.value
    .filter((project) =>
      normalizedDraftSearch.value.length === 0
        ? true
        : project.display_name.toLowerCase().includes(normalizedDraftSearch.value),
    )
    .sort((left, right) => {
      if (draftSortKey.value === "generated") {
        return compareIsoDate(right.updated_at, left.updated_at);
      }

      return compareIsoDate(right.updated_at, left.updated_at);
    }),
);

const tableTotalHeight = computed(() =>
  filteredMainProjects.value.length * TABLE_ROW_HEIGHT,
);

const visibleRowCount = computed(() =>
  Math.ceil(TABLE_VIEWPORT_HEIGHT / TABLE_ROW_HEIGHT) + TABLE_OVERSCAN * 2,
);

const virtualRows = computed<VirtualRow[]>(() => {
  const startIndex = Math.max(
    0,
    Math.floor(tableScrollTop.value / TABLE_ROW_HEIGHT) - TABLE_OVERSCAN,
  );
  const endIndex = Math.min(
    filteredMainProjects.value.length,
    startIndex + visibleRowCount.value,
  );

  return filteredMainProjects.value.slice(startIndex, endIndex).map((item, index) => ({
    item,
    top: (startIndex + index) * TABLE_ROW_HEIGHT,
  }));
});

watch([filteredMainProjects, stageFilter, searchQuery], () => {
  tableScrollTop.value = 0;
});

onMounted(async () => {
  await projectStore.loadProjects();
});

async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status));
}

async function openProject(project: ProjectListItem) {
  projectStore.syncProject(project);
  isDraftDrawerOpen.value = false;
  await router.push(projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status));
}

function toggleDraftDrawer() {
  isDraftDrawerOpen.value = !isDraftDrawerOpen.value;
}

function handleTableScroll(event: Event) {
  tableScrollTop.value = (event.target as HTMLElement).scrollTop;
}

function toggleSort(key: MainSortKey) {
  if (sortState.key === key) {
    sortState.direction = sortState.direction === "desc" ? "asc" : "desc";
    return;
  }

  sortState.key = key;
  sortState.direction = key === "updated_at" ? "desc" : "asc";
}

function sortProjects(
  projects: ProjectListItem[],
  key: MainSortKey,
  direction: SortDirection,
) {
  return [...projects].sort((left, right) => {
    const comparison =
      key === "updated_at"
        ? compareIsoDate(left.updated_at, right.updated_at)
        : compareStage(left.current_status, right.current_status);

    return direction === "asc" ? comparison : comparison * -1;
  });
}

function compareIsoDate(left: string, right: string) {
  return new Date(left).getTime() - new Date(right).getTime();
}

function compareStage(left: string, right: string) {
  return getStageOrder(left) - getStageOrder(right);
}

function getStageOrder(currentStatus: string) {
  const orderMap: Record<string, number> = {
    topic_pending: 0,
    topic_candidates_ready: 1,
    script_ready: 2,
    script_generating: 3,
    script_reviewing: 4,
    script_failed: 5,
  };

  return orderMap[currentStatus] ?? 99;
}

function getStageLabel(currentStatus: string) {
  const labels: Record<string, string> = {
    topic_pending: "待生成选题",
    topic_candidates_ready: "待确认主题",
    script_ready: "文案已就绪",
    script_generating: "文案生成中",
    script_reviewing: "文案审阅中",
    script_failed: "文案异常",
  };

  return labels[currentStatus] ?? currentStatus;
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

function getSortLabel(key: MainSortKey) {
  if (sortState.key !== key) {
    return "";
  }

  return sortState.direction === "desc" ? " ↓" : " ↑";
}
</script>

<template>
  <section class="projects-page workspace-shell">
    <div data-testid="projects-content-column" class="projects-content-column">
      <header class="projects-header">
        <div class="projects-header-copy">
          <h1 data-testid="projects-heading">我的项目</h1>
          <p class="projects-summary">这里展示已确定主题的项目，直接回到当前最需要处理的工作区。</p>
        </div>

        <div data-testid="projects-header-actions" class="projects-header-actions">
          <button
            data-testid="create-project"
            class="btn btn-primary projects-create-button projects-header-button"
            type="button"
            @click="handleCreateProject"
          >
            新建项目
          </button>
          <button
            data-testid="projects-draft-button"
            class="btn btn-secondary projects-draft-button projects-header-button"
            type="button"
            @click="toggleDraftDrawer"
          >
            草稿箱
          </button>
        </div>
      </header>

      <section data-testid="projects-table-shell" class="projects-table-shell workspace-panel">
        <div data-testid="projects-table-toolbar" class="projects-table-toolbar">
          <label
            data-testid="projects-search-shell"
            class="projects-filter-field projects-filter-field--search projects-filter-field--wide"
          >
            <span class="projects-field-label">搜索项目</span>
            <input
              data-testid="projects-search"
              v-model="searchQuery"
              type="search"
              placeholder="搜索项目名或主题"
            >
          </label>

          <label
            data-testid="projects-stage-filter-shell"
            class="projects-filter-field projects-filter-field--select"
          >
            <span class="projects-field-label">阶段</span>
            <select data-testid="projects-stage-filter" v-model="stageFilter">
              <option
                v-for="stage in availableStages"
                :key="stage.value"
                :value="stage.value"
              >
                {{ stage.label }}
              </option>
            </select>
          </label>
        </div>

        <header data-testid="projects-table-head" class="projects-table-head">
          <span>标题</span>
          <button
            data-testid="projects-sort-updated-at"
            class="projects-sort-button"
            type="button"
            @click="toggleSort('updated_at')"
          >
            生成时间{{ getSortLabel("updated_at") }}
          </button>
          <button
            data-testid="projects-sort-stage"
            class="projects-sort-button"
            type="button"
            @click="toggleSort('stage')"
          >
            阶段{{ getSortLabel("stage") }}
          </button>
          <span class="projects-head-action">打开</span>
          <span class="projects-head-action">删除</span>
        </header>

        <div
          v-if="filteredMainProjects.length === 0"
          data-testid="projects-empty-state"
          class="projects-empty-state"
        >
          暂无符合条件的项目
        </div>

        <div
          v-else
          class="projects-table-scroll"
          @scroll="handleTableScroll"
        >
          <div class="projects-table-spacer" :style="{ height: `${tableTotalHeight}px` }">
            <article
              v-for="row in virtualRows"
              :key="row.item.project_id"
              :data-testid="`project-row-${row.item.project_id}`"
              class="projects-table-row"
              :style="{ transform: `translateY(${row.top}px)` }"
            >
              <div class="projects-row-title">
                <h2>{{ row.item.display_name }}</h2>
              </div>
              <div class="projects-row-time">
                {{ formatDateTime(row.item.updated_at) }}
              </div>
              <div class="projects-row-stage">
                <span
                  :data-testid="`project-stage-${row.item.project_id}`"
                  class="project-stage-pill"
                >
                  {{ getStageLabel(row.item.current_status) }}
                </span>
              </div>
              <div class="projects-row-action">
                <button
                  :data-testid="`open-project-${row.item.project_id}`"
                  class="btn btn-secondary btn-compact projects-row-open"
                  type="button"
                  @click="openProject(row.item)"
                >
                  打开
                </button>
              </div>
              <div class="projects-row-action">
                <button
                  :data-testid="`delete-project-${row.item.project_id}`"
                  class="btn btn-ghost btn-compact btn-icon"
                  type="button"
                  disabled
                  title="当前阶段未开放删除"
                  aria-label="删除项目"
                >
                  <span aria-hidden="true">🗑</span>
                </button>
              </div>
            </article>
          </div>
        </div>

        <footer data-testid="projects-table-footer" class="projects-table-footer">
          {{ filteredMainProjects.length }} 个项目
        </footer>
      </section>
    </div>

    <div
      v-if="isDraftDrawerOpen"
      data-testid="projects-draft-overlay"
      class="projects-draft-overlay"
      @click="toggleDraftDrawer"
    ></div>

    <aside
      v-if="isDraftDrawerOpen"
      data-testid="projects-draft-drawer"
      class="projects-draft-drawer workspace-panel workspace-panel--strong"
    >
      <header class="projects-draft-header">
        <div class="projects-draft-head-copy">
          <h2>草稿箱</h2>
          <p>仅显示已生成候选题、但尚未确认主题的项目</p>
        </div>
        <button
          data-testid="projects-draft-close"
          class="projects-draft-close-button"
          type="button"
          aria-label="关闭草稿箱"
          @click="toggleDraftDrawer"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div class="projects-draft-controls">
        <label
          data-testid="projects-draft-search-shell"
          class="projects-draft-search-shell"
        >
          <span aria-hidden="true" class="projects-draft-search-icon">⌕</span>
          <input
            data-testid="projects-draft-search"
            v-model="draftSearchQuery"
            type="search"
            placeholder="搜索草稿项目"
          >
        </label>

        <div class="projects-draft-sorter" role="group" aria-label="草稿箱排序">
          <button
            data-testid="projects-draft-sort-generated"
            :class="['projects-pill-button', { 'projects-pill-button--active': draftSortKey === 'generated' }]"
            type="button"
            @click="draftSortKey = 'generated'"
          >
            最近生成
          </button>
          <button
            data-testid="projects-draft-sort-updated"
            :class="['projects-pill-button', { 'projects-pill-button--active': draftSortKey === 'updated' }]"
            type="button"
            @click="draftSortKey = 'updated'"
          >
            最近更新
          </button>
        </div>
      </div>

      <div
        v-if="filteredDraftProjects.length === 0"
        data-testid="draft-projects-empty"
        class="projects-draft-empty"
      >
        <span aria-hidden="true" class="projects-draft-empty-icon">▱</span>
        <span>没有更多草稿项目了</span>
      </div>

      <div data-testid="projects-draft-card-list" v-else class="projects-draft-list">
        <article
          v-for="project in filteredDraftProjects"
          :key="project.project_id"
          :data-testid="`project-card-${project.project_id}`"
          class="projects-draft-card"
        >
          <div class="projects-draft-card-copy">
            <h3>{{ project.display_name }}</h3>
            <p class="projects-draft-card-meta">{{ formatDateTime(project.updated_at) }}</p>
            <p class="projects-draft-card-note">候选题已生成</p>
          </div>
          <button
            :data-testid="`open-project-${project.project_id}`"
            class="btn btn-secondary btn-compact projects-draft-open"
            type="button"
            @click="openProject(project)"
          >
            继续查看
          </button>
        </article>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.projects-page {
  align-content: start;
  justify-items: center;
}

.projects-content-column {
  width: min(100%, 1000px);
  margin: 0 auto;
  justify-self: center;
  display: grid;
  gap: 24px;
}

.projects-header,
.projects-header-actions,
.projects-draft-header,
.projects-draft-sorter {
  display: flex;
  align-items: center;
  gap: 12px;
}

.projects-header,
.projects-draft-header {
  justify-content: space-between;
}

.projects-header-copy {
  display: grid;
  gap: 8px;
}

.projects-header h1,
.projects-row-title h2,
.projects-draft-header h2,
.projects-draft-card h3 {
  margin: 0;
}

.projects-header h1 {
  font-size: 48px;
  line-height: 56px;
  letter-spacing: -0.5px;
}

.projects-summary,
.projects-draft-header p,
.projects-draft-card p {
  margin: 0;
  color: var(--workspace-text-muted);
  font-size: 14px;
  line-height: 22px;
}

.projects-filter-field {
  display: grid;
  gap: 8px;
}

.projects-filter-field--search {
  flex: 1 1 auto;
}

.projects-filter-field--wide {
  min-width: 0;
  flex: 1 1 auto;
  max-width: 560px;
}

.projects-filter-field--select {
  flex: 0 0 140px;
}

.projects-field-label {
  color: var(--workspace-accent);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.projects-table-toolbar :where(input, select),
.projects-draft-toolbar input {
  min-height: 40px;
  border: 1px solid rgba(212, 163, 95, 0.18);
  border-radius: 8px;
  background: rgba(10, 14, 22, 0.86);
  color: var(--workspace-text);
}

.projects-table-toolbar input {
  width: 100%;
  padding: 0 16px;
}

.projects-table-toolbar select {
  padding: 0 14px;
}

.projects-draft-toolbar input {
  min-height: 36px;
  padding: 0 14px;
}

.projects-table-shell {
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid rgba(212, 163, 95, 0.12);
  background:
    linear-gradient(180deg, rgba(23, 30, 45, 0.92), rgba(17, 23, 35, 0.94)),
    rgba(18, 23, 35, 0.94);
  box-shadow: var(--workspace-shadow-soft);
}

.projects-table-toolbar {
  display: flex;
  align-items: end;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(212, 163, 95, 0.1);
}

.projects-table-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px 160px 80px 80px;
  align-items: center;
  column-gap: 12px;
  position: sticky;
  top: 0;
  z-index: 2;
  min-height: 48px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(212, 163, 95, 0.12);
  background: rgba(17, 23, 35, 0.94);
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}

.projects-head-action {
  text-align: center;
}

.projects-sort-button {
  padding: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.projects-table-scroll {
  position: relative;
  height: 574px;
  overflow-y: auto;
}

.projects-table-spacer {
  position: relative;
}

.projects-table-row {
  position: absolute;
  inset-inline: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px 160px 80px 80px;
  align-items: center;
  column-gap: 12px;
  min-height: 64px;
  padding: 14px 20px;
  border-bottom: 1px solid rgba(212, 163, 95, 0.08);
  background: rgba(10, 14, 22, 0.12);
  transition: background 180ms ease, border-color 180ms ease;
  box-sizing: border-box;
}

.projects-table-row:hover {
  background: rgba(255, 255, 255, 0.025);
  border-bottom-color: rgba(212, 163, 95, 0.16);
}

.projects-row-title h2 {
  font-size: 0.98rem;
  font-weight: 600;
}

.projects-row-time,
.projects-row-stage {
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}

.projects-row-action {
  display: flex;
  justify-content: center;
}

.project-stage-pill {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid rgba(212, 163, 95, 0.12);
  border-radius: 999px;
  background: rgba(212, 163, 95, 0.08);
  color: var(--workspace-accent);
  white-space: nowrap;
}

.projects-empty-state,
.projects-draft-empty {
  padding: 20px;
  color: var(--workspace-text-muted);
}

.btn-compact {
  min-height: 32px;
  padding: 0 12px;
  font-size: 0.88rem;
  border-radius: 6px;
}

.btn-ghost {
  border: 1px solid rgba(212, 163, 95, 0.14);
  background: rgba(255, 255, 255, 0.02);
  color: var(--workspace-text-muted);
  box-shadow: none;
}

.btn-ghost[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  width: 32px;
  min-height: 32px;
  padding: 0;
  justify-content: center;
}

.projects-draft-button {
  border-color: rgba(212, 163, 95, 0.22);
  background: rgba(212, 163, 95, 0.04);
  color: var(--workspace-accent);
}

.projects-header-button {
  min-height: 36px;
  padding: 0 20px;
  border-radius: 8px;
}

.projects-draft-button {
  padding: 0 16px;
}

.projects-row-open {
  min-width: 56px;
}

.projects-draft-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 7, 12, 0.35);
  backdrop-filter: blur(2px);
}

.projects-draft-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 360px;
  padding: 20px;
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: 20px;
  z-index: 10;
  overflow: auto;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-right: none;
  background:
    linear-gradient(180deg, rgba(24, 31, 47, 0.98), rgba(16, 22, 35, 0.98)),
    rgba(18, 24, 38, 0.98);
  box-shadow: -24px 0 80px rgba(2, 4, 10, 0.42);
}

.projects-draft-header {
  align-items: flex-start;
}

.projects-draft-head-copy {
  display: grid;
  gap: 8px;
  flex: 1;
}

.projects-draft-head-copy p {
  max-width: 280px;
}

.projects-draft-close-button {
  width: 32px;
  min-height: 32px;
  padding: 0;
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--workspace-text-muted);
  box-shadow: none;
  font-size: 20px;
  line-height: 1;
}

.projects-draft-controls {
  display: grid;
  gap: 12px;
}

.projects-draft-search-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 14px;
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 10px;
  background: rgba(10, 14, 22, 0.82);
}

.projects-draft-search-icon {
  color: var(--workspace-text-soft);
  font-size: 16px;
}

.projects-draft-search-shell input {
  flex: 1;
  min-height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--workspace-text);
}

.projects-draft-search-shell input:focus {
  outline: none;
}

.projects-draft-search-shell input::placeholder {
  color: var(--workspace-text-soft);
}

.projects-draft-sorter {
  gap: 8px;
}

.projects-pill-button {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.02);
  box-shadow: none;
  color: var(--workspace-text-muted);
  flex: 1 1 0;
}

.projects-pill-button--active {
  border-color: rgba(212, 163, 95, 0.32);
  background: rgba(212, 163, 95, 0.12);
  color: var(--workspace-text);
}

.projects-draft-list {
  display: grid;
  gap: 12px;
  align-content: start;
}

.projects-draft-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 16px;
  border: 1px solid rgba(212, 163, 95, 0.1);
  border-radius: 8px;
  background: rgba(11, 15, 24, 0.72);
}

.projects-draft-card-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.projects-draft-card-meta,
.projects-draft-card-note {
  margin: 0;
  color: var(--workspace-text-soft);
  font-size: 14px;
  line-height: 20px;
}

.projects-draft-card-note {
  color: var(--workspace-text-muted);
}

.projects-draft-open {
  min-width: 84px;
}

.projects-draft-empty {
  align-self: end;
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 16px 12px 6px;
  text-align: center;
}

.projects-draft-empty-icon {
  font-size: 18px;
  color: var(--workspace-text-soft);
}

.projects-table-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid rgba(212, 163, 95, 0.08);
  color: var(--workspace-text-soft);
  text-align: center;
}

@media (max-width: 1279px) {
  .projects-content-column {
    width: min(100%, 960px);
  }

  .projects-table-head,
  .projects-table-row {
    grid-template-columns: minmax(0, 1fr) 160px 140px 80px 80px;
  }
}

@media (max-width: 819px) {
  .projects-header {
    align-items: center;
    flex-direction: column;
    text-align: center;
  }

  .projects-header-copy {
    justify-items: center;
    text-align: center;
  }

  .projects-header-actions {
    flex-wrap: wrap;
    justify-content: center;
  }

  .projects-table-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 280px) 140px;
    align-items: end;
    justify-content: center;
  }

  .projects-filter-field--wide {
    width: min(100%, 280px);
    max-width: 280px;
  }

  .projects-filter-field--select {
    justify-self: center;
    width: 140px;
  }

  .projects-draft-card {
    grid-template-columns: 1fr;
  }

  .projects-table-head,
  .projects-table-row {
    grid-template-columns: minmax(0, 1.5fr) minmax(120px, 1fr) minmax(96px, 1fr) 80px 80px;
    font-size: 0.85rem;
  }

  .projects-draft-drawer {
    width: min(100vw, 360px);
  }
}

@media (max-width: 479px) {
  .projects-table-toolbar {
    grid-template-columns: 1fr;
  }

  .projects-filter-field--wide {
    width: 100%;
    max-width: none;
  }

  .projects-filter-field--select {
    width: 140px;
  }
}
</style>
