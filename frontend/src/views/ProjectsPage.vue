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
</script>

<template>
  <section class="projects-page workspace-shell">
    <header class="projects-header workspace-panel workspace-panel--strong">
      <div>
        <p class="projects-kicker">Projects Dashboard</p>
        <h1 data-testid="projects-heading">我的项目</h1>
        <p>正式项目与草稿项目分区展示，直接回到当前最需要处理的工作区。</p>
      </div>

      <button data-testid="create-project" class="btn btn-primary" type="button" @click="handleCreateProject">
        新建项目
      </button>
    </header>

    <section data-testid="projects-toolbar" class="projects-toolbar workspace-panel">
      <label class="projects-search-panel">
        <span>搜索项目</span>
        <input
          data-testid="projects-search"
          v-model="searchQuery"
          type="search"
          placeholder="搜索项目名或主题"
        >
      </label>

      <div class="projects-toolbar-summary">
        <span class="workspace-badge">正式项目 {{ formalProjects.length }}</span>
        <span class="workspace-badge">草稿项目 {{ draftProjects.length }}</span>
      </div>
    </section>

    <div data-testid="projects-dashboard-shell" class="projects-dashboard-shell">
      <section data-testid="formal-projects" class="project-group workspace-panel workspace-panel--strong">
        <header class="project-group-header">
          <div>
            <h2>正式项目</h2>
            <p>已确认主题并具备当前文案工作区入口。</p>
          </div>
        </header>

        <p
          v-if="formalProjects.length === 0"
          data-testid="formal-projects-empty"
          class="project-group-empty"
        >
          暂无正式项目
        </p>

        <div v-else data-testid="projects-formal-grid" class="project-grid">
          <article
            v-for="project in formalProjects"
            :key="project.project_id"
            :data-testid="`project-card-${project.project_id}`"
            class="project-card workspace-panel"
          >
            <div class="project-card-meta">
              <span class="workspace-badge">Script Ready</span>
              <span class="project-card-status">当前状态：{{ project.current_status }}</span>
            </div>
            <h3>{{ project.display_name }}</h3>
            <p class="project-card-summary">继续文案，并保留现有 trace 与历史版本。</p>
            <button
              :data-testid="`open-project-${project.project_id}`"
              class="btn btn-primary"
              type="button"
              @click="openProject(project)"
            >
              进入文案工作区
            </button>
          </article>
        </div>
      </section>

      <section data-testid="draft-projects" class="project-group workspace-panel">
        <header class="project-group-header">
          <div>
            <h2>草稿项目 / 未完成项目</h2>
            <p>尚未确认正式主题，继续回到选题工作区。</p>
          </div>
        </header>

        <p
          v-if="draftProjects.length === 0"
          data-testid="draft-projects-empty"
          class="project-group-empty"
        >
          暂无草稿项目
        </p>

        <div v-else data-testid="projects-draft-grid" class="project-grid">
          <article
            v-for="project in draftProjects"
            :key="project.project_id"
            :data-testid="`project-card-${project.project_id}`"
            class="project-card workspace-panel"
          >
            <div class="project-card-meta">
              <span class="workspace-badge">Topic Pending</span>
              <span class="project-card-status">当前状态：{{ project.current_status }}</span>
            </div>
            <h3>{{ project.display_name }}</h3>
            <p class="project-card-summary">继续选题，并保留多轮候选历史。</p>
            <button
              :data-testid="`open-project-${project.project_id}`"
              class="btn btn-secondary"
              type="button"
              @click="openProject(project)"
            >
              进入选题工作区
            </button>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.projects-page,
.project-group,
.projects-dashboard-shell {
  display: grid;
  gap: 1rem;
}

.projects-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.5rem;
}

.projects-kicker {
  margin: 0 0 0.5rem;
  color: var(--workspace-accent);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 0.82rem;
}

.projects-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: end;
  padding: 1rem 1.25rem;
}

.projects-search-panel {
  display: grid;
  gap: 0.5rem;
}

.projects-search-panel input {
  max-width: 24rem;
  padding: 0.75rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(8, 12, 21, 0.72);
  color: var(--workspace-text);
}

.projects-toolbar-summary {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 1rem;
}

.projects-dashboard-shell {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.project-group {
  padding: 1.25rem;
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
}

.project-grid {
  display: grid;
  gap: 1rem;
}

.project-card {
  padding: 1rem;
  transition:
    transform 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.project-card:hover {
  transform: translateY(-2px);
  border-color: var(--workspace-border-strong);
}

.project-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.project-card-status {
  color: var(--workspace-text-muted);
  font-size: 0.92rem;
}

.project-card-summary {
  color: var(--workspace-text-muted);
  line-height: 1.6;
}

@media (max-width: 900px) {
  .projects-dashboard-shell {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .projects-header,
  .projects-toolbar {
    grid-template-columns: 1fr;
    display: grid;
  }

  .projects-toolbar-summary {
    justify-content: flex-start;
  }
}
</style>
