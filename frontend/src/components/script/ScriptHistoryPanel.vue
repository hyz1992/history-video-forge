<script setup lang="ts">
defineProps<{
  entries: Array<{
    entry_id: string;
    label: string;
  }>;
  selectedEntryId: string | null;
}>();

defineEmits<{
  restoreHistory: [entryId: string];
}>();
</script>

<template>
  <section class="script-history-panel" data-testid="script-history-panel">
    <h2>历史版本</h2>
    <p
      v-if="entries.length > 0 && selectedEntryId && selectedEntryId !== entries[0]?.entry_id"
      data-testid="history-viewing"
    >
      正在查看历史版本
    </p>
    <p v-if="entries.length === 0">暂无历史版本</p>
    <ol v-else>
      <li
        v-for="(entry, index) in entries"
        :key="entry.entry_id"
        :data-testid="`history-entry-${index}`"
      >
        <span>{{ entry.label }}</span>
        <button
          type="button"
          :data-testid="`restore-history-${index}`"
          :disabled="selectedEntryId === entry.entry_id"
          @click="$emit('restoreHistory', entry.entry_id)"
        >
          {{ selectedEntryId === entry.entry_id ? "当前查看中" : "恢复查看" }}
        </button>
      </li>
    </ol>
  </section>
</template>
