<script setup lang="ts">
import { computed } from "vue";
import type {
  CapabilitySlotSelectionMap,
  PublicCapabilityEntryDto,
} from "../../stores/generation-config";
import { CAPABILITY_SLOTS } from "../../stores/generation-config";

/**
 * S2-2C 任务 8（详细设计 §9.1）：Provider/Model 高级选择区。
 *
 * 五槽卡片（llm.smart / llm.flash / image.generate / video.image_to_video /
 * tts.synthesize）：每槽「自动（平台推荐）」单选 + 目录 active 候选列表
 * （display_name + 质量/速度标签）；选中候选 → fixed（provider_model_id =
 * 目录条目 id），选自动 → auto。单候选槽位如实显示"当前仅配置 X"（自动与
 * 固定当前等价，仍允许固定以锁定语义）；无候选显示"当前部署无可用模型"。
 * 候选列表由调用方传入（store.state.capabilities 已过滤 availability=enabled）。
 */

const props = defineProps<{
  entries: PublicCapabilityEntryDto[];
  modelValue: CapabilitySlotSelectionMap;
  disabled?: boolean;
  testIdPrefix?: string;
  /** 任务11C：narration_first_v1 项目的 tts.synthesize 槽由策略固定，禁用选择。 */
  narrationLocked?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: CapabilitySlotSelectionMap): void;
}>();

/** 任务11C：口播前置项目的语音合成槽不开放选择（改动会触发口播失效，走文案页口播设置）。 */
function slotDisabled(slot: string): boolean {
  return Boolean(props.disabled || (props.narrationLocked && slot === "tts.synthesize"));
}

const SLOT_LABELS: Record<string, string> = {
  "llm.smart": "文案智脑（LLM 智能档）",
  "llm.flash": "快速模型（LLM 轻量档）",
  "image.generate": "分镜图生成",
  "video.image_to_video": "分镜视频生成",
  "tts.synthesize": "口播配音",
};

const slots = computed(() =>
  CAPABILITY_SLOTS.map((slot) => {
    const candidates = props.entries.filter((entry) => entry.capability === slot);
    return { slot, label: SLOT_LABELS[slot] ?? slot, candidates };
  }),
);

function selectAuto(slot: string): void {
  emit("update:modelValue", { ...props.modelValue, [slot]: { mode: "auto" } });
}

function selectCandidate(slot: string, entry: PublicCapabilityEntryDto): void {
  emit("update:modelValue", {
    ...props.modelValue,
    [slot]: { mode: "fixed", provider_model_id: entry.id },
  });
}

function isAuto(slot: string): boolean {
  return props.modelValue[slot]?.mode !== "fixed";
}

function isFixedTo(slot: string, entryId: string): boolean {
  const selection = props.modelValue[slot];
  return selection?.mode === "fixed" && selection.provider_model_id === entryId;
}

function testId(suffix: string): string {
  return `${props.testIdPrefix ?? ""}${suffix}`;
}

function tierLabel(entry: PublicCapabilityEntryDto): string {
  const parts: string[] = [];
  if (entry.quality_tier) parts.push(entry.quality_tier === "high" ? "高质量" : entry.quality_tier);
  if (entry.speed_tier) parts.push(entry.speed_tier === "fast" ? "快速" : entry.speed_tier);
  return parts.length > 0 ? `（${parts.join(" · ")}）` : "";
}
</script>

<template>
  <div class="capability-slots">
    <div
      v-for="{ slot, label, candidates } in slots"
      :key="slot"
      class="capability-slot-card"
      :data-testid="testId(`cap-slot-${slot}`)"
    >
      <h4 class="capability-slot-title">{{ label }}</h4>
      <p v-if="narrationLocked && slot === 'tts.synthesize'" class="capability-narration-note" data-testid="cap-narration-note-tts">口播前置项目由策略固定模型与音色；如需调整请在文案页口播设置中重新生成。</p>

      <label class="capability-choice" :class="{ disabled: disabled }">
        <input
          type="radio"
          :name="testId(`cap-radio-${slot}`)"
          :checked="isAuto(slot)"
          :disabled="slotDisabled(slot)"
          :data-testid="testId(`cap-auto-${slot}`)"
          @change="selectAuto(slot)"
        />
        <span>自动（平台推荐）</span>
      </label>

      <p
        v-if="candidates.length === 1"
        class="capability-single-note"
        :data-testid="testId(`cap-single-note-${slot}`)"
      >
        当前仅配置 {{ candidates[0]!.display_name }}（自动与固定当前等价，固定可锁定语义）
      </p>

      <template v-if="candidates.length > 0">
        <label
          v-for="entry in candidates"
          :key="entry.id"
          class="capability-choice"
          :class="{ disabled: disabled }"
        >
          <input
            type="radio"
            :name="testId(`cap-radio-${slot}`)"
            :checked="isFixedTo(slot, entry.id)"
            :disabled="slotDisabled(slot)"
            :data-testid="testId(`cap-candidate-${slot}-${entry.id}`)"
            @change="selectCandidate(slot, entry)"
          />
          <span class="capability-candidate-name">
            {{ entry.display_name }}<span class="capability-tier">{{ tierLabel(entry) }}</span>
          </span>
        </label>
      </template>

      <p
        v-else
        class="capability-empty-note"
        :data-testid="testId(`cap-empty-${slot}`)"
      >
        当前部署无可用模型（保持自动）
      </p>
    </div>
  </div>
</template>

<style scoped>
.capability-slots {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.capability-slot-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}

.capability-slot-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #d8d0c7;
}

.capability-choice {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #f5f0e8;
  cursor: pointer;
}

.capability-choice.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.capability-candidate-name {
  display: inline-flex;
  gap: 6px;
  align-items: baseline;
}

.capability-tier {
  font-size: 11px;
  color: #a89f94;
}

.capability-single-note {
  margin: 0;
  font-size: 11px;
  color: #6b635a;
}

.capability-empty-note {
  margin: 0;
  font-size: 11px;
  color: #6b635a;
}
</style>
