<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import {
  useProjectStore,
  type ProjectListItem,
} from "../stores/project";

const projectStore = useProjectStore();
const router = useRouter();
const searchQuery = ref("");

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase());

const visibleProjects = computed(() =>
  projectStore.state.projects.filter((project) => {
    if (!normalizedSearchQuery.value) {
      return true;
    }

    return project.display_name.toLowerCase().includes(normalizedSearchQuery.value);
  }),
);

const formalProjects = computed(() =>
  visibleProjects.value.filter((project) => !project.is_draft),
);
const draftProjects = computed(() =>
  visibleProjects.value.filter((project) => project.is_draft),
);

onMounted(async () => {
  await projectStore.loadProjects();
});

async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status));
}

async function openProject(project: ProjectListItem) {
  projectStore.syncProject(project);
  await router.push(projectStore.resolveProjectWorkspacePath(project.project_id, project.current_status));
}

function formatUpdatedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <section class="projects-page workspace-shell">
    <header class="projects-header">
      <div class="projects-header-copy">
        <h1 data-testid="projects-heading">我的项目</h1>
        <p class="projects-summary">
          正式项目直接回到文案工作区，草稿项目继续补齐选题。这个页面只做一件事：把你送回当前该处理的项目。
        </p>
      </div>

      <button
        data-testid="create-project"
        class="btn btn-primary btn-lg projects-create-button"
        type="button"
        @click="handleCreateProject"
      >
        新建项目
      </button>
    </header>

    <section data-testid="projects-toolbar" class="projects-overview workspace-panel workspace-panel--strong">
      <div data-testid="projects-overview-strip" class="projects-overview-strip">
        <label class="projects-search-panel">
          <span class="projects-panel-label">搜索项目</span>
          <input
            data-testid="projects-search"
            v-model="searchQuery"
            type="search"
            placeholder="搜索项目名或主题"
          >
        </label>

        <div class="projects-overview-stats" aria-label="项目概览">
          <article class="projects-stat-card">
            <span class="projects-panel-label">正式项目</span>
            <strong>{{ formalProjects.length }}</strong>
            <p>已确认主题，可直接进入文案工作区。</p>
          </article>
          <article class="projects-stat-card">
            <span class="projects-panel-label">草稿项目</span>
            <strong>{{ draftProjects.length }}</strong>
            <p>主题尚未定稿，继续留在 Topic 工作区。</p>
          </article>
        </div>

        <aside class="projects-overview-note">
          <span class="workspace-badge">Topic + Script</span>
          <p>当前页面只服务于第一阶段工作流，不引入下游阶段入口。</p>
        </aside>
      </div>
    </section>

    <div data-testid="projects-dashboard-shell" class="projects-dashboard-shell">
      <div data-testid="projects-main-stage" class="projects-main-stage">
        <section data-testid="formal-projects" class="project-group project-group--formal workspace-panel workspace-panel--strong">
          <header class="project-group-header">
            <div>
              <h2>正式项目</h2>
              <p>已确认主题并具备当前文案工作区入口。</p>
            </div>
            <span class="workspace-badge">优先返回 Script</span>
          </header>

          <p
            v-if="formalProjects.length === 0"
            data-testid="formal-projects-empty"
            class="project-group-empty"
          >
            暂无正式项目
          </p>

          <div
            v-else
            data-testid="projects-formal-list"
            class="project-list project-list--formal"
          >
            <div data-testid="projects-formal-grid" class="project-list-track">
              <article
                v-for="project in formalProjects"
                :key="project.project_id"
                :data-testid="`project-card-${project.project_id}`"
                class="project-card project-card--formal"
              >
                <div class="project-card-head">
                  <div class="project-card-title-block">
                    <span class="project-card-kicker">Script Ready</span>
                    <h3>{{ project.display_name }}</h3>
                  </div>
                  <span class="project-card-date">更新于 {{ formatUpdatedAt(project.updated_at) }}</span>
                </div>

                <p class="project-card-summary">继续文案工作区，并保留现有 trace 与历史版本。</p>

                <div class="project-card-footer">
                  <div class="project-card-status-line">
                    <span class="workspace-badge">正式项目</span>
                    <span class="project-card-status">当前状态：{{ project.current_status }}</span>
                  </div>
                  <button
                    :data-testid="`open-project-${project.project_id}`"
                    class="btn btn-primary"
                    type="button"
                    @click="openProject(project)"
                  >
                    继续文案工作区
                  </button>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section data-testid="draft-projects" class="project-group project-group--draft workspace-panel">
          <header class="project-group-header">
            <div>
              <h2>草稿项目 / 未完成项目</h2>
              <p>尚未确认正式主题，继续回到选题工作区。</p>
            </div>
            <span class="workspace-badge">待完成 Topic</span>
          </header>

          <p
            v-if="draftProjects.length === 0"
            data-testid="draft-projects-empty"
            class="project-group-empty"
          >
            暂无草稿项目
          </p>

          <div
            v-else
            data-testid="projects-draft-list"
            class="project-list project-list--draft"
          >
            <div data-testid="projects-draft-grid" class="project-list-track">
              <article
                v-for="project in draftProjects"
                :key="project.project_id"
                :data-testid="`project-card-${project.project_id}`"
                class="project-card project-card--draft"
              >
                <div class="project-card-head">
                  <div class="project-card-title-block">
                    <span class="project-card-kicker">Topic Pending</span>
                    <h3>{{ project.display_name }}</h3>
                  </div>
                  <span class="project-card-date">更新于 {{ formatUpdatedAt(project.updated_at) }}</span>
                </div>

                <p class="project-card-summary">继续选题工作区，并保留多轮候选历史。</p>

                <div class="project-card-footer">
                  <div class="project-card-status-line">
                    <span class="workspace-badge">草稿项目</span>
                    <span class="project-card-status">当前状态：{{ project.current_status }}</span>
                  </div>
                  <button
                    :data-testid="`open-project-${project.project_id}`"
                    class="btn btn-secondary"
                    type="button"
                    @click="openProject(project)"
                  >
                    继续选题工作区
                  </button>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.projects-page,
