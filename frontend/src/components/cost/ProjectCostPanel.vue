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

/**
 * 行：
 * - 媒体记录按同类项合并（同 capability/provider/model/单位 → 一行：数量、
 *   单价、总价、总耗时）；
 * - LLM 记录逐条列举并标注具体用处（选题/文案等多次调用是不同的角色）；
 * - 资产阶段 LLM 记录按模型合并为一行（分段规划对同一 prompt 多次调用）。
 */
type StageRow =
  | {
      kind: "media-group";
      key: string;
      capability: string;
      providerKey: string;
      modelId: string;
      unitType: string;
      /** 展示用的规格档位：视频 1080P/720P、图片分辨率（如 1080*1920）；缺省 null。 */
      specLabel: string | null;
      inputUnits: number | null;
      outputUnits: number | null;
      /** 单件记录数（合并条数）。 */
      count: number;
      /** 单价（十进制微元串，向上取整）；仅图片/视频展示单价。 */
      unitPrice: string | null;
      /** 合计预计金额（十进制微元串）。 */
      totalEstimated: string;
      /** 合计实际金额（十进制微元串）；任一记录无实际时为 null。 */
      totalActual: string | null;
      /** 合计耗时（毫秒）；全部缺耗时信息时为 null。 */
      durationMs: number | null;
      statusText: string;
      costBasis: string | null;
    }
  | {
      kind: "llm";
      key: string;
      record: ProjectCostRecordDto;
      roleLabel: string | null;
      /** 该记录属于同阶段同模型的非首次运行（用户重新生成过）。 */
      isRerun: boolean;
    }
  | {
      kind: "llm-group";
      key: string;
      capability: string;
      modelId: string;
      calls: number;
      inputUnits: number | null;
      outputUnits: number | null;
      roles: string[];
      /** 合并行的合计耗时（毫秒）；全部缺耗时信息时为 null。 */
      durationMs: number | null;
      /** 同阶段同模型的多次运行数（不同 run）减一；>0 表示用户重新生成过。 */
      rerunCount: number;
      statusText: string;
    };

interface StageGroup {
  key: string;
  label: string;
  rows: StageRow[];
  /** 组内是否存在有目录价的消费（LLM 只展示用量，不计金额）。 */
  priced: boolean;
  estimated: string;
  actual: string;
  /** 阶段总耗时（毫秒）；全部记录缺耗时信息时为 null。 */
  durationMs: number | null;
}

/** LLM token 消费只展示用量（模型/token），不展示金额：
 * provider 交互不返回价格，目录价未经核实且官网价格持续变动。 */
function isLlm(record: ProjectCostRecordDto): boolean {
  return record.capability === "llm.smart" || record.capability === "llm.flash";
}

/** prompt id → 中文调用角色（与后端 PROMPT_ID_TO_TIER 同一取值域）。 */
const LLM_ROLE_LABELS: Record<string, string> = {
  "topic.candidate-builder": "选题候选生成",
  "topic.candidate-builder-repair": "选题候选修复",
  "topic.selector": "选题筛选",
  "topic.custom-refine": "选题定制优化",
  "script.writer": "剧本写作",
  "script.semantic-reviewer": "语义审校",
  "storyboard.planner": "分镜规划",
  "storyboard.segment-regen": "分镜分段重写",
  "asset-planning.planner": "资产全局规划",
  "asset-planning.global-structural-repair": "资产结构修复",
  "asset-planning.segment-intent-planner": "分段意图规划",
  "asset-planning.segment-intent-repair": "分段意图修复",
  "asset-planning.asset-structural-repair": "资产结构修复",
  "publish.cover-prompt-generator": "封面提示词",
  "publish.description-generator": "简介生成",
  "publish.title-generator": "标题生成",
  "publish.cover-prompt-optimizer": "封面提示词优化",
  "asset.prompt-optimizer": "资产提示词优化",
};

function llmRoleLabel(operationName: string | null): string | null {
  if (!operationName) return null;
  return LLM_ROLE_LABELS[operationName] ?? operationName;
}

