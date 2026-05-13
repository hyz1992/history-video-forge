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
  <section class="script-history-panel workspace-panel" data-testid="script-history-panel">
    <h2>历史版本</h2>
    <p
      v-if="entries.length > 0 && selectedEntryId && selectedEntryId !== entries[0]?.entry_id"
      data-testid="history-viewing"
      class="history-note"
    >
      正在查看历史版本
    </p>
    <p v-if="entries.length === 0" class="history-empty">暂无历史版本</p>
    <ol v-else class="history-list">
      <li
        v-for="(entry, index) in entries"
        :key="entry.entry_id"
        :data-testid="`history-entry-${index}`"
        class="history-item"
      >
        <span class="history-label">{{ entry.label }}</span>
        <button
          type="button"
          class="btn btn-secondary"
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

<style scoped>
.script-history-panel {
  display: grid;
  gap: 0.5rem;
}

.history-note {
  color: var(--workspace-accent);
  font-size: 0.9rem;
}

.history-empty {
  color: var(--workspace-text-muted);
  font-size: 0.9rem;
}

.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.5rem;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--workspace-border);
  background: var(--workspace-bg-panel);
}

.history-label {
  font-size: 0.92rem;
}
</style>
