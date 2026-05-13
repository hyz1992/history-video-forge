<script setup lang="ts">
import { computed, ref } from "vue";

import type { AssetDependency, AssetTask } from "../../stores/asset-planning";

const props = defineProps<{
  tasks: AssetTask[];
  dependencies: AssetDependency[];
  segmentIds: Set<string>;
}>();

interface TaskGroup {
  segmentId: string;
  tasks: AssetTask[];
}

const taskGroups = computed<TaskGroup[]>(() => {
  const map = new Map<string, AssetTask[]>();

  // Group by source_segment_id, maintaining insertion order
  for (const task of props.tasks) {
    const key = task.source_segment_id ?? "__ungrouped__";
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(task);
  }

  const groups: TaskGroup[] = [];
  // Emit known segment IDs first (in storyboard order)
  for (const segId of props.segmentIds) {
    const tasks = map.get(segId);
    if (tasks) {
      groups.push({ segmentId: segId, tasks });
      map.delete(segId);
    }
  }
  // Remaining groups (unknown segments or ungrouped)
  for (const [segmentId, tasks] of map) {
    groups.push({ segmentId, tasks });
  }

  return groups;
});

const depMap = computed(() => {
  const map = new Map<string, AssetDependency[]>();
  for (const dep of props.dependencies) {
    const list = map.get(dep.task_id) ?? [];
    list.push(dep);
    map.set(dep.task_id, list);
  }
  return map;
});

// Track which prompt_draft sections are expanded
const expandedPrompts = ref<Set<string>>(new Set());

function togglePrompt(taskId: string) {
  const next = new Set(expandedPrompts.value);
  if (next.has(taskId)) {
    next.delete(taskId);
  } else {
    next.add(taskId);
  }
  expandedPrompts.value = next;
}

function isPromptExpanded(taskId: string): boolean {
  return expandedPrompts.value.has(taskId);
}

function truncate(text: string, maxLen = 160): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
</script>

<template>
  <section data-testid="asset-task-list" class="asset-task-list">
    <h2>任务列表</h2>

    <p v-if="tasks.length === 0" class="task-list-empty">暂无任务数据</p>

    <article
      v-for="group in taskGroups"
      :key="group.segmentId"
      data-testid="task-group"
      class="task-group"
    >
      <header class="task-group-header">
        <h3>段落: {{ group.segmentId }}</h3>
        <span class="task-group-count">{{ group.tasks.length }} 个任务</span>
      </header>

      <div class="task-cards">
        <div
          v-for="task in group.tasks"
          :key="task.task_id"
          data-testid="task-card"
          class="task-card"
        >
          <div class="task-card-header">
            <span class="task-card-id">{{ task.task_id }}</span>
            <span class="task-badge">{{ task.task_type }}</span>
            <span v-if="task.cost_tier" class="task-badge task-badge--cost">{{ task.cost_tier }}</span>
          </div>

          <dl class="task-card-body">
            <div class="task-dl-row">
              <dt>production_intent</dt>
              <dd>{{ task.production_intent ?? "-" }}</dd>
            </div>

            <div v-if="task.recommended_mode" class="task-dl-row">
              <dt>recommended_mode</dt>
              <dd>{{ task.recommended_mode }}</dd>
            </div>

            <div v-if="task.prompt_draft" class="task-dl-row task-dl-row--block">
              <dt>prompt_draft</dt>
              <dd>
                <template v-if="isPromptExpanded(task.task_id)">
                  {{ task.prompt_draft }}
                  <button
                    type="button"
                    class="prompt-toggle"
                    @click="togglePrompt(task.task_id)"
                  >
                    收起
                  </button>
                </template>
                <template v-else>
                  {{ truncate(task.prompt_draft) }}
                  <button
                    v-if="task.prompt_draft.length > 160"
                    type="button"
                    class="prompt-toggle"
                    @click="togglePrompt(task.task_id)"
                  >
                    展开
                  </button>
                </template>
              </dd>
            </div>

            <div v-if="task.risk_notes && task.risk_notes.length > 0" class="task-dl-row task-dl-row--block">
              <dt>risk_notes</dt>
              <dd>
                <ul class="task-risk-list">
                  <li v-for="(note, idx) in task.risk_notes" :key="idx">{{ note }}</li>
                </ul>
              </dd>
            </div>

            <div v-if="task.parameters && Object.keys(task.parameters).length > 0" class="task-dl-row task-dl-row--block">
              <dt>parameters</dt>
              <dd>
                <span
                  v-for="(value, key) in task.parameters"
                  :key="key"
                  class="task-param-badge"
                >{{ key }}: {{ typeof value === "object" ? JSON.stringify(value) : value }}</span>
              </dd>
            </div>
          </dl>

          <!-- Dependencies for this task -->
          <div v-if="depMap.get(task.task_id)?.length" class="task-deps">
            <span class="task-deps-label">依赖:</span>
            <span
              v-for="dep in depMap.get(task.task_id)"
              :key="dep.dependency_id"
              class="task-dep-chip"
            >
              {{ dep.depends_on_task_id }} ({{ dep.dependency_type }})
            </span>
          </div>
        </div>
      </div>
    </article>
  </section>
