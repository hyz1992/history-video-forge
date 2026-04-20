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
    <h2>Trace 摘要</h2>
    <p v-if="!graphTraceSummary?.nodes.length">暂无 graph trace 摘要</p>
    <ul v-else>
      <li
        v-for="(node, index) in graphTraceSummary.nodes"
        :key="`${node.node_name}-${index}`"
        :data-testid="`trace-node-${index}`"
      >
        {{ node.node_name }} / {{ node.input_ref }} / {{ node.output_ref }}
        <span v-if="node.failure_reason"> / {{ node.failure_reason }}</span>
      </li>
    </ul>

    <h3>Runtime Diagnostics</h3>
    <p v-if="!runtimeDiagnostics?.checks.length">暂无 runtime diagnostics</p>
    <ul v-else>
      <li
        v-for="(check, index) in runtimeDiagnostics.checks"
        :key="`${check.code}-${index}`"
        :data-testid="`runtime-diagnostic-${index}`"
      >
        {{ check.code }} / {{ check.level }}
      </li>
    </ul>
  </section>
</template>
