<script setup lang="ts">
import { computed } from "vue";
import {
  ElMenu,
  ElMenuItem,
  ElButton,
  ElIcon,
  ElTooltip,
} from "element-plus";
import {
  Edit,
  Document,
  Film,
  Box,
  VideoCameraFilled,
  Download,
  Fold,
  Expand,
} from "@element-plus/icons-vue";

import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";
import { useProjectStore } from "../../stores/project";

const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();

const collapsed = computed(() => workspaceStore.state.value.sidebarCollapsed);
const currentStepIndex = computed(
  () => workspaceStore.state.value.currentStepIndex,
);

const projectName = computed(() => {
  const id = projectStore.state.projectId;
  const project = projectStore.state.projects.find(
    (p) => p.project_id === id,
  );
  return project?.display_name ?? "未命名项目";
});

const sidebarWidth = computed(() =>
  collapsed.value
    ? "var(--sidebar-collapsed-width)"
    : "var(--sidebar-expanded-width)",
);

const stepIcons: Record<string, any> = {
  topic: Edit,
  script: Document,
  storyboard: Film,
  asset: Box,
  compose: VideoCameraFilled,
  render: Download,
};

/**
 * Map project currentStatus to the pipeline step index that is "reached".
 * Steps with index < reachedIndex are considered completed.
 */
function getReachedStepIndex(): number {
  const status = projectStore.state.currentStatus;
  if (!status) return 0;
  if (status.startsWith("topic")) return 0;
  if (status.startsWith("script")) return 1;
  if (status.startsWith("storyboard")) return 2;
  if (status.startsWith("asset_plan") || status.startsWith("asset")) return 3;
  if (status.startsWith("compose")) return 4;
  if (status.startsWith("render")) return 5;
  return 0;
}

function isStepCompleted(stepIndex: number): boolean {
  return stepIndex < getReachedStepIndex();
}

function handleStepClick(index: number) {
  // Only allow navigation to the current or previously reached steps
  const maxReachable = getReachedStepIndex();
  if (index > maxReachable) return;
  workspaceStore.setCurrentStep(index);
}

function goBack() {
  router.push("/projects");
}
</script>

<template>
  <aside class="workspace-sidebar" :class="{ collapsed }">
    <!-- Header -->
    <div class="sidebar-header">
      <span v-if="!collapsed" class="sidebar-title">{{ projectName }}</span>
      <ElButton
        class="collapse-btn"
        :icon="collapsed ? Expand : Fold"
        text
        @click="workspaceStore.toggleSidebar()"
      />
    </div>

    <!-- Step Menu -->
    <ElMenu
      :default-active="String(currentStepIndex)"
      :collapse="collapsed"
      :collapse-transition="false"
      class="sidebar-menu"
      @select="(index: string) => handleStepClick(Number(index))"
    >
      <template v-for="step in PIPELINE_STEPS" :key="step.key">
        <ElTooltip
          v-if="collapsed"
          :content="step.label"
          placement="right"
          :show-after="300"
        >
          <ElMenuItem
            :index="String(step.index)"
            :disabled="step.index > getReachedStepIndex()"
            class="step-menu-item"
          >
            <ElIcon class="step-icon">
              <component :is="stepIcons[step.key]" />
            </ElIcon>
            <template #title>
              <span class="step-label">
                {{ step.label }}
                <span v-if="isStepCompleted(step.index)" class="step-check">
                  &#10003;
                </span>
              </span>
            </template>
          </ElMenuItem>
        </ElTooltip>
        <ElMenuItem
          v-else
          :index="String(step.index)"
          :disabled="step.index > getReachedStepIndex()"
          class="step-menu-item"
        >
          <ElIcon class="step-icon">
            <component :is="stepIcons[step.key]" />
          </ElIcon>
          <template #title>
            <span class="step-label">
              {{ step.label }}
              <span v-if="isStepCompleted(step.index)" class="step-check">
                &#10003;
              </span>
            </span>
          </template>
        </ElMenuItem>
      </template>
    </ElMenu>
  </aside>
</template>

<style scoped>
.workspace-sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-expanded-width);
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-default);
  transition: width 0.2s ease;
  overflow: hidden;
  flex-shrink: 0;
}

.workspace-sidebar.collapsed {
  width: var(--sidebar-collapsed-width);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--border-default);
  min-height: 48px;
}

.sidebar-title {
  font-size: 14px;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  margin-right: 4px;
}

.collapse-btn {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.collapse-btn:hover {
  color: var(--accent-text);
}

.sidebar-menu {
  flex: 1;
  border-right: none;
  background: transparent;
  --el-menu-bg-color: transparent;
  --el-menu-hover-bg-color: var(--bg-hover);
  --el-menu-active-color: var(--accent-text);
  --el-menu-text-color: var(--text-body);
  --el-menu-item-height: 44px;
}

.sidebar-menu:not(.el-menu--collapse) {
  width: var(--sidebar-expanded-width);
}

.step-menu-item {
  position: relative;
}

.step-icon {
  font-size: 18px;
}

.step-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.step-check {
  color: var(--color-success);
  font-size: 12px;
  font-weight: 700;
}

/* Disabled menu items - greyed out, no pointer */
.step-menu-item.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
