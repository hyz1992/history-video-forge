<script setup lang="ts">
const statusLabels: Record<string, string> = {
  topic: "选题阶段",
  topic_pending: "选题待确认",
  topic_ready: "选题就绪",
  script_generating: "文案生成中",
  script_ready: "文案就绪",
  script_reviewing: "文案审校中",
  script_failed: "生成失败",
  storyboard_ready: "分镜就绪",
  asset_plan_ready: "素材规划就绪",
};

defineProps<{
  currentStatus: string;
  isLoading: boolean;
  executionState?: {
    patch_used: boolean;
    regenerate_used: boolean;
  } | null;
}>();
</script>

<template>
  <section class="script-status-panel workspace-panel">
    <p data-testid="script-status">
      当前状态：
      <span class="workspace-badge">{{ statusLabels[currentStatus] ?? currentStatus }}</span>
    </p>
    <p v-if="isLoading" class="script-status-loading">正在加载文案快照…</p>
    <p v-else-if="executionState" class="script-status-exec">
      修订：{{ executionState.patch_used ? "已使用" : "未使用" }}　重写：{{ executionState.regenerate_used ? "已使用" : "未使用" }}
    </p>
  </section>
</template>

<style scoped>
.script-status-panel {
  display: grid;
  gap: 0.25rem;
  font-size: 0.95rem;
}

.script-status-loading {
  color: var(--workspace-text-muted);
}

.script-status-exec {
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}
</style>
