<script setup lang="ts">
defineProps<{
  activeScript: {
    script_text: string;
    opening_span: string;
    ending_span: string;
  };
}>();
</script>

<template>
  <section class="script-draft-panel">
    <h2>文案内容</h2>
    <p class="draft-span"><strong>开头：</strong>{{ activeScript.opening_span }}</p>
    <article data-testid="script-text" class="draft-text">{{ activeScript.script_text }}</article>
    <p class="draft-span"><strong>结尾：</strong>{{ activeScript.ending_span }}</p>
  </section>
</template>

<style scoped>
.script-draft-panel {
  display: grid;
  gap: 0.5rem;
}

.draft-text {
  white-space: pre-wrap;
  line-height: 1.75;
  color: var(--workspace-text);
}

.draft-span {
  color: var(--workspace-text-muted);
  font-size: 0.92rem;
}
</style>
