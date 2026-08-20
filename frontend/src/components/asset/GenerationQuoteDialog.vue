<script setup lang="ts">
import { computed, ref, watch } from "vue";

import {
  microsDecimalToCnyDisplay,
  type GenerationQuoteDto,
} from "../../stores/generation-cost";

/**
 * S2-2A 任务 11：报价确认对话框。
 * - 显示 estimated 与 authorization bound（预算门禁使用的可信上界）；
 * - 超预算（over_budget）或存在 unbounded item 时必须显式勾选授权；
 * - 报价失败由主流程处理（本地部署回退/其余提示重试），本组件只负责
 *   报价成功后的确认展示。
 */

const props = defineProps<{
  open: boolean;
  quote: GenerationQuoteDto | null;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: "confirm", payload: { authorizeBudgetOverride: boolean }): void;
  (e: "cancel"): void;
}>();

const authorizeChecked = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) authorizeChecked.value = false;
  },
);

const requiresExplicitAuthorization = computed(
  () => props.quote?.over_budget === true || props.quote?.contains_unbounded_item === true,
);

function confirm() {
  emit("confirm", { authorizeBudgetOverride: authorizeChecked.value });
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="生成费用确认"
    width="560px"
    @update:model-value="(value: boolean) => !value && emit('cancel')"
  >
    <div v-if="loading" class="quote-loading">正在向后端请求报价…</div>

    <div v-else-if="quote" class="quote-body">
      <div class="quote-totals">
        <div class="quote-total">
          <span class="quote-total-label">预计费用</span>
          <span class="quote-total-value" data-testid="quote-estimated">
            ¥{{ microsDecimalToCnyDisplay(quote.estimated_cost_cny) }}
          </span>
        </div>
        <div class="quote-total">
          <span class="quote-total-label">授权上界（预算门禁）</span>
          <span class="quote-total-value" data-testid="quote-authorization">
            ¥{{ microsDecimalToCnyDisplay(quote.authorization_cost_cny) }}
          </span>
        </div>
        <div v-if="quote.budget_limit_cny !== null" class="quote-total">
          <span class="quote-total-label">本次预算上限</span>
          <span class="quote-total-value">¥{{ microsDecimalToCnyDisplay(quote.budget_limit_cny) }}</span>
        </div>
      </div>

      <div v-if="quote.items.length > 0" class="quote-items">
        <div v-for="item in quote.items" :key="`${item.capability}:${item.provider_model_id}`" class="quote-item">
          <span class="quote-item-name">{{ item.capability }}</span>
          <span class="quote-item-detail">{{ item.provider_model_id }}</span>
          <span class="quote-item-amount">
            ¥{{ microsDecimalToCnyDisplay(item.estimated_cost_cny) }}
          </span>
        </div>
      </div>

      <el-alert
        v-if="quote.contains_unbounded_item"
        type="warning"
        :closable="false"
        title="包含无法给出可靠上限的费用项"
        description="该类费用按实际用量计费，可能显著超过预估。请确认你理解并接受这一风险。"
        show-icon
      />
      <el-alert
        v-else-if="quote.over_budget"
        type="warning"
        :closable="false"
        title="本次生成超过单次预算"
        description="提交将视为对该预算上限的显式超额授权。"
        show-icon
      />

      <label v-if="requiresExplicitAuthorization" class="quote-authorize">
        <input
          type="checkbox"
          v-model="authorizeChecked"
          data-testid="quote-authorize-check"
        />
        我了解费用可能超过预算上限，同意继续并授权本次超额
      </label>
    </div>

    <template #footer>
      <template v-if="quote">
        <button class="btn btn-ghost" data-testid="quote-cancel" @click="emit('cancel')">取消</button>
        <button
          class="btn btn-primary"
          data-testid="quote-confirm"
          :disabled="requiresExplicitAuthorization && !authorizeChecked"
          @click="confirm"
        >
          确认并生成
        </button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.quote-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.quote-totals {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.quote-total {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border: 1px solid rgba(201, 162, 39, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.quote-total-label {
  font-size: 11px;
  color: #a89f94;
}

.quote-total-value {
  font-size: 18px;
  font-weight: 750;
  color: #f5f0e8;
}

.quote-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quote-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  color: #d8d0c7;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
}

.quote-item-name {
  font-weight: 650;
  min-width: 110px;
}

.quote-item-detail {
  color: #a89f94;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote-item-amount {
  font-weight: 650;
}

.quote-authorize {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #e0a883;
  line-height: 1.5;
}

.quote-authorize input {
  margin-top: 3px;
  accent-color: #c9a227;
}

.quote-loading {
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
  margin-right: 10px;
}

.btn-primary {
  background: rgba(201, 162, 39, 0.16);
  border: 1px solid rgba(201, 162, 39, 0.4);
  color: #f5f0e8;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
