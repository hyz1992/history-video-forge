<script setup lang="ts">
import type { CreativePresetDto } from "../../stores/creative-presets";

/**
 * S2-2B 任务 9：画风设置区。
 * "不启用"= null；选中 preset = art_style_preset_id。
 */
defineProps<{
  modelValue: string | null;
  presets: CreativePresetDto[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string | null): void;
}>();
</script>

<template>
  <section class="creative-art" data-testid="creative-art-style-settings">
    <h3 class="creative-title">画风</h3>
    <p class="creative-hint">选择版本化画风预设；解析结果会进入美术圣经（Art Bible）与生图提示词。画风变化需要重新生成资产规划。</p>
    <div class="art-cards">
      <button
        type="button"
        class="art-card"
        :class="{ active: modelValue === null }"
        :disabled="disabled"
        data-testid="art-none"
        @click="emit('update:modelValue', null)"
      >
        <span class="art-card-name">不启用（系统自由生成）</span>
        <span class="art-card-desc">不附加固定画风约束</span>
      </button>
      <button
        v-for="preset in presets"
        :key="preset.preset_id"
        type="button"
        class="art-card"
        :class="{ active: modelValue === preset.preset_id }"
        :disabled="disabled"
        :data-testid="`art-${preset.preset_id}`"
        @click="emit('update:modelValue', preset.preset_id)"
      >
        <span class="art-card-name">{{ preset.display_name }}（{{ preset.preset_version }}）</span>
        <span class="art-card-desc">{{ preset.description }}</span>
        <span class="art-card-summary">{{ preset.summary }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.creative-art {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}

.creative-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #e8dfd2;
}

.creative-hint {
  margin: 0;
  font-size: 12px;
  color: #a89f94;
}

.art-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.art-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.012);
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}

.art-card.active {
  border-color: rgba(201, 162, 39, 0.55);
  background: rgba(201, 162, 39, 0.07);
}

.art-card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.art-card-name {
  font-size: 13px;
  font-weight: 650;
  color: #f0e9dd;
}

.art-card-desc,
.art-card-summary {
  font-size: 11px;
  color: #a89f94;
}
</style>
