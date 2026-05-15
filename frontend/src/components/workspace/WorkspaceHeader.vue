<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ElBreadcrumb, ElBreadcrumbItem, ElButton, ElIcon } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";

import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";
import { useProjectStore } from "../../stores/project";

const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const router = useRouter();

const currentStepLabel = computed(
  () => PIPELINE_STEPS[workspaceStore.state.value.currentStepIndex].label,
);

const projectName = computed(() => {
  const id = projectStore.state.projectId;
  const project = projectStore.state.projects.find(
    (p) => p.project_id === id,
  );
  return project?.display_name ?? "未命名项目";
});

function goBack() {
  router.push("/projects");
}
</script>

<template>
  <header class="workspace-header">
    <div class="header-left">
      <ElBreadcrumb separator="/">
        <ElBreadcrumbItem>{{ projectName }}</ElBreadcrumbItem>
        <ElBreadcrumbItem>{{ currentStepLabel }}</ElBreadcrumbItem>
      </ElBreadcrumb>
    </div>
    <div class="header-right">
      <ElButton text @click="goBack">
        <ElIcon><ArrowLeft /></ElIcon>
        <span>返回项目列表</span>
      </ElButton>
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 var(--space-lg);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
</style>
