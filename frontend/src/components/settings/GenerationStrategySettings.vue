<script setup lang="ts">
import { computed } from "vue";

import {
  cnyInputToMicrosString,
  microsStringToCnyInput,
  type VideoGenerationStrategyValue,
  type ApiVideoQualityValue,
} from "../../stores/generation-config";

/**
 * S2-2A 任务 10：视频策略/画质/预算的共享编辑组件。
 * 纯受控组件：draft 由父组件持有，变更通过 update:* 事件上抛。
 * testIdPrefix 用于区分用户设置页与项目设置对话框两处挂载上下文。
 */

const props = defineProps<{
  strategy: VideoGenerationStrategyValue;
  apiQuality: ApiVideoQualityValue;
  budgetMicros: string | null;
  disabled?: boolean;
  testIdPrefix?: string;
}>();

const emit = defineEmits<{
  (e: "update:strategy", value: VideoGenerationStrategyValue): void;
  (e: "update:apiQuality", value: ApiVideoQualityValue): void;
  (e: "update:budgetMicros", value: string | null): void;
  (e: "update:budgetInvalid", value: boolean): void;
}>();

const STRATEGY_OPTIONS: Array<{
  value: VideoGenerationStrategyValue;
  label: string;
  description: string;
}> = [
  {
    value: "all_api_video",
    label: "全部使用 API 视频",
    description: "每个分镜都生成 API 视频；任一失败会阻塞等待你确认，不自动降级。成本最高。",
  },
  {
    value: "prefer_api_video",
    label: "优先 API 视频",
    description: "尽量使用 API 视频，失败的分镜自动退回图片+运镜，并标注降级原因。",
  },
  {
    value: "prefer_remotion",
    label: "优先 Remotion",
    description: "默认使用图片+本地运镜，仅对强烈推荐 API 视频的分镜调用 API。性价比均衡（默认）。",
  },
  {
    value: "all_remotion",
    label: "全部使用 Remotion",
    description: "完全不调用视频 API，全部使用图片+本地运镜。外部成本最低。",
  },
];

const QUALITY_OPTIONS: Array<{ value: ApiVideoQualityValue; label: string }> = [
  { value: "standard_720p", label: "标准 720P" },
  { value: "high_1080p", label: "高质量 1080P" },
];

function selectUnlimited() {
  emit("update:budgetMicros", null);
  emit("update:budgetInvalid", false);
}

const budgetLimited = computed(() => props.budgetMicros !== null);

function enableBudgetAmount() {
  if (props.budgetMicros === null) {
    emit("update:budgetMicros", "0");
    emit("update:budgetInvalid", false);
  }
}

const amountText = computed({
  get: () => microsStringToCnyInput(props.budgetMicros),
  set: (text: string) => {
    if (text.trim() === "") {
      emit("update:budgetMicros", "0");
      emit("update:budgetInvalid", false);
      return;
    }
    const micros = cnyInputToMicrosString(text);
    if (micros === null) {
      emit("update:budgetInvalid", true);
      return;
    }
    emit("update:budgetMicros", micros);
    emit("update:budgetInvalid", false);
  },
});
</script>

<template>
  <div class="strategy-settings">
    <section class="settings-section">
      <h4 class="settings-section-title">视频生成策略</h4>
      <div class="strategy-cards">
        <label
          v-for="option in STRATEGY_OPTIONS"
          :key="option.value"
          class="strategy-card"
          :class="{ 'is-selected': strategy === option.value }"
        >
          <input
            type="radio"
            name="video-strategy"
            :data-testid="`${testIdPrefix ?? ''}strategy-${option.value}`"
            :value="option.value"
            :checked="strategy === option.value"
            :disabled="disabled"
            @change="emit('update:strategy', option.value)"
          />
          <span class="strategy-card-body">
            <span class="strategy-card-label">{{ option.label }}</span>
            <span class="strategy-card-desc">{{ option.description }}</span>
          </span>
        </label>
      </div>
      <details class="strategy-advanced">
        <summary>高级说明：失败语义与成本差异</summary>
        <p>「全部使用 API 视频」为严格模式：API 失败不会自动降级，需要你选择重试或明确接受图片+运镜版本；「优先 API 视频 / 优先 Remotion」在 API 失败时自动降级并记录降级事件；「全部使用 Remotion」不会产生任何视频 API 费用。画质越高，视频 API 按秒计费的成本越高。</p>
      </details>
    </section>

    <section class="settings-section">
      <h4 class="settings-section-title">API 视频画质</h4>
      <div class="quality-options">
        <label
          v-for="option in QUALITY_OPTIONS"
          :key="option.value"
          class="quality-option"
        >
          <input
            type="radio"
            name="api-quality"
            :data-testid="`${testIdPrefix ?? ''}quality-${option.value}`"
            :value="option.value"
            :checked="apiQuality === option.value"
            :disabled="disabled"
            @change="emit('update:apiQuality', option.value)"
          />
          {{ option.label }}
        </label>
      </div>
    </section>

    <section class="settings-section">
      <h4 class="settings-section-title">单次付费预算</h4>
      <div class="budget-options">
        <label class="budget-option">
          <input
            type="radio"
            name="budget-mode"
            data-testid="budget-unlimited"
            :value="true"
            :checked="budgetMicros === null"
            :disabled="disabled"
            @change="selectUnlimited"
          />
          不设上限
        </label>
        <label class="budget-option">
          <input
            type="radio"
            name="budget-mode"
            :data-testid="`${testIdPrefix ?? ''}budget-amount-enabled`"
            :checked="budgetLimited"
            :disabled="disabled"
            @change="enableBudgetAmount"
          />
          设置金额（元）
        </label>
        <input
          v-if="budgetLimited"
          v-model="amountText"
          class="budget-amount-input"
          type="text"
          inputmode="decimal"
          placeholder="如 12.34"
          :data-testid="`${testIdPrefix ?? ''}budget-amount`"
          :disabled="disabled"
        />
      </div>
      <p class="settings-hint">预算在每次付费生成前的报价确认时生效；超预算的生成需要你显式授权才会执行。</p>
    </section>
  </div>
</template>

<style scoped>
.strategy-settings {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-section-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #f5f0e8;
}

.strategy-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.strategy-card {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid rgba(201, 162, 39, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease;
}

.strategy-card:hover {
  border-color: rgba(201, 162, 39, 0.34);
}

.strategy-card.is-selected {
  border-color: #c9a227;
  background: rgba(201, 162, 39, 0.08);
}

.strategy-card input {
  margin-top: 3px;
  accent-color: #c9a227;
}

.strategy-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.strategy-card-label {
  font-size: 13px;
  font-weight: 700;
  color: #f5f0e8;
}

.strategy-card-desc {
  font-size: 12px;
  line-height: 1.55;
  color: #a89f94;
}

.strategy-advanced {
  font-size: 12px;
  color: #a89f94;
}

.strategy-advanced summary {
  cursor: pointer;
  color: #c9a227;
}

.quality-options,
.budget-options {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.quality-option,
.budget-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #f5f0e8;
  cursor: pointer;
}

.quality-option input,
.budget-option input {
  accent-color: #c9a227;
}

.budget-amount-input {
  width: 140px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(201, 162, 39, 0.2);
  background: rgba(255, 255, 255, 0.03);
  color: #f5f0e8;
  font-size: 13px;
}

.settings-hint {
  margin: 0;
  font-size: 12px;
  color: #6b635a;
}
</style>
