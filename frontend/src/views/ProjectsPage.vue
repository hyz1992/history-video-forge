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
  <section class="projects-page">
    <header class="projects-header">
      <div>
        <h1 data-testid="projects-heading">我的项目</h1>
        <p>正式项目直接进入文案工作区，草稿项目继续停留在选题工作区。</p>
      </div>

      <button data-testid="create-project" type="button" @click="handleCreateProject">
        新建项目
      </button>
    </header>

    <label class="projects-search-panel">
      <span>搜索项目</span>
      <input
        data-testid="projects-search"
        v-model="searchQuery"
        type="search"
        placeholder="搜索项目名或主题"
      >
    </label>

    <section data-testid="formal-projects" class="project-group">
      <header>
        <h2>正式项目</h2>
        <p>已确认主题并具备当前文案工作区入口。</p>
      </header>

      <p v-if="formalProjects.length === 0">暂无正式项目</p>

      <article
        v-for="project in formalProjects"
        :key="project.project_id"
        :data-testid="`project-card-${project.project_id}`"
        class="project-card"
      >
        <h3>{{ project.display_name }}</h3>
        <p>当前状态：{{ project.current_status }}</p>
        <p class="project-card-summary">继续文案，并保留现有 trace 与历史版本。</p>
        <button
          :data-testid="`open-project-${project.project_id}`"
          type="button"
          @click="openProject(project)"
        >
          进入文案工作区
        </button>
      </article>
    </section>

    <section data-testid="draft-projects" class="project-group">
      <header>
        <h2>草稿项目 / 未完成项目</h2>
        <p>尚未确认正式主题，继续回到选题工作区。</p>
      </header>

      <p v-if="draftProjects.length === 0">暂无草稿项目</p>

      <article
        v-for="project in draftProjects"
        :key="project.project_id"
        :data-testid="`project-card-${project.project_id}`"
        class="project-card"
      >
        <h3>{{ project.display_name }}</h3>
        <p>当前状态：{{ project.current_status }}</p>
        <p class="project-card-summary">继续选题，并保留多轮候选历史。</p>
        <button
          :data-testid="`open-project-${project.project_id}`"
          type="button"
          @click="openProject(project)"
        >
          进入选题工作区
        </button>
      </article>
    </section>
  </section>
</template>

<style scoped>
.projects-page,
.project-group {
  display: grid;
  gap: 1rem;
}

.projects-search-panel {
  display: grid;
  gap: 0.5rem;
}

.projects-search-panel input {
  max-width: 22rem;
  padding: 0.75rem;
  border: 1px solid #d7ccc8;
}

.projects-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.project-card {
  border: 1px solid #d7ccc8;
  padding: 1rem;
  background: #fffaf5;
}

.project-card-summary {
  color: #6d4c41;
}
</style>
