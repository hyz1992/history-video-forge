<script setup lang="ts">
import { computed } from "vue";
import { ElBreadcrumb, ElBreadcrumbItem } from "element-plus";

import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";
import ThemeToggle from "./ThemeToggle.vue";

const workspaceStore = useWorkspaceStore();

const currentStepLabel = computed(
  () => PIPELINE_STEPS[workspaceStore.state.value.currentStepIndex].label,
);
</script>

<template>
  <header class="workspace-header">
    <div class="header-left">
      <ElBreadcrumb separator="/">
        <ElBreadcrumbItem>项目</ElBreadcrumbItem>
        <ElBreadcrumbItem>{{ currentStepLabel }}</ElBreadcrumbItem>
      </ElBreadcrumb>
    </div>
    <div class="header-right">
      <slot name="actions" />
      <ThemeToggle />
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
