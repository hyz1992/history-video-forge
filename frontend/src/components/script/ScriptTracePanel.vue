<script setup lang="ts">
defineProps<{
  graphTraceSummary?: {
    nodes: Array<{
      node_name: string;
      input_ref: string;
      output_ref: string;
      failure_reason: string | null;
    }>;
  } | null;
  runtimeDiagnostics?: {
    checks: Array<{
      code: string;
      level: string;
    }>;
  } | null;
}>();
</script>

<template>
  <section class="script-trace-panel" data-testid="script-trace-panel">
    <h2>执行追踪</h2>
    <p v-if="!graphTraceSummary?.nodes.length" class="trace-empty">暂无执行追踪数据</p>
    <ul v-else class="trace-list">
      <li
        v-for="(node, index) in graphTraceSummary.nodes"
        :key="`${node.node_name}-${index}`"
        :data-testid="`trace-node-${index}`"
        class="trace-item"
      >
        <span class="trace-node-name">{{ node.node_name }}</span>
        <span class="trace-refs">{{ node.input_ref }} → {{ node.output_ref }}</span>
        <span v-if="node.failure_reason" class="trace-error">{{ node.failure_reason }}</span>
      </li>
    </ul>

    <h3>运行诊断</h3>
    <p v-if="!runtimeDiagnostics?.checks.length" class="trace-empty">暂无运行诊断数据</p>
    <ul v-else class="trace-list">
      <li
        v-for="(check, index) in runtimeDiagnostics.checks"
        :key="`${check.code}-${index}`"
        :data-testid="`runtime-diagnostic-${index}`"
        class="trace-item"
      >
        <span class="workspace-badge">{{ check.code }}</span>
        <span :class="check.level === 'error' ? 'trace-error' : 'trace-level'">{{ check.level }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.script-trace-panel {
  display: grid;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.script-trace-panel h2,
.script-trace-panel h3 {
  margin: 0;
  color: var(--workspace-text);
}

.script-trace-panel h3 {
  font-size: 0.95rem;
  color: var(--workspace-text-muted);
}

.trace-empty {
  color: var(--workspace-text-muted);
  font-size: 0.88rem;
}

.trace-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.35rem;
}

.trace-item {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.trace-node-name {
  font-weight: 500;
}

.trace-refs {
  color: var(--workspace-text-muted);
}

.trace-error {
  color: var(--workspace-accent-strong, #c0392b);
}

.trace-level {
  color: var(--workspace-text-muted);
}
</style>
