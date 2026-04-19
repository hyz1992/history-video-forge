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
    <h2>脚本草稿</h2>
    <p><strong>开头：</strong>{{ activeScript.opening_span }}</p>
    <article data-testid="script-text">{{ activeScript.script_text }}</article>
    <p><strong>结尾：</strong>{{ activeScript.ending_span }}</p>
  </section>
</template>
