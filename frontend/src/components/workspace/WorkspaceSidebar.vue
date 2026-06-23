<script setup lang="ts">
import { computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  ElMenu,
  ElMenuItem,
  ElTooltip,
} from "element-plus";

import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";
import { useProjectStore } from "../../stores/project";

const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const router = useRouter();
const route = useRoute();

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

const projectStageDesc = computed(() => {
  const step = PIPELINE_STEPS[currentStepIndex.value];
  return `${step.label}阶段 · 系统推荐`;
});

const stepEmoji: Record<string, string> = {
  topic: "🎯",
  script: "📝",
  storyboard: "🎬",
  asset: "🖼️",
  compose: "🎞️",
  render: "🎥",
  publish: "🚀",
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
  if (status === "render_ready") return 6;
  if (status.startsWith("render")) return 5;
  return 0;
}

function isStepCompleted(stepIndex: number): boolean {
  // Publish step completion is driven by active_publish_package.readiness,
  // not by pipeline currentStatus (design: publish adds no new status value).
  if (PIPELINE_STEPS[stepIndex]?.key === "publish") {
    return projectStore.state.publishIsReady;
  }
  return stepIndex < getReachedStepIndex();
}

function handleStepClick(index: number) {
  // Only allow navigation to the current or previously reached steps
  const maxReachable = getReachedStepIndex();
  if (index > maxReachable) return;
  workspaceStore.setCurrentStep(index);
  const step = PIPELINE_STEPS[index];
  if (step) {
    router.push(`/projects/${route.params.projectId}/${step.key}`);
  }
}

function goBack() {
  router.push("/projects");
}
</script>

<template>
  <aside class="workspace-sidebar" :class="{ collapsed }">
    <!-- Project info card -->
    <div v-if="!collapsed" class="project-mini">
      <div class="project-mini-label">当前项目</div>
      <div class="project-mini-title">
        <strong>{{ projectName }}</strong>
        <span>{{ projectStageDesc }}</span>
      </div>
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
            :class="{ done: isStepCompleted(step.index) }"
          >
            <span class="step-emoji">{{ stepEmoji[step.key] }}</span>
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
          :class="{ done: isStepCompleted(step.index) }"
        >
          <span class="step-emoji">{{ stepEmoji[step.key] }}</span>
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
  background:
    linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.006)),
    rgba(18, 15, 13, .88);
  border-right: 1px solid rgba(201, 162, 39, 0.13);
  transition: width 0.2s ease;
  overflow: hidden;
  flex-shrink: 0;
}

.workspace-sidebar.collapsed {
  width: var(--sidebar-collapsed-width);
}

.sidebar-menu {
  flex: 1;
  border-right: none;
  background: transparent;
  --el-menu-bg-color: transparent;
  --el-menu-hover-bg-color: rgba(201, 162, 39, 0.06);
  --el-menu-active-color: #e4c26f;
  --el-menu-text-color: #a89f94;
  --el-menu-item-height: 50px;
  padding: 12px 10px;
}

.sidebar-menu:not(.el-menu--collapse) {
  width: var(--sidebar-expanded-width);
}

.step-menu-item {
  position: relative;
  min-height: 50px;
  padding: 11px 12px !important;
  border-radius: 12px;
  gap: 12px;
  color: #a89f94 !important;
  background-color: transparent !important;
  transition: background 180ms ease, color 180ms ease, border-color 180ms ease;
}

.step-menu-item:hover:not(.is-disabled) {
  background: rgba(201, 162, 39, 0.075) !important;
  color: #f5f0e8 !important;
  border-radius: 12px;
}

.step-menu-item.is-active {
  color: #e4c26f !important;
  background: rgba(201, 162, 39, 0.10) !important;
  box-shadow: inset 0 0 0 1px rgba(201, 162, 39, 0.18);
  border-radius: 12px;
}

.step-menu-item.is-disabled {
  opacity: 0.43;
  cursor: not-allowed;
  color: #a89f94 !important;
  background-color: transparent !important;
}

.step-emoji {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  font-size: 17px;
  background: rgba(201, 162, 39, 0.055);
  border: 1px solid rgba(201, 162, 39, 0.12);
  filter: grayscale(.15);
  line-height: 1;
}

.step-menu-item.done .step-emoji {
  background: rgba(101, 167, 122, 0.13);
  border-color: rgba(101, 167, 122, 0.22);
  filter: none;
}

.step-menu-item.is-active .step-emoji {
  background: rgba(201, 162, 39, 0.13);
  border-color: rgba(201, 162, 39, 0.24);
  filter: none;
}

.step-label {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.step-check {
  color: #65a77a;
  font-size: 12px;
  font-weight: 700;
}

.project-mini {
  padding: 14px 12px 12px;
  border-bottom: 1px solid rgba(201, 162, 39, 0.10);
}

.project-mini-label {
  font-size: 11px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.project-mini-title {
  padding: 10px 12px;
  border: 1px solid rgba(201, 162, 39, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.018);
}

.project-mini-title strong {
  display: block;
  color: var(--text-heading);
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 4px;
}

.project-mini-title span {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
