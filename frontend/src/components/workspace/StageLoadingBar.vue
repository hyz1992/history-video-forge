<script setup lang="ts">
defineProps<{
  visible: boolean;
  text?: string;
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="stage-loading-bar">
      <span class="stage-loading-dot" />
      <span class="stage-loading-text">{{ text || "处理中…" }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.stage-loading-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1100;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(20, 24, 36, 0.85);
  backdrop-filter: blur(4px);
}

.stage-loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d4a35f;
  animation: stage-loading-blink 1s ease-in-out infinite;
}

@keyframes stage-loading-blink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.stage-loading-text {
  font-size: 12px;
  color: #a89f94;
  letter-spacing: 0.04em;
}
</style>
