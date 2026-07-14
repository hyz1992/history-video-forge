<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";

import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";
import { useProjectStore } from "../../stores/project";
import { useAuthStore } from "../../stores/auth";

const workspaceStore = useWorkspaceStore();
const projectStore = useProjectStore();
const authStore = useAuthStore();
const router = useRouter();

const stepEmojiMap: Record<string, string> = {
  topic: "🎯",
  script: "📝",
  storyboard: "🎬",
  asset: "🖼️",
  "compose-render": "🎞️",
  publish: "🚀",
};

const currentStepLabel = computed(() => {
  const step = PIPELINE_STEPS[workspaceStore.state.value.currentStepIndex];
  const emoji = stepEmojiMap[step.key] ?? "";
  return `${emoji} ${step.label}`;
});

const projectName = computed(() => {
  const id = projectStore.state.projectId;
  const project = projectStore.state.projects.find(
    (p) => p.project_id === id,
  );
  return project?.display_name ?? "未命名项目";
});

function handleHome() {
  router.push("/");
}

function goBack() {
  router.push("/projects");
}
</script>

<template>
  <header class="topbar">
    <a class="brand" @click="handleHome">
      <span class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <path d="M8 12.5C8 10.6 9.6 9 11.5 9h9c1.9 0 3.5 1.6 3.5 3.5v7.2c0 2.2-1.8 4-4 4h-8c-2.2 0-4-1.8-4-4v-7.2Z" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path d="M10 9.2C10.7 6.9 12.9 5.5 16 5.5s5.3 1.4 6 3.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M15 13.1c0-.8.9-1.3 1.6-.9l4.1 2.4c.7.4.7 1.4 0 1.8l-4.1 2.4c-.7.4-1.6-.1-1.6-.9v-4.8Z" fill="currentColor"/>
          <path d="M11.2 14h1.7M11.2 17.5h1.7M19.1 14h1.7M19.1 17.5h1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M16 4v-2M12.2 6.2 10.6 4.5M19.8 6.2l1.6-1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="brand-text">
        <strong>历史短视频工坊</strong>
        <span>History Video Forge</span>
      </span>
    </a>

    <div class="topbar-center">
      <div class="breadcrumb">
        <span class="breadcrumb-project">{{ projectName }}</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">
          <span class="breadcrumb-icon">{{ stepEmojiMap[PIPELINE_STEPS[workspaceStore.state.value.currentStepIndex].key] }}</span>
          {{ PIPELINE_STEPS[workspaceStore.state.value.currentStepIndex].label }}
        </span>
      </div>
    </div>

    <div class="topbar-right">
      <div class="topbar-nav-actions">
        <button class="btn btn-ghost" @click="goBack">
          <svg viewBox="0 0 24 24"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
          返回项目列表
        </button>
        <button
          v-if="authStore.state.user?.role === 'ADMIN'"
          class="btn btn-admin"
          @click="router.push('/admin')"
        >
          管理后台
        </button>
      </div>
      <div class="topbar-divider" aria-hidden="true"></div>
      <div class="account-actions">
        <button class="btn btn-subtle" style="font-weight: 700;">我的</button>
        <button class="btn btn-subtle icon-btn" aria-label="设置" title="设置">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.86.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.04A1.7 1.7 0 0 0 4.6 8a1.7 1.7 0 0 0-.34-1.86l-.04-.04A2 2 0 1 1 7.05 3.27l.04.04A1.7 1.7 0 0 0 8.95 3a1.7 1.7 0 0 0 1.03-1.56V1a2 2 0 1 1 4 0v.44A1.7 1.7 0 0 0 15.01 3a1.7 1.7 0 0 0 1.86-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15Z"/></svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  height: 72px;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  backdrop-filter: blur(18px);
  background: rgba(13, 13, 13, 0.84);
  border-bottom: 1px solid rgba(201, 162, 39, 0.14);
  flex-shrink: 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  text-decoration: none;
}

.brand-mark {
  width: 30px;
  height: 30px;
  color: #c9a227;
  display: grid;
  place-items: center;
  filter: drop-shadow(0 0 12px rgba(201, 162, 39, 0.18));
  flex-shrink: 0;
}

.brand-mark svg {
  width: 30px;
  height: 30px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1.15;
}

.brand-text strong {
  font-family: "Noto Serif SC", "Songti SC", Georgia, serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #f5f0e8;
}

.brand-text span {
  font-family: "Inter", sans-serif;
  font-size: 10px;
  color: #6b635a;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.topbar-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-left: 34px;
  min-width: 0;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar-nav-actions,
.account-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar-divider {
  width: 1px;
  height: 22px;
  background: #3d3632;
  opacity: .85;
}

.btn {
  height: 38px;
  padding: 0 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  border: none;
  font-family: inherit;
  transition: transform 180ms ease, background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, color 180ms ease;
  white-space: nowrap;
}

.btn:hover {
  transform: translateY(-1px);
}

.btn-ghost {
  background: rgba(255,255,255,.018);
  border: 1px solid rgba(201, 162, 39, 0.13);
  color: #a89f94;
}

.btn-ghost:hover {
  color: #f5f0e8;
  border-color: rgba(201,162,39,.30);
  background: rgba(201,162,39,.065);
}

.btn-admin {
  background: rgba(201,162,39,.10);
  border: 1px solid rgba(201,162,39,.30);
  color: #c9a227;
}

.btn-admin:hover {
  background: rgba(201,162,39,.18);
  border-color: #c9a227;
  color: #f5f0e8;
}

.btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}

.btn-subtle {
  height: 36px;
  padding: 0 15px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid rgba(201, 162, 39, 0.14);
  background: rgba(255,255,255,0.018);
  color: #a89f94;
}

.btn-subtle:hover {
  color: #f5f0e8;
  border-color: rgba(201, 162, 39, 0.30);
  background: rgba(201, 162, 39, 0.07);
}

.icon-btn {
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 12px;
  display: inline-grid;
  place-items: center;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
}

/* Breadcrumb */
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #6b635a;
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
}

.breadcrumb-sep {
  color: #6b635a;
}

.breadcrumb-project {
  color: #f5f0e8;
  font-weight: 750;
}

.breadcrumb-current {
  color: #f5f0e8;
  font-weight: 750;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.breadcrumb-icon {
  font-size: 17px;
  line-height: 1;
}
</style>
