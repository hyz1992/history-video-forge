<script setup lang="ts">
import { computed, onMounted, provide, watch, type Component } from "vue";
import { useRoute } from "vue-router";

import {
  createWorkspaceStore,
  workspaceStoreKey,
  PIPELINE_STEPS,
  type PipelineStep,
} from "../stores/workspace";
import { useProjectStore } from "../stores/project";

import WorkspaceSidebar from "../components/workspace/WorkspaceSidebar.vue";
import WorkspaceHeader from "../components/workspace/WorkspaceHeader.vue";

import TopicPanel from "../components/topic/TopicPanel.vue";
import ScriptPanel from "../components/script/ScriptPanel.vue";
import StoryboardPanel from "../components/storyboard/StoryboardPanel.vue";
import AssetPanel from "../components/asset/AssetPanel.vue";
import ComposePanel from "../components/compose/ComposePanel.vue";
import RenderPanel from "../components/render/RenderPanel.vue";
import PublishPanel from "../components/publish/PublishPanel.vue";

const route = useRoute();
const projectStore = useProjectStore();

// Create and provide workspace store locally
const workspaceStore = createWorkspaceStore();
provide(workspaceStoreKey, workspaceStore);

const panelMap: Record<PipelineStep, Component> = {
  topic: TopicPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  asset: AssetPanel,
  compose: ComposePanel,
  render: RenderPanel,
  publish: PublishPanel,
};

const currentPanel = computed(
  () => panelMap[workspaceStore.currentStepKey()],
);

// Sync projectId from route BEFORE child panels mount, so deep-link
// recovery (e.g. /projects/:id/asset) works on the first render pass.
watch(
  () => route.params.projectId as string | undefined,
  (projectId) => {
    if (!projectId) return;
    if (
      projectStore.state.projectId &&
      projectStore.state.projectId === projectId
    ) {
      return;
    }
    projectStore.syncProject({
      project_id: projectId,
      current_status: projectStore.state.currentStatus || "",
    });
  },
  { immediate: true },
);

watch(
  () => route.params.step as string | undefined,
  (step) => {
    if (step && PIPELINE_STEPS.some((s) => s.key === step)) {
      workspaceStore.setCurrentStepByKey(step as PipelineStep);
    }
  },
  { immediate: true },
);

onMounted(async () => {
  const projectId = route.params.projectId as string;
  if (projectId) {
    // Prefer local data for instant UI, then refresh from backend
    const project = projectStore.state.projects.find(
      (p) => p.project_id === projectId,
    );
    if (project) {
      projectStore.syncProject(project);
    }
    await projectStore.loadProject(projectId);
  }
});
</script>

<template>
  <div class="project-workspace">
    <WorkspaceHeader />
    <div class="workspace-body">
      <WorkspaceSidebar />
      <div class="workspace-content">
        <component :is="currentPanel" :key="workspaceStore.currentStepKey()" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  background: var(--bg-base);
  color: var(--text-body);
}

.workspace-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.workspace-content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  background: var(--bg-base);
}
</style>
