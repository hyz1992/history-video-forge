<script setup lang="ts">
import { computed } from "vue";

import type { CreativePresetDto } from "../../stores/creative-presets";
import { resolveSubtitleStylePreview } from "../../stores/creative-presets";

/**
 * S2-2B 任务 9：字幕样式设置区。
 * preset 选择 + 有限安全参数覆盖（白名单字段渲染）+ 实时预览框。
 * style_id / 字体族 / 安全区不可覆盖（平台边界）。
 */
const props = defineProps<{
  modelValue: string | null;
  overrides: Record<string, unknown>;
  presets: CreativePresetDto[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string | null): void;
  (e: "update:overrides", value: Record<string, unknown>): void;
}>();

const selectedPreset = computed(
  () => props.presets.find((preset) => preset.preset_id === props.modelValue) ?? null,
);

const preview = computed(() => resolveSubtitleStylePreview(props.selectedPreset, props.overrides));

function setOverride(field: string, value: unknown) {
  const next = { ...props.overrides };
  if (value === null || value === undefined || value === "") {
    delete next[field];
  } else {
    next[field] = value;
  }
  emit("update:overrides", next);
}

/** 覆盖表单字段（白名单子集；数值边界与后端 schema 一致）。 */
const overrideFields = [
  { key: "font_size_px", label: "字号", type: "number", min: 18, max: 96 },
  { key: "font_weight", label: "字重", type: "number", min: 100, max: 900 },
  { key: "max_lines", label: "最大行数", type: "number", min: 1, max: 4 },
  { key: "stroke_width_px", label: "描边宽度", type: "number", min: 0, max: 12, step: 0.5 },
  { key: "bottom_margin_px", label: "底部边距", type: "number", min: 0, max: 360 },
  { key: "background_opacity", label: "背景透明度", type: "number", min: 0, max: 1, step: 0.1 },
] as const;

const enumFields = [
  { key: "position", label: "位置", options: ["bottom", "middle", "top"] },
  { key: "text_align", label: "对齐", options: ["left", "center", "right"] },
  { key: "shadow", label: "阴影", options: ["none", "soft", "strong"] },
] as const;
</script>

<template>
  <section class="creative-subtitle" data-testid="creative-subtitle-settings">
    <h3 class="creative-title">字幕样式</h3>
    <p class="creative-hint">选择版本化字幕预设；支持有限安全参数覆盖（字体族与安全区为平台固定项，不可修改）。</p>
    <div class="subtitle-cards">
      <button
        type="button"
        class="subtitle-card"
        :class="{ active: modelValue === null }"
        :disabled="disabled"
        data-testid="subtitle-none"
        @click="emit('update:modelValue', null)"
      >
        <span class="subtitle-card-name">系统默认样式</span>
        <span class="subtitle-card-desc">竖屏默认（居中大字、细描边）</span>
      </button>
      <button
        v-for="preset in presets"
        :key="preset.preset_id"
        type="button"
        class="subtitle-card"
        :class="{ active: modelValue === preset.preset_id }"
        :disabled="disabled"
        :data-testid="`subtitle-${preset.preset_id}`"
        @click="emit('update:modelValue', preset.preset_id)"
      >
        <span class="subtitle-card-name">{{ preset.display_name }}（{{ preset.preset_version }}）</span>
        <span class="subtitle-card-desc">{{ preset.description }}</span>
      </button>
    </div>

    <div v-if="selectedPreset" class="subtitle-overrides" data-testid="subtitle-overrides">
      <h4 class="subtitle-overrides-title">安全参数覆盖</h4>
      <div class="subtitle-override-grid">
        <label v-for="field in overrideFields" :key="field.key" class="override-field">
          <span class="override-label">{{ field.label }}</span>
          <input
            type="number"
            :min="field.min"
            :max="field.max"
            :step="'step' in field ? field.step : 1"
            :value="(overrides[field.key] as number | undefined) ?? ''"
            :disabled="disabled"
            :data-testid="`override-${field.key}`"
            @change="
              (event) => {
                const raw = (event.target as HTMLInputElement).value;
                const parsed = Number(raw);
                if (raw === '' || Number.isNaN(parsed)) {
                  setOverride(field.key, null);
                } else {
                  setOverride(field.key, parsed);
                }
              }
            "
          />
        </label>
        <label v-for="field in enumFields" :key="field.key" class="override-field">
          <span class="override-label">{{ field.label }}</span>
          <select
            :value="(overrides[field.key] as string | undefined) ?? ''"
            :disabled="disabled"
            :data-testid="`override-${field.key}`"
            @change="
              (event) => {
                const value = (event.target as HTMLSelectElement).value;
                setOverride(field.key, value === '' ? null : value);
              }
            "
          >
            <option value="">（不覆盖）</option>
            <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
      </div>
    </div>

    <div class="subtitle-preview" data-testid="subtitle-preview">
      <span
        class="subtitle-preview-text"
        data-testid="subtitle-preview-text"
        :style="{
          fontSize: `${preview.font_size_px}px`,
          fontWeight: String(preview.font_weight),
          lineHeight: String(preview.line_height),
          color: preview.text_color,
          WebkitTextStroke: `${preview.stroke_width_px}px ${preview.stroke_color}`,
          textShadow: preview.shadow,
          backgroundColor: preview.background_color,
          opacity: preview.background_opacity > 0 ? 1 : undefined,
          textAlign: preview.text_align,
        }"
      >
        示例字幕：刀兵还没到阶下，诏令就先出了宫门。
      </span>
      <p class="subtitle-preview-note">预览为示意渲染；实际样式由渲染器按最终解析值消费。</p>
    </div>
  </section>
</template>

<style scoped>
.creative-subtitle {
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

.subtitle-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subtitle-card {
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

.subtitle-card.active {
  border-color: rgba(201, 162, 39, 0.55);
  background: rgba(201, 162, 39, 0.07);
}

.subtitle-card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.subtitle-card-name {
  font-size: 13px;
  font-weight: 650;
  color: #f0e9dd;
}

.subtitle-card-desc {
  font-size: 11px;
  color: #a89f94;
}

.subtitle-overrides {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.subtitle-overrides-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: #a89f94;
}

.subtitle-override-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
}

.override-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.override-label {
  font-size: 11px;
  color: #a89f94;
}

.override-field input,
.override-field select {
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.25);
  color: #f0e9dd;
  font-size: 12px;
  font-family: inherit;
}

.subtitle-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 14px 10px;
  border-radius: 8px;
  background: linear-gradient(180deg, #2a2620, #171410);
  overflow: hidden;
}

.subtitle-preview-text {
  max-width: 90%;
}

.subtitle-preview-note {
  margin: 0;
  font-size: 10px;
  color: #8a8175;
}
</style>
