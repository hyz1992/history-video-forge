<script setup lang="ts">
import type { TopicCandidate } from "../../stores/topic";

withDefaults(
  defineProps<{
    candidates: TopicCandidate[];
    selectedCandidateId?: string | null;
    compact?: boolean;
  }>(),
  {
    selectedCandidateId: null,
    compact: false,
  },
);

defineEmits<{
  select: [candidate: TopicCandidate];
}>();
</script>

<template>
  <div class="candidate-list" :class="{ 'candidate-list--compact': compact }">
    <button
      v-for="candidate in candidates"
      :key="candidate.candidate_id"
      :data-testid="`candidate-item-${candidate.candidate_id}`"
      type="button"
      class="candidate-item workspace-panel"
      :class="{ 'candidate-item--active': selectedCandidateId === candidate.candidate_id }"
      @click="$emit('select', candidate)"
    >
      <div class="candidate-item-main">
        <div class="candidate-item-copy">
          <strong>{{ candidate.title }}</strong>
          <p>{{ candidate.one_line_angle }}</p>
        </div>

        <div class="candidate-item-meta">
          <span class="candidate-badge">{{ candidate.family_label }}</span>
          <span class="candidate-badge">{{ candidate.scope_label }}</span>
        </div>
      </div>
    </button>
  </div>
</template>

<style scoped>
.candidate-list {
  display: grid;
  gap: 0.75rem;
}

.candidate-list--compact {
  gap: 0.625rem;
}

.candidate-item {
  width: 100%;
  min-height: 96px;
  padding: 1.125rem 1.25rem;
  text-align: left;
  background: rgba(18, 24, 38, 0.86);
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 12px;
  box-shadow: none;
}

.candidate-item:hover,
.candidate-item--active {
  border-color: rgba(212, 163, 95, 0.24);
  background: rgba(24, 33, 51, 0.94);
  transform: translateY(-1px);
}

.candidate-item-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
}

.candidate-item-copy {
  display: grid;
  gap: 0.35rem;
}

.candidate-item-copy strong {
  font-size: 1rem;
  line-height: 1.5;
  font-weight: 600;
}

.candidate-item-copy p {
  margin: 0;
  color: var(--workspace-text-muted);
  line-height: 1.6;
  font-size: 0.95rem;
}

.candidate-item-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.candidate-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0.2rem 0.65rem;
  border: 1px solid rgba(212, 163, 95, 0.18);
  border-radius: 8px;
  background: rgba(212, 163, 95, 0.08);
  color: var(--workspace-text-muted);
  font-size: 0.84rem;
}

@media (max-width: 819px) {
  .candidate-item-main {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .candidate-item-meta {
    justify-content: flex-start;
  }
}
</style>
