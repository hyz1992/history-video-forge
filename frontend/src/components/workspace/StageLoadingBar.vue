<script setup lang="ts">
defineProps<{
  visible: boolean;
  text?: string;
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="stage-loading-bar">
      <span class="stage-loading-spinner" />
      <span class="stage-loading-text">{{ text || "处理中…" }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.stage-loading-bar {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 20px;
  border-radius: 100px;
  background: rgba(12, 10, 8, 0.92);
  border: 1px solid rgba(201, 162, 39, 0.18);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.stage-loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(201, 162, 39, 0.2);
  border-top-color: #c9a227;
  border-radius: 50%;
  animation: stage-spin 0.7s linear infinite;
}

@keyframes stage-spin {
  to { transform: rotate(360deg); }
}

.stage-loading-text {
  font-size: 12px;
  color: #d4a35f;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
</style>
