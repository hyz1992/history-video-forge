<script setup lang="ts">
import { computed, watch } from "vue";

import {
  microsDecimalToCnyDisplay,
  useGenerationCostStore,
  type ProjectCostRecordDto,
} from "../../stores/generation-cost";
import { PIPELINE_STEPS } from "../../stores/workspace";

/**
 * 2026-08-23：项目费用清单面板（跨阶段共用，默认收起）。
 * - 入口：工作区顶栏"费用"按钮（WorkspaceHeader）；
 * - 按流水线阶段分组展示请求级消费明细（LLM token / 图片 / 视频 / TTS）；
 * - 预计费用与已确认实际分开展示（cost_basis 标注），不做授权判断。
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

/** operation → 流水线阶段 key（voice.preview 等归"其他"）。 */
function stageOfOperation(operation: string): string {
  if (operation.startsWith("topic.")) return "topic";
  if (operation.startsWith("script.")) return "script";
  if (operation.startsWith("storyboard.")) return "storyboard";
  if (operation.startsWith("asset_plan.") || operation.startsWith("assets.")) return "asset";
  if (operation.startsWith("publish.")) return "publish";
  return "other";
}

const STAGE_LABELS: Record<string, string> = {
  topic: "选题",
  script: "文案",
  storyboard: "分镜",
  asset: "资产",
  "compose-render": "合成渲染",
  publish: "发布",
  other: "其他",
};

const STAGE_ORDER = ["topic", "script", "storyboard", "asset", "compose-render", "publish", "other"];

interface StageGroup {
  key: string;
  label: string;
  records: ProjectCostRecordDto[];
  estimated: string;
  actual: string;
}

const stageGroups = computed<StageGroup[]>(() => {
  const byStage = new Map<string, ProjectCostRecordDto[]>();
  for (const record of records.value) {
    const key = stageOfOperation(record.operation);
    const list = byStage.get(key) ?? [];
    list.push(record);
    byStage.set(key, list);
  }
  return STAGE_ORDER.filter((key) => byStage.has(key)).map((key) => {
    const list = byStage.get(key) ?? [];
    let estimated = 0n;
    let actual = 0n;
    for (const record of list) {
      estimated += BigInt(record.estimated_cost_cny.replace(".", ""));
      if (record.actual_cost_cny !== null) actual += BigInt(record.actual_cost_cny.replace(".", ""));
    }
    const micros = (value: bigint) => {
      const sign = value < 0n ? "-" : "";
      const abs = value < 0n ? -value : value;
      return `${sign}${abs.toString().slice(0, -6) || "0"}.${abs.toString().slice(-6).padStart(6, "0")}`;
    };
    return { key, label: STAGE_LABELS[key] ?? key, records: list, estimated: micros(estimated), actual: micros(actual) };
  });
});

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

const CAPABILITY_LABELS: Record<string, string> = {
  "llm.smart": "LLM 智能",
  "llm.flash": "LLM 快速",
  "image.generate": "图片",
  "video.image_to_video": "视频",
  "tts.synthesize": "TTS 口播",
};

