<script setup lang="ts">
import type { TopicCandidate } from "../../stores/topic";

defineProps<{
  candidates: TopicCandidate[];
}>();

defineEmits<{
  select: [candidate: TopicCandidate];
}>();
</script>

<template>
  <div class="candidate-list">
    <button
      v-for="candidate in candidates"
      :key="candidate.candidate_id"
      :data-testid="`candidate-item-${candidate.candidate_id}`"
      type="button"
      class="candidate-item"
      @click="$emit('select', candidate)"
    >
      <strong>{{ candidate.title }}</strong>
      <span>{{ candidate.one_line_angle }}</span>
      <span>{{ candidate.family_label }} / {{ candidate.scope_label }}</span>
    </button>
  </div>
</template>
