<script setup lang="ts">
import type { StoryboardSegment } from "../../stores/storyboard";

defineProps<{
  segments: StoryboardSegment[];
}>();

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}
</script>

<template>
  <div class="segment-list">
    <article
      v-for="segment in segments"
      :key="segment.segment_id"
      class="segment-card"
    >
      <header class="segment-card-header">
        <span class="segment-id">{{ segment.segment_id }}</span>
        <span class="segment-role">{{ segment.narrative_role }}</span>
      </header>

      <div class="segment-card-body">
        <section class="segment-field">
          <h4>脚本摘录</h4>
          <p>{{ segment.script_excerpt }}</p>
        </section>

        <section class="segment-field">
          <h4>视觉意图</h4>
          <p>{{ segment.visual_intent }}</p>
        </section>

        <section class="segment-field">
          <h4>场景描述</h4>
          <p>{{ segment.scene_description }}</p>
        </section>

        <section class="segment-field">
          <h4>运动提示</h4>
          <p>{{ segment.motion_hint }}</p>
        </section>

        <section class="segment-field">
          <h4>构图提示</h4>
          <p>{{ segment.framing_hint }}</p>
        </section>

        <section class="segment-field segment-timing">
          <h4>时间区间</h4>
          <p>
            {{ formatSeconds(segment.start_hint_sec) }}
            &sim;
            {{ formatSeconds(segment.end_hint_sec) }}
          </p>
        </section>
      </div>
    </article>
  </div>
</template>

<style scoped>
.segment-list {
  display: grid;
  gap: 1rem;
}

.segment-card {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
}

.segment-card-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.segment-id {
  font-weight: 600;
  color: var(--workspace-accent);
  font-size: 0.95rem;
}

.segment-role {
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--workspace-border);
  border-radius: 999px;
  background: var(--workspace-badge-bg);
  color: var(--workspace-text-muted);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.segment-card-body {
  display: grid;
  gap: 0.6rem;
}

.segment-field {
  display: grid;
  gap: 0.2rem;
}

.segment-field h4 {
  margin: 0;
  font-size: 0.85rem;
  color: var(--workspace-text-muted);
  font-weight: 500;
}

.segment-field p {
  margin: 0;
  line-height: 1.65;
  color: var(--workspace-text);
}

.segment-timing p {
  font-variant-numeric: tabular-nums;
  color: var(--workspace-accent);
}
</style>
