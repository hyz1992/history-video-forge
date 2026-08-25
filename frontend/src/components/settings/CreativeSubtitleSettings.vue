<script setup lang="ts">
import { computed } from "vue";

import {
  resolveSubtitleStylePreview,
  SUBTITLE_STYLE_BASE_PREVIEW,
} from "../../stores/creative-presets";

/**
 * S2-2B 任务 9：字幕样式设置区（2026-08-25 重设计）。
 * - 不再提供预设选择：直接编辑参数项（默认值预填），修改即实时生效；
 * - 新增文字颜色与描边颜色；
 * - 「恢复默认」一键回到系统默认样式（清空全部覆盖）。
 * style_id / 字体族 / 安全区不可覆盖（平台边界）。
 */
const props = defineProps<{
  overrides: Record<string, unknown>;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:overrides", value: Record<string, unknown>): void;
}>();

interface NumberField {
  key: string;
  label: string;
  type: "number";
  default: number;
  min: number;
  max: number;
  step: number;
}

interface SelectField {
  key: string;
  label: string;
  type: "select";
  default: string;
  options: Array<{ value: string; label: string }>;
}

interface ColorField {
  key: string;
  label: string;
  type: "color";
  default: string;
}

type ParamField = NumberField | SelectField | ColorField;

/** 参数表单：默认值与后端 SubtitleStyleOverrideSet 边界一致。 */
const paramFields: ParamField[] = [
  { key: "font_size_px", label: "字号", type: "number", default: 46, min: 18, max: 96, step: 1 },
  { key: "font_weight", label: "字重", type: "number", default: 700, min: 100, max: 900, step: 100 },
  { key: "text_color", label: "颜色", type: "color", default: "#ffffff" },
  { key: "stroke_width_px", label: "描边宽度", type: "number", default: 2.5, min: 0, max: 12, step: 0.5 },
  { key: "stroke_color", label: "描边颜色", type: "color", default: "#000000" },
  {
    key: "shadow",
    label: "阴影",
    type: "select",
    default: "soft",
    options: [
      { value: "none", label: "无" },
      { value: "soft", label: "柔和" },
      { value: "strong", label: "强烈" },
    ],
  },
  { key: "background_opacity", label: "背景透明度", type: "number", default: 0, min: 0, max: 1, step: 0.1 },
  { key: "bottom_margin_px", label: "底部边距", type: "number", default: 120, min: 0, max: 360, step: 1 },
  { key: "max_lines", label: "最大行数", type: "number", default: 2, min: 1, max: 4, step: 1 },
];

function currentValue(field: ParamField): string | number {
  const value = props.overrides[field.key];
  if (field.type === "select") return typeof value === "string" ? value : field.default;
  if (field.type === "color") return typeof value === "string" ? value : field.default;
  return typeof value === "number" && Number.isFinite(value) ? value : field.default;
}

/** 与默认值一致时不写覆盖（保持覆盖集合最小）；清空同样移除。 */
function setOverride(field: ParamField, value: unknown) {
  const next = { ...props.overrides };
  if (value === null || value === undefined || value === "" || value === field.default) {
    delete next[field.key];
  } else {
    next[field.key] = value;
  }
  emit("update:overrides", next);
}

function onNumberInput(field: NumberField, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === "") {
    setOverride(field, null);
    return;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;
  setOverride(field, parsed);
}

function onColorInput(field: ColorField, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  setOverride(field, value || null);
}

function onSelectChange(field: SelectField, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  setOverride(field, value || null);
}

function resetToDefault() {
  emit("update:overrides", {});
}

const preview = computed(() => resolveSubtitleStylePreview(null, props.overrides));

const hasOverrides = computed(() => Object.keys(props.overrides).length > 0);

/** 预览帧内字幕始终水平与垂直居中（模拟屏幕中央的字幕条）。 */
const previewFrameStyle = computed(() => ({
  justifyContent: "center",
  alignItems: "center",
}));

