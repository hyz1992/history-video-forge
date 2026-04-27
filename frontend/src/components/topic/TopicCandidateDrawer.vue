<script setup lang="ts">
import { computed } from "vue";

import type { TopicCandidate } from "../../stores/topic";

const props = defineProps<{
  candidate: TopicCandidate;
  isConfirming: boolean;
}>();

defineEmits<{
  close: [];
  confirm: [];
}>();

const whyThisNow = computed(
  () => props.candidate.why_this_now ?? props.candidate.why_now ?? "当前版本未补充额外推荐理由。",
);

const riskHints = computed(() =>
  props.candidate.risk_hints.length > 0 ? props.candidate.risk_hints : ["暂无显式风险提醒。"],
);
</script>

<template>
  <div class="candidate-drawer-layer">
    <div class="candidate-drawer-backdrop" @click="$emit('close')" />

    <aside data-testid="candidate-drawer" class="candidate-drawer workspace-panel workspace-panel--strong">
      <header class="candidate-drawer-header">
        <div class="candidate-drawer-copy">
          <p class="candidate-drawer-kicker">选题详情</p>
          <h2>{{ candidate.title }}</h2>
          <p>{{ candidate.one_line_angle }}</p>
        </div>

        <button type="button" class="candidate-drawer-close" @click="$emit('close')">
          关闭
        </button>
      </header>

      <div class="candidate-drawer-tags">
        <span class="candidate-drawer-badge">{{ candidate.family_label }}</span>
        <span class="candidate-drawer-badge">{{ candidate.scope_label }}</span>
      </div>

      <section class="candidate-drawer-section">
        <h3>核心冲突</h3>
        <p>{{ candidate.strong_scene }}</p>
      </section>

      <section class="candidate-drawer-section">
        <h3>传播切口</h3>
        <p>{{ whyThisNow }}</p>
      </section>

      <section class="candidate-drawer-section">
        <h3>叙事张力</h3>
        <p>{{ candidate.one_line_angle }}</p>
      </section>

      <section class="candidate-drawer-section">
        <h3>风险提示</h3>
        <ul class="candidate-drawer-risks">
          <li v-for="risk in riskHints" :key="risk">{{ risk }}</li>
        </ul>
      </section>

      <button
        data-testid="confirm-candidate"
        type="button"
        class="btn btn-primary candidate-drawer-confirm"
        :disabled="isConfirming"
        @click="$emit('confirm')"
      >
        {{ isConfirming ? "确认中..." : "确认主题，生成文案" }}
      </button>
    </aside>
  </div>
</template>

<style scoped>
.candidate-drawer-layer {
  position: fixed;
  inset: 0;
  z-index: 50;
  pointer-events: none;
}

.candidate-drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(4, 8, 18, 0.42);
  backdrop-filter: blur(3px);
  pointer-events: auto;
}

.candidate-drawer {
  position: fixed;
  top: 0;
  right: 0;
  display: grid;
  align-content: start;
  gap: 1.1rem;
  width: 360px;
  height: 100vh;
  padding: 1.5rem;
  border-radius: 0;
  border-left: 1px solid rgba(212, 163, 95, 0.2);
  background: rgba(16, 22, 35, 0.97);
  box-shadow: -24px 0 64px rgba(3, 8, 18, 0.48);
  pointer-events: auto;
}

.candidate-drawer-header,
.candidate-drawer-copy {
  display: grid;
  gap: 0.5rem;
}

.candidate-drawer-header {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.candidate-drawer-kicker,
.candidate-drawer-copy p,
.candidate-drawer-section p {
  margin: 0;
}

.candidate-drawer-kicker {
  color: var(--workspace-accent);
  font-size: 0.85rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.candidate-drawer-copy h2,
.candidate-drawer-section h3 {
  margin: 0;
}

.candidate-drawer-copy h2 {
  font-size: 1.35rem;
  line-height: 1.5;
}

.candidate-drawer-copy p,
.candidate-drawer-section p,
.candidate-drawer-risks {
  color: var(--workspace-text-muted);
  line-height: 1.75;
}

.candidate-drawer-close {
  min-height: 2.25rem;
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  background: rgba(18, 24, 38, 0.72);
  box-shadow: none;
}

.candidate-drawer-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.candidate-drawer-badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.875rem;
  padding: 0.25rem 0.7rem;
  border: 1px solid rgba(212, 163, 95, 0.18);
  border-radius: 999px;
  background: rgba(212, 163, 95, 0.08);
  color: var(--workspace-text-muted);
  font-size: 0.88rem;
}

.candidate-drawer-section {
  display: grid;
  gap: 0.45rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(212, 163, 95, 0.12);
}

.candidate-drawer-risks {
  margin: 0;
  padding-left: 1.1rem;
}

.candidate-drawer-confirm {
  width: 100%;
  min-height: 2.75rem;
  margin-top: auto;
  border-radius: 10px;
}
</style>