.projects-dashboard-shell,
.projects-main-stage,
.project-list,
.project-list-track,
.project-group {
  display: grid;
  gap: 1rem;
}

.projects-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1.25rem;
}

.projects-header-copy {
  display: grid;
  gap: 0.75rem;
  max-width: 46rem;
}

.projects-header h1,
.project-group h2,
.project-card h3 {
  margin: 0;
}

.projects-header h1 {
  font-size: clamp(2.4rem, 4vw, 3.6rem);
}

.projects-summary {
  margin: 0;
  max-width: 42rem;
  color: var(--workspace-text-muted);
  line-height: 1.75;
}

.projects-create-button {
  flex: 0 0 auto;
}

.projects-overview {
  position: relative;
  overflow: hidden;
  padding: 1.25rem;
}

.projects-overview::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 22%, rgba(212, 163, 95, 0.16), transparent 26%),
    radial-gradient(circle at 82% 18%, rgba(192, 57, 43, 0.16), transparent 22%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.03), transparent 42%);
}

.projects-overview-strip {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(20rem, 0.95fr) minmax(14rem, 0.72fr);
  gap: 1rem;
  align-items: stretch;
}

.projects-search-panel {
  display: grid;
  gap: 0.65rem;
  align-content: center;
}

.projects-panel-label {
  color: var(--workspace-accent);
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.projects-search-panel input {
  width: 100%;
  padding: 0.9rem 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(7, 10, 18, 0.82);
  color: var(--workspace-text);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.projects-overview-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.projects-stat-card,
.projects-overview-note {
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: var(--workspace-radius-md);
  background: rgba(8, 12, 21, 0.54);
  padding: 1rem;
  backdrop-filter: blur(10px);
}

.projects-stat-card {
  display: grid;
  gap: 0.35rem;
}

.projects-stat-card strong {
  font-size: 2rem;
  line-height: 1;
  color: var(--workspace-text);
}

.projects-stat-card p,
.projects-overview-note p,
.project-group-header p {
  margin: 0;
  color: var(--workspace-text-muted);
  line-height: 1.6;
}

.projects-overview-note {
  display: grid;
  gap: 0.8rem;
  align-content: center;
}

.projects-dashboard-shell {
  gap: 0;
}

.projects-main-stage {
  grid-template-columns: minmax(0, 1.35fr) minmax(21rem, 0.85fr);
  align-items: start;
  gap: 1.25rem;
}

.project-group {
  padding: 1.25rem;
  align-content: start;
}

.project-group--formal {
  background:
    linear-gradient(180deg, rgba(31, 41, 63, 0.98), rgba(16, 23, 37, 0.96)),
    var(--workspace-bg-panel-strong);
}

.project-group--draft {
  background:
    linear-gradient(180deg, rgba(18, 25, 39, 0.94), rgba(10, 15, 25, 0.92)),
    var(--workspace-bg-panel);
}

.project-group-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.project-group-empty {
  margin: 0;
  color: var(--workspace-text-muted);
  min-height: 10rem;
  display: grid;
  place-items: center;
  text-align: center;
  border: 1px dashed rgba(212, 163, 95, 0.2);
  border-radius: var(--workspace-radius-md);
  background: rgba(7, 10, 18, 0.32);
}

.project-list-track {
  display: grid;
  gap: 1rem;
}

.project-card {
  padding: 1.1rem 1.15rem;
  border-radius: calc(var(--workspace-radius-md) - 4px);
  border: 1px solid rgba(212, 163, 95, 0.14);
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    background 180ms ease;
}

.project-card--formal {
  background:
    linear-gradient(135deg, rgba(212, 163, 95, 0.08), transparent 38%),
    rgba(10, 14, 23, 0.88);
  border-left: 3px solid rgba(212, 163, 95, 0.55);
}

.project-card--draft {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.03), transparent 36%),
    rgba(7, 11, 18, 0.82);
}

.project-card:hover {
  transform: translateY(-3px);
  border-color: var(--workspace-border-strong);
  box-shadow: var(--workspace-shadow-soft);
}

.project-card-head,
.project-card-footer,
.project-card-status-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.9rem;
  flex-wrap: wrap;
}

.project-card-title-block {
  display: grid;
  gap: 0.35rem;
}

.project-card-kicker {
  color: var(--workspace-accent);
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.project-card-date {
  color: var(--workspace-text-soft);
  font-size: 0.88rem;
  white-space: nowrap;
}

.project-card-status {
  color: var(--workspace-text-muted);
  font-size: 0.92rem;
}

.project-card-summary {
  margin: 0;
  color: var(--workspace-text-muted);
  line-height: 1.6;
}

@media (max-width: 1100px) {
  .projects-overview-strip,
  .projects-main-stage {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .projects-overview-stats {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .projects-header {
    display: grid;
    align-items: start;
  }

  .projects-create-button,
  .project-card-footer .btn {
    width: 100%;
  }
}
</style>