</template>

<style scoped>
.asset-task-list {
  display: grid;
  gap: 1rem;
}

.asset-task-list h2 {
  margin: 0;
  font-size: 1.2rem;
}

.task-list-empty {
  margin: 0;
  color: var(--workspace-text-muted);
}

.task-group {
  display: grid;
  gap: 0.75rem;
}

.task-group-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
}

.task-group-header h3 {
  margin: 0;
  font-size: 1rem;
  color: var(--workspace-accent);
}

.task-group-count {
  color: var(--workspace-text-muted);
  font-size: 0.88rem;
}

.task-cards {
  display: grid;
  gap: 0.75rem;
}

.task-card {
  padding: 0.85rem 1rem;
  border: 1px solid var(--workspace-border);
  border-radius: var(--workspace-radius-sm);
  background: rgba(15, 21, 34, 0.86);
  display: grid;
  gap: 0.5rem;
}

.task-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.task-card-id {
  font-weight: 600;
  font-size: 0.95rem;
  color: var(--workspace-text);
}

.task-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0.1rem 0.5rem;
  border: 1px solid rgba(212, 163, 95, 0.18);
  border-radius: 6px;
  background: rgba(212, 163, 95, 0.08);
  color: var(--workspace-text-muted);
  font-size: 0.8rem;
}

.task-badge--cost {
  border-color: rgba(197, 107, 71, 0.3);
  background: rgba(197, 107, 71, 0.1);
  color: var(--workspace-accent-strong);
}

.task-card-body {
  display: grid;
  gap: 0.35rem;
  margin: 0;
}

.task-dl-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.task-dl-row--block {
  grid-template-columns: auto 1fr;
}

.task-dl-row dt {
  color: var(--workspace-text-muted);
  font-size: 0.84rem;
  white-space: nowrap;
}

.task-dl-row dd {
  margin: 0;
  font-size: 0.9rem;
  color: var(--workspace-text);
  word-break: break-word;
  line-height: 1.55;
}

.prompt-toggle {
  display: inline;
  min-height: unset;
  padding: 0.1rem 0.4rem;
  margin-left: 0.35rem;
  font-size: 0.82rem;
  color: var(--workspace-accent);
  border: none;
  background: none;
  cursor: pointer;
  text-decoration: underline;
  box-shadow: none;
}

.task-risk-list {
  margin: 0;
  padding-left: 1.1rem;
  list-style: disc;
  color: var(--workspace-accent-strong);
  font-size: 0.88rem;
  line-height: 1.6;
}

.task-param-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0.1rem 0.45rem;
  margin: 0.1rem;
  border: 1px solid var(--workspace-border);
  border-radius: 5px;
  background: rgba(212, 163, 95, 0.06);
  color: var(--workspace-text-muted);
  font-size: 0.8rem;
  word-break: break-all;
}

.task-deps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(212, 163, 95, 0.08);
}

.task-deps-label {
  color: var(--workspace-text-muted);
  font-size: 0.84rem;
}

.task-dep-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0.1rem 0.5rem;
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 5px;
  background: rgba(15, 21, 34, 0.6);
  color: var(--workspace-text-muted);
  font-size: 0.8rem;
}

@media (max-width: 639px) {
  .task-card-body .task-dl-row {
    grid-template-columns: 1fr;
  }
}
</style>
