<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  title: string;
  hint: string;
  secondaryHint?: string;
}>();

const elapsedSeconds = ref(0);
let timer: ReturnType<typeof window.setInterval> | null = null;

const dots = computed(() => ".".repeat((elapsedSeconds.value % 3) + 1));

const titleText = computed(
  () => `${props.title}${dots.value}（${elapsedSeconds.value}秒）`,
);

onMounted(() => {
  timer = window.setInterval(() => {
    elapsedSeconds.value += 1;
  }, 1000);
});

onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
});
</script>

<template>
  <section class="stage-generating" aria-live="polite">
    <p class="stage-generating-title">{{ titleText }}</p>
    <p class="stage-generating-hint">{{ hint }}</p>
    <p v-if="secondaryHint" class="stage-generating-hint">{{ secondaryHint }}</p>
    <slot name="action" />
  </section>
</template>

<style scoped>
.stage-generating {
  display: flex;
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-xl) var(--space-md);
  color: var(--text-secondary);
  text-align: center;
}

.stage-generating-title {
  margin: 0;
  color: var(--text-body);
  font-size: 1rem;
  font-weight: var(--font-subheading);
}

.stage-generating-hint {
  max-width: 560px;
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.7;
}
</style>
