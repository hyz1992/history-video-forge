<script setup lang="ts">
import type { TopicTab } from "../../stores/topic";

defineProps<{
  activeTab: TopicTab;
}>();

defineEmits<{
  "update:activeTab": [tab: TopicTab];
}>();
</script>

<template>
  <nav class="topic-tabs" aria-label="topic entry tabs">
    <button
      data-testid="tab-system"
      type="button"
      :aria-pressed="activeTab === 'system'"
      @click="$emit('update:activeTab', 'system')"
    >
      系统自动推荐
    </button>
    <button
      data-testid="tab-library"
      type="button"
      :aria-pressed="activeTab === 'library'"
      @click="$emit('update:activeTab', 'library')"
    >
      事件库
    </button>
    <button
      data-testid="tab-custom"
      type="button"
      :aria-pressed="activeTab === 'custom'"
      @click="$emit('update:activeTab', 'custom')"
    >
      自定义主题
    </button>
  </nav>
</template>
