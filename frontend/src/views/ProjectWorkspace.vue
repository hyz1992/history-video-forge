<script setup lang="ts">
import { computed, onMounted, provide, type Component } from "vue";
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
import WorkspaceFooter from "../components/workspace/WorkspaceFooter.vue";

import TopicPanel from "../components/topic/TopicPanel.vue";
import ScriptPanel from "../components/script/ScriptPanel.vue";
import StoryboardPanel from "../components/storyboard/StoryboardPanel.vue";
import AssetPlanningPanel from "../components/asset-planning/AssetPlanningPanel.vue";
import AssetPanel from "../components/asset/AssetPanel.vue";
import ComposePanel from "../components/compose/ComposePanel.vue";

const route = useRoute();
const projectStore = useProjectStore();

// Create and provide workspace store locally
const workspaceStore = createWorkspaceStore();
provide(workspaceStoreKey, workspaceStore);

const panelMap: Record<PipelineStep, Component> = {
  topic: TopicPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  "asset-planning": AssetPlanningPanel,
  asset: AssetPanel,
  compose: ComposePanel,
};

const currentPanel = computed(
  () => panelMap[workspaceStore.currentStepKey()],
);

onMounted(() => {
  const projectId = route.params.projectId as string;
  if (projectId) {
    // Look up the project from the loaded list to get its current_status
    const project = projectStore.state.projects.find(
      (p) => p.project_id === projectId,
    );
    projectStore.syncProject(
      project ?? {
        project_id: projectId,
        current_status: projectStore.state.currentStatus,
      },
    );
  }
});
</script>

<template>
  <div class="project-workspace">
    <WorkspaceSidebar />
    <div class="workspace-main">
      <WorkspaceHeader />
      <div class="workspace-content">
          <component :is="currentPanel" :key="workspaceStore.currentStepKey()" />
      </div>
      <WorkspaceFooter />
    </div>
  </div>
</template>

<style scoped>
.project-workspace {
  display: flex;
  width: 100%;
  height: 100vh;
  background: var(--bg-base);
  color: var(--text-body);
}

.workspace-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.workspace-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-base);
}
</style>