/** 十进制微元串 ↔ 展示用的 BigInt 微元值（"12.340000" → 12340000n）。 */
function microsToDecimalString(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs.toString().slice(0, -6) || "0"}.${abs.toString().slice(-6).padStart(6, "0")}`;
}

/** unit_detail → 展示规格档位：视频画质（1080P/720P）、图片分辨率。 */
const QUALITY_LABELS: Record<string, string> = {
  standard_720p: "720P",
  high_1080p: "1080P",
};

function unitDetailSpecLabel(unitType: string, unitDetail: Record<string, unknown> | null): string | null {
  if (!unitDetail) return null;
  if (unitType === "video_second") {
    const quality = unitDetail.quality;
    return typeof quality === "string" ? QUALITY_LABELS[quality] ?? quality : null;
  }
  if (unitType === "image") {
    const resolution = unitDetail.resolution;
    return typeof resolution === "string" && resolution.length > 0 ? resolution : null;
  }
  return null;
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
    const rows: StageRow[] = [];
    const llmByGroup = new Map<string, ProjectCostRecordDto[]>();
    const mediaByGroup = new Map<string, ProjectCostRecordDto[]>();
    let estimated = 0n;
    let actual = 0n;
    let priced = false;
    for (const record of list) {
      if (isLlm(record)) {
        const groupKey = `${record.capability}|${record.provider_key}|${record.model_id}`;
        const group = llmByGroup.get(groupKey) ?? [];
        group.push(record);
        llmByGroup.set(groupKey, group);
        continue;
      }
      priced = true;
      estimated += BigInt(record.estimated_cost_cny.replace(".", ""));
      if (record.actual_cost_cny !== null) actual += BigInt(record.actual_cost_cny.replace(".", ""));
      // 分组键含规格档位（视频画质/图片分辨率）：不同档位单价不同，
      // 不得合并成一行（2026-08-30：1080P 与 720P 分行展示）。
      const specLabel = unitDetailSpecLabel(record.unit_type, record.unit_detail);
      const groupKey = `${record.capability}|${record.provider_key}|${record.model_id}|${record.unit_type}|${specLabel ?? ""}`;
      const group = mediaByGroup.get(groupKey) ?? [];
      group.push(record);
      mediaByGroup.set(groupKey, group);
    }
    // 媒体同类项合并：数量/单价/总价/总耗时一行展示。
    for (const [groupKey, group] of mediaByGroup) {
      const [capability, , modelId, unitType, spec] = groupKey.split("|");
      const inputUnits = group.some((r) => r.input_units !== null)
        ? group.reduce((sum, r) => sum + (r.input_units ?? 0), 0)
        : null;
      const outputUnits = group.some((r) => r.output_units !== null)
        ? group.reduce((sum, r) => sum + (r.output_units ?? 0), 0)
        : null;
      const durationMs = group.some((r) => r.duration_ms !== null)
        ? group.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0)
        : null;
      const totalEstimated = group.reduce(
        (sum, r) => sum + BigInt(r.estimated_cost_cny.replace(".", "")),
        0n,
      );
      const totalActual = group.every((r) => r.actual_cost_cny !== null)
        ? group.reduce((sum, r) => sum + BigInt(r.actual_cost_cny!.replace(".", "")), 0n)
        : null;
      // 单价：按输出单位（张/秒）向上取整，不低估；图片/视频才展示。
      const priceBase = outputUnits !== null && outputUnits > 0 ? outputUnits : null;
      const unitPrice =
        priceBase !== null && (unitType === "image" || unitType === "video_second")
          ? microsToDecimalString((totalEstimated + BigInt(priceBase) - 1n) / BigInt(priceBase))
          : null;
      const statusCounts = new Map<string, number>();
      for (const r of group) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
      const statusText = [...statusCounts.entries()]
        .map(([status, count]) => `${status} ×${count}`)
        .join(" · ");
      const bases = [...new Set(group.map((r) => r.cost_basis))];
      rows.push({
        kind: "media-group",
        key: `media:${groupKey}`,
        capability: capability!,
        providerKey: group[0]!.provider_key,
        modelId: modelId!,
        unitType: unitType!,
        specLabel: spec || null,
        inputUnits,
        outputUnits,
        count: group.length,
        unitPrice,
        totalEstimated: microsToDecimalString(totalEstimated),
        totalActual: totalActual === null ? null : microsToDecimalString(totalActual),
        durationMs,
        statusText,
        costBasis: bases.length === 1 ? (bases[0] ?? null) : null,
      });
    }
    for (const [groupKey, group] of llmByGroup) {
      const [capability, , modelId] = groupKey.split("|");
      if (key === "asset") {
        // 资产阶段：规划对同一 prompt 按分段多次调用，合并为一行；
        // 重跑以不同 run 计数标注。
        const roles: string[] = [];
        const runIds = new Set<string>();
        for (const r of group) {
          if (r.run_id) runIds.add(r.run_id);
          const label = llmRoleLabel(r.operation_name);
          if (label && !roles.includes(label)) roles.push(label);
        }
        const inputUnits = group.some((r) => r.input_units !== null)
          ? group.reduce((sum, r) => sum + (r.input_units ?? 0), 0)
          : null;
        const outputUnits = group.some((r) => r.output_units !== null)
          ? group.reduce((sum, r) => sum + (r.output_units ?? 0), 0)
          : null;
        const durationMs = group.some((r) => r.duration_ms !== null)
          ? group.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0)
          : null;
        const statusCounts = new Map<string, number>();
        for (const r of group) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
        const statusText = [...statusCounts.entries()]
          .map(([status, count]) => `${status} ×${count}`)
          .join(" · ");
        rows.push({
          kind: "llm-group",
          key: `llm:${groupKey}`,
          capability: capability!,
          modelId: modelId!,
          calls: group.length,
          inputUnits,
          outputUnits,
          roles,
          durationMs,
          rerunCount: Math.max(0, runIds.size - 1),
          statusText,
        });
      } else {
        // 其他阶段：逐条列举并标注具体用处（如选题候选生成/选题筛选），
        // 非首次运行的记录标注重跑。
        const firstRunId = group.find((r) => r.run_id)?.run_id ?? null;
        for (const record of group) {
          rows.push({
            kind: "llm",
            key: record.id,
            record,
            roleLabel: llmRoleLabel(record.operation_name),
            isRerun:
              firstRunId !== null &&
              record.run_id !== null &&
              record.run_id !== firstRunId,
          });
        }
      }
    }
    const stageDurationMs = list.some((r) => r.duration_ms !== null)
      ? list.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0)
      : null;
    return {
      key,
      label: STAGE_LABELS[key] ?? key,
      rows,
      priced,
      estimated: microsToDecimalString(estimated),
      actual: microsToDecimalString(actual),
      durationMs: stageDurationMs,
    };
  });
});

/** 面板顶部总额：与阶段小计同源聚合（排除 LLM 金额），保证明细与汇总一致。 */
const totals = computed(() => {
  let estimated = 0n;
  let actual = 0n;
  for (const group of stageGroups.value) {
    estimated += BigInt(group.estimated.replace(".", ""));
    if (group.actual !== "0.000000") actual += BigInt(group.actual.replace(".", ""));
  }
  return { estimated: microsToDecimalString(estimated), actual: microsToDecimalString(actual) };
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

/** 合并后的媒体行标题：类型 + 模型 + 规格档位 + 数量（图片张数/视频秒数/字数）。 */
function mediaGroupTitle(row: Extract<StageRow, { kind: "media-group" }>): string {
  const capability = CAPABILITY_LABELS[row.capability] ?? row.capability;
  const specText = row.specLabel ? ` · ${row.specLabel}` : "";
  const units: string[] = [];
  if (row.inputUnits !== null && row.inputUnits > 0) {
    units.push(`${row.inputUnits}${UNIT_LABELS[row.unitType] ?? ""} 输入`);
  }
  if (row.outputUnits !== null && row.outputUnits > 0) {
    units.push(`${row.outputUnits}${UNIT_LABELS[row.unitType] ?? ""} 输出`);
  }
  const unitText = units.length > 0 ? ` · ${units.join(" · ")}` : "";
  return `${capability} · ${row.modelId}${specText}${unitText}`;
}

/** 单条 LLM 行标题：调用角色（具体用处）+ 模型 + token。 */
function llmRecordTitle(record: ProjectCostRecordDto, roleLabel: string | null): string {
  const capability = CAPABILITY_LABELS[record.capability] ?? record.capability;
  const units: string[] = [];
  if (record.input_units !== null) units.push(`${record.input_units}token 输入`);
  if (record.output_units !== null) units.push(`${record.output_units}token 输出`);
  const unitText = units.length > 0 ? ` · ${units.join(" · ")}` : "";
  const prefix = roleLabel ? `${roleLabel} · ${record.model_id}` : `${capability} · ${record.model_id}`;
  return `${prefix}${unitText}`;
}

/** 耗时展示：<1s 用毫秒，<1min 用秒（≥10s 取整），≥1min 用"X分Y秒"。 */
function formatDurationMs(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}毫秒`;
  if (ms < 60_000) {
    const seconds = ms / 1000;
    const text = seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
    return `${text.replace(/\.0$/, "")}秒`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}分${seconds}秒`;
}

/** 行的耗时（单条 LLM 记录取自身耗时，合并行取合计耗时）。 */
function rowDurationMs(row: StageRow): number | null {
  if (row.kind === "llm") return row.record.duration_ms;
  return row.durationMs;
}

/** 合并后的资产阶段 LLM 行标题：模型 + 调用次数 + 角色 + 合计 token。 */
function llmGroupTitle(row: Extract<StageRow, { kind: "llm-group" }>): string {
  const capability = CAPABILITY_LABELS[row.capability] ?? row.capability;
  const units: string[] = [];
  if (row.inputUnits !== null) units.push(`${row.inputUnits}token 输入`);
  if (row.outputUnits !== null) units.push(`${row.outputUnits}token 输出`);
  const roleText = row.roles.length > 0 ? ` · ${row.roles.join("、")}` : "";
  const unitText = units.length > 0 ? ` · ${units.join(" · ")}` : "";
  return `${capability} · ${row.modelId} · ×${row.calls} 次调用${roleText}${unitText}`;
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
    direction="ltr"
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
          <span class="cost-total-value" data-testid="cost-total-estimated">¥{{ microsDecimalToCnyDisplay(totals.estimated) }}</span>
        </div>
        <div class="cost-total">
          <span class="cost-total-label">已确认实际</span>
          <span class="cost-total-value" data-testid="cost-total-actual">¥{{ microsDecimalToCnyDisplay(totals.actual) }}</span>
        </div>
      </div>
      <p class="cost-llm-note" data-testid="cost-llm-note">
        LLM 消费按 token 用量展示，价格以供应商官网为准，不在此计入金额。
      </p>
      <p v-if="runStatusSummary" class="cost-run-status">运行：{{ runStatusSummary }}</p>

      <div v-if="stageGroups.length === 0" class="cost-empty" data-testid="cost-empty">
        <p>暂无消费记录。生成任务执行后，这里会按阶段展示模型用量与费用明细。</p>
      </div>

      <section v-for="group in stageGroups" :key="group.key" class="cost-stage" data-testid="cost-stage-group">
        <header class="cost-stage-header">
          <span class="cost-stage-name">{{ group.label }}</span>
          <span class="cost-stage-total">
            <template v-if="group.priced">
              预计 ¥{{ microsDecimalToCnyDisplay(group.estimated) }}
              <template v-if="group.actual !== '0.000000'"> · 实际 ¥{{ microsDecimalToCnyDisplay(group.actual) }}</template>
            </template>
            <template v-else>—</template>
            <template v-if="group.durationMs !== null"> · 耗时 {{ formatDurationMs(group.durationMs) }}</template>
          </span>
        </header>
        <ul class="cost-stage-records">
          <li v-for="row in group.rows" :key="row.key" class="cost-record" data-testid="cost-record">
            <div class="cost-record-main">
              <span class="cost-record-title">
                <template v-if="row.kind === 'llm'">{{ llmRecordTitle(row.record, row.roleLabel) }}</template>
                <template v-else-if="row.kind === 'llm-group'">{{ llmGroupTitle(row) }}</template>
                <template v-else>{{ mediaGroupTitle(row) }}</template>
              </span>
              <span class="cost-record-status">
                {{ row.kind === "media-group" || row.kind === "llm-group" ? row.statusText : row.record.status }}
                <template v-if="rowDurationMs(row) !== null">
                  · 耗时 {{ formatDurationMs(rowDurationMs(row)) }}
                </template>
                <span
                  v-if="row.kind === 'llm' && row.isRerun"
                  class="cost-record-retry"
                  data-testid="cost-record-rerun"
                >
                  重跑
                </span>
                <span
                  v-if="row.kind === 'llm-group' && row.rerunCount > 0"
                  class="cost-record-retry"
                  data-testid="cost-record-rerun"
                >
                  重跑 {{ row.rerunCount }} 次
                </span>
              </span>
            </div>
            <div v-if="row.kind === 'llm' || row.kind === 'llm-group'" class="cost-record-amounts">
              <span class="cost-record-unpriced" data-testid="cost-record-unpriced">—</span>
            </div>
            <div v-else class="cost-record-amounts">
              <span v-if="row.unitPrice !== null" class="cost-record-unit-price" data-testid="cost-record-unit-price">
                单价 ¥{{ microsDecimalToCnyDisplay(row.unitPrice) }}
              </span>
              <span class="cost-record-estimated">总价 ¥{{ microsDecimalToCnyDisplay(row.totalEstimated) }}</span>
              <span
                v-if="row.totalActual !== null && row.totalActual !== row.totalEstimated"
                class="cost-record-actual"
              >
                实际 ¥{{ microsDecimalToCnyDisplay(row.totalActual) }}
              </span>
              <span v-if="row.costBasis" class="cost-record-basis">{{ COST_BASIS_LABELS[row.costBasis] ?? row.costBasis }}</span>
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

.cost-llm-note {
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

.cost-record-retry {
  margin-left: 6px;
  font-size: 11px;
  color: #d98a3d;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(217, 138, 61, 0.12);
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

.cost-record-unit-price {
  color: #a89f94;
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
