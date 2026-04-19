<script setup lang="ts">
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
  <section class="script-status-panel">
    <p data-testid="script-status">当前状态：{{ currentStatus }}</p>
    <p v-if="isLoading">正在加载脚本快照...</p>
    <p v-else-if="executionState">
      patch_used={{ executionState.patch_used }} / regenerate_used={{ executionState.regenerate_used }}
    </p>
  </section>
</template>
