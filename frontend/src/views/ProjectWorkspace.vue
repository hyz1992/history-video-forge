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
import { useAuthStore } from "../stores/auth";

import WorkspaceSidebar from "../components/workspace/WorkspaceSidebar.vue";
import WorkspaceHeader from "../components/workspace/WorkspaceHeader.vue";

import TopicPanel from "../components/topic/TopicPanel.vue";
import ScriptPanel from "../components/script/ScriptPanel.vue";
import StoryboardPanel from "../components/storyboard/StoryboardPanel.vue";
import AssetPanel from "../components/asset/AssetPanel.vue";
import ComposeRenderPanel from "../components/compose/ComposeRenderPanel.vue";
import PublishPanel from "../components/publish/PublishPanel.vue";

const route = useRoute();
const projectStore = useProjectStore();
const authStore = useAuthStore();

const isAdminDeputizing = computed(() => {
  if (authStore.state.user?.role !== "ADMIN") return false;
  const ownerId = projectStore.state.projectOwnerId;
  if (!ownerId) return false;
  return ownerId !== authStore.state.user?.id;
});

// Create and provide workspace store locally
const workspaceStore = createWorkspaceStore();
provide(workspaceStoreKey, workspaceStore);

const panelMap: Record<PipelineStep, Component> = {
  topic: TopicPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  asset: AssetPanel,
  "compose-render": ComposeRenderPanel,
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
    <div v-if="isAdminDeputizing" class="deputize-banner" data-testid="deputize-banner">
      <span class="deputize-icon">&#9888;</span>
      <span>正在以管理员身份查看其他用户的项目，请谨慎操作，操作将记录在审计日志。</span>
    </div>
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
  background:
    radial-gradient(ellipse at 18% 16%, rgba(184, 115, 51, 0.16) 0%, transparent 44%),
    radial-gradient(ellipse at 84% 20%, rgba(201, 162, 39, 0.11) 0%, transparent 42%),
    linear-gradient(180deg, #0b0b0a 0%, #0d0d0d 38%, #130f0d 100%);
  color: #d8cec0;
  position: relative;
}

.project-workspace::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: .12;
  background-image:
    linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(circle at 50% 0%, black 0%, transparent 82%);
  z-index: 0;
}

.workspace-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-height: 0;
}

.deputize-banner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 32px;
  background: rgba(201, 162, 39, 0.12);
  border-bottom: 1px solid rgba(201, 162, 39, 0.25);
  color: #e8c84a;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}

.deputize-icon {
  font-size: 16px;
}

.workspace-content {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  scroll-behavior: smooth;
}
</style>
