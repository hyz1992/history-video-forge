<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";

import {
  useProjectStore,
  type ProjectListItem,
} from "../stores/project";

const projectStore = useProjectStore();
const router = useRouter();

const formalProjects = computed(() =>
  projectStore.state.projects.filter((project) => !project.is_draft),
);
const draftProjects = computed(() =>
  projectStore.state.projects.filter((project) => project.is_draft),
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

    <section data-testid="formal-projects" class="project-group">
      <header>
        <h2>正式项目</h2>
      </header>

      <p v-if="formalProjects.length === 0">暂无正式项目</p>

      <article
        v-for="project in formalProjects"
        :key="project.project_id"
        class="project-card"
      >
        <h3>{{ project.display_name }}</h3>
        <p>当前状态：{{ project.current_status }}</p>
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
      </header>

      <p v-if="draftProjects.length === 0">暂无草稿项目</p>

      <article
        v-for="project in draftProjects"
        :key="project.project_id"
        class="project-card"
      >
        <h3>{{ project.display_name }}</h3>
        <p>当前状态：{{ project.current_status }}</p>
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

.projects-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.project-card {
  border: 1px solid #d7ccc8;
  padding: 1rem;
}
</style>