function recordTitle(record: ProjectCostRecordDto): string {
  const capability = CAPABILITY_LABELS[record.capability] ?? record.capability;
  const units: string[] = [];
  if (record.input_units !== null) units.push(`${record.input_units}${UNIT_LABELS[record.unit_type] ?? ""} 输入`);
  if (record.output_units !== null) units.push(`${record.output_units}${UNIT_LABELS[record.unit_type] ?? ""} 输出`);
  // 规格明细（图片分辨率、视频画质）
  const detail = record.unit_detail;
  if (detail) {
    if (typeof detail.resolution === "string") units.push(detail.resolution);
    if (typeof detail.quality === "string") units.push(detail.quality);
  }
  const unitText = units.join(" · ") || "—";
  return `${capability} · ${record.model_id}${unitText !== "—" ? ` · ${unitText}` : ""}`;
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
  <el-drawer
    :model-value="open"
    title="项目费用清单"
    size="480px"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <div v-if="store.state.costSummary.error" class="cost-error" data-testid="cost-load-error">
      <p>费用数据加载失败：{{ store.state.costSummary.error }}</p>
      <button class="btn btn-primary" @click="store.loadCostSummary(projectId); store.loadCostRecords(projectId)">
        重试
      </button>
    </div>

    <div v-else-if="summary" class="cost-body">
      <div class="cost-totals">
        <div class="cost-total">
          <span class="cost-total-label">总预计费用</span>
          <span class="cost-total-value" data-testid="cost-total-estimated">¥{{ microsDecimalToCnyDisplay(summary.total_estimated_cost_cny) }}</span>
        </div>
        <div class="cost-total">
          <span class="cost-total-label">已确认实际</span>
          <span class="cost-total-value" data-testid="cost-total-actual">¥{{ microsDecimalToCnyDisplay(summary.total_actual_cost_cny) }}</span>
        </div>
      </div>
      <p v-if="runStatusSummary" class="cost-run-status">运行：{{ runStatusSummary }}</p>

      <div v-if="stageGroups.length === 0" class="cost-empty" data-testid="cost-empty">
        <p>暂无消费记录。生成任务执行后，这里会按阶段展示模型用量与费用明细。</p>
      </div>

      <section v-for="group in stageGroups" :key="group.key" class="cost-stage" data-testid="cost-stage-group">
        <header class="cost-stage-header">
          <span class="cost-stage-name">{{ group.label }}</span>
          <span class="cost-stage-total">
            预计 ¥{{ microsDecimalToCnyDisplay(group.estimated) }}
            <template v-if="group.actual !== '0.000000'"> · 实际 ¥{{ microsDecimalToCnyDisplay(group.actual) }}</template>
          </span>
        </header>
        <ul class="cost-stage-records">
          <li v-for="record in group.records" :key="record.id" class="cost-record" data-testid="cost-record">
            <div class="cost-record-main">
              <span class="cost-record-title">{{ recordTitle(record) }}</span>
              <span class="cost-record-status">{{ record.status }}</span>
            </div>
            <div class="cost-record-amounts">
              <span class="cost-record-estimated">¥{{ microsDecimalToCnyDisplay(record.estimated_cost_cny) }}</span>
              <span v-if="record.actual_cost_cny !== null" class="cost-record-actual">
                ¥{{ microsDecimalToCnyDisplay(record.actual_cost_cny) }}
              </span>
              <span class="cost-record-basis">{{ COST_BASIS_LABELS[record.cost_basis] ?? record.cost_basis }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <div v-else class="cost-loading">正在加载费用数据…</div>
  </el-drawer>
</template>

<style scoped>
.cost-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.cost-error {
  color: #e05b4c;
}

.cost-totals {
  display: flex;
  gap: 24px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(201, 162, 39, 0.15);
}

.cost-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cost-total-label {
  font-size: 12px;
  color: #a89f94;
}

.cost-total-value {
  font-size: 20px;
  font-weight: 700;
  color: #c9a227;
}

.cost-run-status {
  margin: 0;
  font-size: 12px;
  color: #8a8178;
}

.cost-empty {
  color: #8a8178;
  font-size: 13px;
}

.cost-stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cost-stage-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.cost-stage-name {
  font-weight: 700;
  font-size: 14px;
}

.cost-stage-total {
  font-size: 12px;
  color: #a89f94;
}

.cost-stage-records {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cost-record {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}

.cost-record-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.cost-record-title {
  color: #f5f0e8;
  word-break: break-all;
}

.cost-record-status {
  color: #8a8178;
}

.cost-record-amounts {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}

.cost-record-estimated {
  color: #c9a227;
}

.cost-record-actual {
  color: #7fb069;
}

.cost-record-basis {
  font-size: 11px;
  color: #8a8178;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
}

.cost-loading {
  color: #8a8178;
  font-size: 13px;
}
</style>
