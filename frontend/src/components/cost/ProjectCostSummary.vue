<script setup lang="ts">
import { computed, watch } from "vue";

import {
  microsDecimalToCnyDisplay,
  useGenerationCostStore,
} from "../../stores/generation-cost";

/**
 * S2-2A 任务 11：项目成本明细对话框。
 * - 展示预计费用、授权上界、provider 已确认实际、无实际价格的估算；
 * - 按 capability/provider 分组；
 * - 超额授权（over_budget_quote_count）标记；
 * - 所有金额为十进制微元字符串，展示格式化不经 Number。
 */

const props = defineProps<{
  projectId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useGenerationCostStore();

const summary = computed(() => store.state.costSummary.data);
const records = computed(() => store.state.costRecords.data?.records ?? []);

watch(
  () => [props.open, props.projectId] as const,
  ([open, projectId]) => {
    if (!open || !projectId) return;
    store.loadCostSummary(projectId);
    store.loadCostRecords(projectId);
  },
  { immediate: true },
);

const COST_BASIS_LABELS: Record<string, string> = {
  estimate: "估算",
  provider_usage: "已确认实际",
  provider_invoice: "账单实际",
};

const UNIT_LABELS: Record<string, string> = {
  token: "token",
  image: "张",
  video_second: "秒",
  tts_character: "字",
  request: "次",
};

function formatUnits(record: { input_units: number | null; output_units: number | null; unit_type: string }): string {
  const parts: string[] = [];
  if (record.input_units !== null) parts.push(`${record.input_units}${UNIT_LABELS[record.unit_type] ?? ""} 输入`);
  if (record.output_units !== null) parts.push(`${record.output_units}${UNIT_LABELS[record.unit_type] ?? ""} 输出`);
  return parts.join(" · ") || "—";
}

const RUN_STATUS_LABELS: Record<string, string> = {
  pending_dispatch: "待派发",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  needs_reconciliation: "待对账",
};

const runStatusSummary = computed(() => {
  const counts = summary.value?.run_status_counts;
  if (!counts) return "";
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${RUN_STATUS_LABELS[status] ?? status} ${count}`)
    .join(" / ");
});
</script>

<template>
  <el-dialog
    :model-value="open"
    title="项目成本明细"
    width="720px"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <div v-if="store.state.costSummary.error" class="cost-error" data-testid="cost-load-error">
      <p>成本数据加载失败：{{ store.state.costSummary.error }}</p>
      <button class="btn btn-primary" @click="store.loadCostSummary(projectId); store.loadCostRecords(projectId)">
        重试
      </button>
    </div>

    <div v-else-if="summary" class="cost-body">
      <div class="cost-totals">
        <div class="cost-total">
          <span class="cost-total-label">总预计费用</span>
          <span class="cost-total-value">¥{{ microsDecimalToCnyDisplay(summary.total_estimated_cost_cny) }}</span>
        </div>
        <div class="cost-total">
          <span class="cost-total-label">授权上界</span>
          <span class="cost-total-value">¥{{ microsDecimalToCnyDisplay(summary.total_authorization_cost_cny) }}</span>
        </div>
        <div class="cost-total">
          <span class="cost-total-label">已确认实际费用</span>
          <span class="cost-total-value" data-testid="cost-total-actual">
            ¥{{ microsDecimalToCnyDisplay(summary.total_actual_cost_cny) }}
          </span>
        </div>
        <div
          v-if="summary.over_budget_quote_count > 0"
          class="cost-over-budget-badge"
          data-testid="over-budget-badge"
        >
          超额授权 {{ summary.over_budget_quote_count }} 次
        </div>
      </div>

      <div class="cost-meta">
        <span>报价 {{ summary.quote_count }} 次（已消费 {{ summary.consumed_quote_count }}）</span>
        <span v-if="runStatusSummary">运行：{{ runStatusSummary }}</span>
      </div>

      <section class="cost-section">
        <h4 class="cost-section-title">按能力分组</h4>
        <div
          v-for="group in summary.capability_breakdown"
          :key="group.capability"
          class="cost-capability-group"
          data-testid="cost-capability-group"
        >
          <span class="cost-capability-name">{{ group.capability }}</span>
          <span class="cost-capability-detail">
            预计 ¥{{ microsDecimalToCnyDisplay(group.estimated_cost_cny) }}
            · 实际 ¥{{ microsDecimalToCnyDisplay(group.actual_cost_cny) }}
            · {{ group.record_count }} 条记录
          </span>
        </div>
      </section>

      <section class="cost-section">
        <h4 class="cost-section-title">费用台账</h4>
        <div v-if="records.length === 0" class="cost-empty">暂无费用记录</div>
        <div v-else class="cost-records">
          <div v-for="record in records" :key="record.id" class="cost-record">
            <div class="cost-record-head">
              <span class="cost-record-capability">{{ record.capability }}</span>
              <span class="cost-record-provider">{{ record.provider_key }}:{{ record.model_id }}</span>
              <span class="cost-record-status">{{ record.status }}</span>
            </div>
            <div class="cost-record-body">
              <span>{{ formatUnits(record) }}</span>
              <span>
                预计 ¥{{ microsDecimalToCnyDisplay(record.estimated_cost_cny) }}
                <template v-if="record.actual_cost_cny !== null">
                  → 实际 ¥{{ microsDecimalToCnyDisplay(record.actual_cost_cny) }}
                </template>
              </span>
              <span class="cost-record-basis">
                {{ COST_BASIS_LABELS[record.cost_basis] ?? record.cost_basis }}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div v-else-if="store.state.costSummary.loading" class="cost-loading">正在加载成本数据…</div>
    <div v-else class="cost-empty">暂无成本数据</div>

    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">关闭</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.cost-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cost-totals {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: stretch;
}

.cost-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border: 1px solid rgba(201, 162, 39, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.cost-total-label {
  font-size: 11px;
  color: #a89f94;
}

.cost-total-value {
  font-size: 16px;
  font-weight: 750;
  color: #f5f0e8;
}

.cost-over-budget-badge {
  align-self: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(224, 122, 95, 0.14);
  border: 1px solid rgba(224, 122, 95, 0.35);
  color: #e0a883;
  font-size: 12px;
  font-weight: 650;
}

.cost-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #a89f94;
}

.cost-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cost-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #f5f0e8;
}

.cost-capability-group {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(201, 162, 39, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
  font-size: 12px;
}

.cost-capability-name {
  font-weight: 700;
  min-width: 150px;
}

.cost-capability-detail {
  color: #a89f94;
}

.cost-empty {
  color: #6b635a;
  font-size: 12px;
}

.cost-records {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cost-record {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid rgba(201, 162, 39, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
  font-size: 12px;
}

.cost-record-head {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.cost-record-capability {
  font-weight: 700;
}

.cost-record-provider {
  color: #a89f94;
  flex: 1;
}

.cost-record-status {
  color: #6b635a;
}

.cost-record-body {
  display: flex;
  gap: 16px;
  color: #a89f94;
}

.cost-record-basis {
  color: #c9a227;
}

.cost-error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #e07a5f;
  font-size: 13px;
}

.cost-loading {
  color: #a89f94;
  font-size: 13px;
}

.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  border: none;
  font-family: inherit;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.018);
  border: 1px solid rgba(201, 162, 39, 0.13);
  color: #a89f94;
}

.btn-primary {
  background: rgba(201, 162, 39, 0.16);
  border: 1px solid rgba(201, 162, 39, 0.4);
  color: #f5f0e8;
}
</style>