function hexToRgba(hex: string, alpha: number): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const previewTextStyle = computed(() => {
  const p = preview.value;
  const backgroundVisible = p.background_opacity > 0;
  const backgroundColor = backgroundVisible
    ? hexToRgba(p.background_color, p.background_opacity) ?? undefined
    : undefined;
  return {
    fontSize: `${p.font_size_px}px`,
    fontWeight: String(p.font_weight),
    lineHeight: String(p.line_height),
    color: p.text_color,
    WebkitTextStroke: `${p.stroke_width_px}px ${p.stroke_color}`,
    paintOrder: "stroke fill",
    textShadow: p.shadow === "none" ? undefined : p.shadow,
    backgroundColor,
    padding: backgroundVisible ? "2px 6px" : undefined,
    textAlign: p.text_align,
    maxWidth: `${Math.round(p.max_width_pct * 100)}%`,
  };
});
</script>

<template>
  <section class="creative-subtitle" data-testid="creative-subtitle-settings">
    <h3 class="creative-title">字幕样式</h3>
    <p class="creative-hint">直接调整字幕参数，修改即时生效；点击「恢复默认」回到系统默认样式。</p>

    <div class="subtitle-param-grid" data-testid="subtitle-overrides">
      <label v-for="field in paramFields" :key="field.key" class="param-field">
        <span class="param-label">{{ field.label }}</span>
        <input
          v-if="field.type === 'number'"
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="currentValue(field)"
          :disabled="disabled"
          :data-testid="`override-${field.key}`"
          @input="(event: Event) => onNumberInput(field, event)"
        />
        <select
          v-else-if="field.type === 'select'"
          :value="currentValue(field)"
          :disabled="disabled"
          :data-testid="`override-${field.key}`"
          @change="(event: Event) => onSelectChange(field, event)"
        >
          <option v-for="option in field.options" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <input
          v-else
          type="color"
          :value="currentValue(field)"
          :disabled="disabled"
          :data-testid="`override-${field.key}`"
          @input="(event: Event) => onColorInput(field, event)"
        />
      </label>
    </div>

    <div class="subtitle-actions">
      <button
        type="button"
        class="subtitle-reset-btn"
        data-testid="subtitle-reset"
        :disabled="disabled || !hasOverrides"
        @click="resetToDefault"
      >
        恢复默认
      </button>
      <span v-if="hasOverrides" class="subtitle-modified-hint" data-testid="subtitle-modified-hint">
        已修改 {{ Object.keys(overrides).length }} 项
      </span>
    </div>

    <div class="subtitle-preview" data-testid="subtitle-preview">
      <div class="subtitle-preview-frame" :style="previewFrameStyle">
        <span class="subtitle-preview-text" data-testid="subtitle-preview-text" :style="previewTextStyle">
          示例字幕：刀兵还没到阶下，诏令就先出了宫门。
        </span>
      </div>
      <p class="subtitle-preview-note">预览实时反映参数效果；实际渲染由渲染器按最终解析值消费。</p>
    </div>
  </section>
</template>

<style scoped>
.creative-subtitle {
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.subtitle-param-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.param-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-label {
  font-size: 11px;
  color: #a89f94;
}

.param-field input[type="number"],
.param-field select {
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.25);
  color: #f0e9dd;
  font-size: 12px;
  font-family: inherit;
  /* 指示浏览器以深色渲染表单控件（含展开的选项面板） */
  color-scheme: dark;
}

/* 展开的选项面板：深色底浅色字（原生下拉面板默认跟随系统浅色） */
.param-field select option {
  background-color: #1a1512;
  color: #f0e9dd;
}

.param-field input[type="color"] {
  width: 100%;
  height: 30px;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

.subtitle-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.subtitle-reset-btn {
  height: 30px;
  padding: 0 14px;
  border-radius: 6px;
  border: 1px solid rgba(201, 162, 39, 0.3);
  background: rgba(201, 162, 39, 0.1);
  color: #f0e9dd;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.subtitle-reset-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.subtitle-modified-hint {
  font-size: 11px;
  color: #e8c84a;
}

.subtitle-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.subtitle-preview-frame {
  width: 100%;
  min-height: 130px;
  display: flex;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(ellipse at 50% 26%, rgba(184, 115, 51, 0.3) 0%, transparent 56%),
    linear-gradient(180deg, #2a2118 0%, #151310 58%, #0d0c0b 100%);
  overflow: hidden;
}

.subtitle-preview-text {
  text-align: center;
}

.subtitle-preview-note {
  margin: 0;
  font-size: 10px;
  color: #8a8175;
}
</style>
