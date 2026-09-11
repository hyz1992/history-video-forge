<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import type { NarrationStore } from "../../stores/narration";

const props = defineProps<{ store: NarrationStore }>();
const emit = defineEmits<{ (e: "open"): void }>();

const s = computed(() => props.store.state);
const d = computed(() => s.value.detail);
const status = computed(() => d.value?.effective_status ?? "empty");
const sourceGenerating = computed(() => s.value.snapshot?.latest_narration_candidate?.effective_status === "generating");
const polling = computed(() => status.value === "generating" || sourceGenerating.value);

const labels: Record<string, string> = {
  empty: "尚未生成口播",
  generating: "口播生成中",
  ready: "口播已生成，可试听确认",
  confirmed: "口播已确认",
  failed: "口播生成失败",
  cancelled: "口播已取消",
  unknown: "供应商结果未知，请先核对费用",
  stale: "口播已过期，请重新生成",
};

const openLabel = computed(() => {
  switch (status.value) {
    case "generating":
      return "生成中…";
    case "ready":
      return "试听口播";
    case "confirmed":
      return "查看口播";
    default:
      return "生成口播";
  }
});

// 生成中保持轮询，让入口状态随后台任务自动收敛；组件卸载即停。
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
async function tick() {
  if (disposed) return;
  await props.store.refresh();
  if (!disposed && polling.value) timer = setTimeout(tick, 2000);
}
watch(polling, (v) => {
  if (timer) clearTimeout(timer);
  if (v) timer = setTimeout(tick, 2000);
}, { immediate: true });
onBeforeUnmount(() => {
  disposed = true;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <section class="narration-entry" data-testid="narration-entry">
    <audio
      v-if="d?.files?.audio"
      :key="d.record.id"
      controls
      :src="d.files.audio"
      class="entry-audio"
      data-testid="narration-entry-audio"
    />
    <div v-else class="entry-audio-placeholder" data-testid="narration-audio-placeholder">
      <span class="placeholder-wave" aria-hidden="true">〰</span>
      <span>尚未生成口播音频</span>
    </div>
    <p class="entry-status" data-testid="narration-entry-status" aria-live="polite">{{ labels[status] }}</p>
    <button
      class="entry-open"
      data-testid="narration-entry-open"
      :disabled="s.busy"
      @click="emit('open')"
    >
      {{ openLabel }}
    </button>
  </section>
</template>

<style scoped>
.narration-entry {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text-body);
}
.entry-audio {
  width: 100%;
  min-width: 0;
}
.entry-audio-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border: 1px dashed var(--border-default);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
}
.placeholder-wave {
  color: var(--accent-gold, #c9a227);
}
.entry-status {
  margin: 0;
  white-space: nowrap;
  font-size: 13px;
}
.entry-open {
  padding: 7px 14px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-panel);
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.entry-open:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
