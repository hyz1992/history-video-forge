<script setup lang="ts">
import type { TopicTab } from "../../stores/topic";

defineProps<{
  activeTab: TopicTab;
}>();

defineEmits<{
  "update:activeTab": [tab: TopicTab];
}>();

const pipelineStages = [
  { key: "topic", label: "① 选题", disabled: false },
  { key: "script", label: "② 文案", disabled: true },
  { key: "storyboard", label: "③ 分镜", disabled: true },
  { key: "assets", label: "④ 素材", disabled: true },
  { key: "compose", label: "⑤ 合成", disabled: true },
] as const;
</script>

<template>
  <div class="topic-tabs-shell">
    <nav
      data-testid="topic-pipeline-tabs"
      class="topic-pipeline-tabs"
      aria-label="workspace pipeline"
    >
      <template v-for="(stage, index) in pipelineStages" :key="stage.key">
        <button
          type="button"
          class="topic-pipeline-tab"
          :class="{
            'topic-pipeline-tab--active': stage.key === 'topic',
            'topic-pipeline-tab--disabled': stage.disabled,
          }"
          :disabled="stage.disabled"
          :data-testid="`topic-stage-tab-${stage.key}`"
          :aria-current="stage.key === 'topic' ? 'step' : undefined"
        >
          {{ stage.label }}
        </button>
        <span
          v-if="index < pipelineStages.length - 1"
          class="topic-pipeline-arrow"
          aria-hidden="true"
        >
          ↔
        </span>
      </template>
    </nav>

    <nav
      data-testid="topic-entry-tabs"
      class="topic-entry-tabs"
      aria-label="topic entry tabs"
    >
      <button
        data-testid="tab-system"
        type="button"
        class="topic-entry-tab"
        :class="{ 'topic-entry-tab--active': activeTab === 'system' }"
        :aria-pressed="activeTab === 'system'"
        @click="$emit('update:activeTab', 'system')"
      >
        系统自动推荐
      </button>
      <button
        data-testid="tab-library"
        type="button"
        class="topic-entry-tab"
        :class="{ 'topic-entry-tab--active': activeTab === 'library' }"
        :aria-pressed="activeTab === 'library'"
        @click="$emit('update:activeTab', 'library')"
      >
        事件库
      </button>
      <button
        data-testid="tab-custom"
        type="button"
        class="topic-entry-tab"
        :class="{ 'topic-entry-tab--active': activeTab === 'custom' }"
        :aria-pressed="activeTab === 'custom'"
        @click="$emit('update:activeTab', 'custom')"
      >
        自定义主题
      </button>
    </nav>
  </div>
</template>

<style scoped>
.topic-tabs-shell {
  display: grid;
  justify-items: center;
  gap: 0.875rem;
}

.topic-pipeline-tabs,
.topic-entry-tabs {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
}

.topic-pipeline-tabs {
  gap: 0.75rem;
}

.topic-entry-tabs {
  gap: 0;
  padding: 0 0 0.125rem;
  border-bottom: 2px solid rgba(212, 163, 95, 0.18);
}

.topic-pipeline-tab {
  min-height: 40px;
  padding: 0 1.25rem;
  border: 1px solid rgba(212, 163, 95, 0.16);
  border-radius: 8px;
  background: rgba(22, 28, 42, 0.72);
  color: var(--workspace-text-muted);
  box-shadow: none;
  transition:
    border-color 160ms ease,
    color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}

.topic-pipeline-tab {
  min-width: 92px;
  cursor: default;
  font-size: 1rem;
}

.topic-pipeline-tab--active {
  border-color: rgba(192, 57, 43, 0.38);
  background: linear-gradient(135deg, #c0392b, #96281b);
  color: #fff;
  box-shadow: 0 0 20px rgba(192, 57, 43, 0.16);
}

.topic-pipeline-tab--disabled {
  opacity: 0.72;
}

.topic-pipeline-arrow {
  color: var(--workspace-text-soft);
  font-size: 0.95rem;
  letter-spacing: 0.08em;
}

.topic-entry-tab {
  position: relative;
  min-height: 40px;
  cursor: pointer;
  min-width: 136px;
  font-size: 0.98rem;
  padding: 0 1rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--workspace-text-muted);
  box-shadow: none;
  transition:
    color 160ms ease,
    border-color 160ms ease;
}

.topic-entry-tab::after {
  content: "";
  position: absolute;
  right: 0.9rem;
  left: 0.9rem;
  bottom: -2px;
  height: 2px;
  background: transparent;
  transition: background-color 160ms ease;
}

.topic-entry-tab--active {
  color: var(--workspace-text);
}

.topic-entry-tab--active::after {
  background: var(--workspace-accent);
  border-bottom-color: var(--workspace-accent);
}

.topic-entry-tab:hover {
  color: var(--workspace-text);
}
</style>
