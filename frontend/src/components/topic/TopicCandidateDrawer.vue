<script setup lang="ts">
import type { TopicCandidate } from "../../stores/topic";

defineProps<{
  candidate: TopicCandidate;
  isConfirming: boolean;
}>();

defineEmits<{
  close: [];
  confirm: [];
}>();
</script>

<template>
  <aside data-testid="candidate-drawer" class="candidate-drawer">
    <header>
      <h2>{{ candidate.title }}</h2>
      <button type="button" @click="$emit('close')">关闭</button>
    </header>

    <p>{{ candidate.one_line_angle }}</p>
    <p>{{ candidate.why_this_now ?? candidate.why_now ?? "等待补充推荐理由" }}</p>
    <p>{{ candidate.strong_scene }}</p>

    <ul>
      <li v-for="risk in candidate.risk_hints" :key="risk">{{ risk }}</li>
    </ul>

    <button
      data-testid="confirm-candidate"
      type="button"
      :disabled="isConfirming"
      @click="$emit('confirm')"
    >
      {{ isConfirming ? "确认中..." : "确认这个题" }}
    </button>
  </aside>
</template>
