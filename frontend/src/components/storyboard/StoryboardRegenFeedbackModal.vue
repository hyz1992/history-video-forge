<script setup lang="ts">
import { ref, watch, computed } from "vue";

import type { StoryboardPlan, StoryboardSegment } from "../../stores/storyboard";

const props = defineProps<{
  visible: boolean;
  plan: StoryboardPlan | null;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", userFeedback: string): void;
}>();

const userFeedback = ref("");
const submitError = ref<string | null>(null);

const narrativeRoleLabels: Record<string, string> = {
  opening: "开篇",
  setup: "铺垫",
  pressure: "加压",
  turn: "转折",
  peak: "高潮",
  ending: "结尾",
  bridge: "过渡",
};

const segmentSummaries = computed(() => {
  const segments = props.plan?.segments ?? [];
  return segments.map((s, i) => ({
    index: i + 1,
    role: narrativeRoleLabels[s.narrative_role] ?? s.narrative_role,
    excerpt: excerptShort(s),
  }));
});

function excerptShort(segment: StoryboardSegment): string {
  const text = segment.script_excerpt;
  const idx = text.search(/[。！？!?；;]/u);
  if (idx === -1) return text.slice(0, 50) + (text.length > 50 ? "…" : "");
  return text.slice(0, idx + 1);
}

function close() {
  emit("update:visible", false);
}

function handleSubmit() {
  const feedback = userFeedback.value.trim();
  if (!feedback) {
    submitError.value = "请填写你的优化意见后再提交。";
    return;
  }
  submitError.value = null;
  emit("submit", feedback);
  userFeedback.value = "";
  emit("update:visible", false);
}

watch(() => props.visible, (val) => {
  if (!val) {
    userFeedback.value = "";
    submitError.value = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="close">
      <div class="modal-box">
        <button class="modal-close" @click="close" aria-label="关闭">✕</button>

        <div class="modal-title">定向重新生成分镜</div>

        <template v-if="plan">
          <div class="modal-section">
            <div class="modal-section-title">当前分镜概览</div>
            <div class="plan-scroll-box">
              <div class="plan-stats">
                共 {{ plan.segments.length }} 个段落 · 预计总时长约 {{ Math.round(plan.estimated_total_duration_sec ?? 0) }} 秒
              </div>
              <ol class="segment-summary-list">
                <li
                  v-for="s in segmentSummaries"
                  :key="s.index"
                  class="segment-summary-item"
                >
                  <span class="segment-summary-index">#{{ s.index }}</span>
                  <span class="segment-summary-role">{{ s.role }}</span>
                  <span class="segment-summary-excerpt">{{ s.excerpt }}</span>
                </li>
              </ol>
            </div>
          </div>
        </template>

        <div class="modal-section">
          <div class="modal-section-title">
            你的优化反馈
            <span class="feedback-required-badge">必填</span>
          </div>
          <textarea
            v-model="userFeedback"
            class="feedback-textarea"
            :class="{ 'feedback-textarea--error': submitError }"
            placeholder="描述你对当前分镜不满意的地方，例如：开篇镜头感太弱、第三段与文案节奏不匹配、高潮段缺乏视觉张力、需要更多特写镜头…"
            maxlength="500"
          />
          <p v-if="submitError" class="feedback-error">{{ submitError }}</p>
          <div v-else class="feedback-hint">
            AI 将根据你的反馈，在保留叙事结构不变的前提下重新规划分镜。
          </div>
        </div>

        <div class="modal-actions">
          <button class="modal-btn modal-btn--secondary" @click="close">取消</button>
          <button
            class="modal-btn modal-btn--primary"
            :class="{ 'modal-btn--disabled': !userFeedback.trim() }"
            :disabled="!userFeedback.trim()"
            @click="handleSubmit"
          >
            提交重新生成
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(4, 6, 12, 0.72);
  backdrop-filter: blur(6px);
}

.modal-box {
  position: relative;
  width: 780px;
  max-width: 94vw;
  max-height: 90vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #141c2b 0%, #1a2332 160px);
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 16px;
  box-shadow:
    0 0 0 1px rgba(212, 163, 95, 0.05),
    0 8px 48px rgba(0, 0, 0, 0.55),
    0 2px 12px rgba(0, 0, 0, 0.3);
  padding: 24px 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.modal-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(212, 163, 95, 0.35), transparent);
  border-radius: 0 0 2px 2px;
}

.modal-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 50%;
  font-size: 14px;
  color: #6b635a;
  cursor: pointer;
  line-height: 1;
  transition: all 200ms ease;
}
.modal-close:hover {
  color: #f5f0e8;
  background: rgba(201, 162, 39, 0.1);
  border-color: rgba(201, 162, 39, 0.3);
}

.modal-title {
  font-size: 22px;
  font-weight: 700;
  color: #f5f0e8;
  line-height: 1.2;
  padding-right: 40px;
}

.modal-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal-section-title {
  font-size: 13px;
  font-weight: 700;
  color: #6b635a;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.feedback-required-badge {
  font-size: 10px;
  font-weight: 700;
  color: #ef5350;
  background: rgba(239, 83, 80, 0.12);
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.04em;
}

.plan-scroll-box {
  max-height: 220px;
  overflow-y: auto;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(201, 162, 39, 0.08);
  border-radius: 10px;
}

.plan-scroll-box::-webkit-scrollbar {
  width: 5px;
}
.plan-scroll-box::-webkit-scrollbar-thumb {
  background: rgba(201, 162, 39, 0.2);
  border-radius: 4px;
}

.plan-stats {
  font-size: 12px;
  color: #6b635a;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(201, 162, 39, 0.08);
}

.segment-summary-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.segment-summary-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.55;
  padding: 5px 8px;
  border-radius: 6px;
}

.segment-summary-item:nth-child(odd) {
  background: rgba(255, 255, 255, 0.015);
}

.segment-summary-index {
  flex-shrink: 0;
  font-weight: 700;
  color: #c9a227;
  min-width: 22px;
}

.segment-summary-role {
  flex-shrink: 0;
  font-weight: 600;
  color: #a89f94;
  min-width: 32px;
}

.segment-summary-excerpt {
  color: #b7af9c;
}

.feedback-textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  font-family: inherit;
  color: #e0d8c8;
  background: #111827;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  resize: vertical;
  transition: border-color 200ms ease;
}
.feedback-textarea:focus {
  outline: none;
  border-color: rgba(201, 162, 39, 0.5);
  box-shadow: 0 0 0 3px rgba(201, 162, 39, 0.08);
}
.feedback-textarea::placeholder {
  color: #6b635a;
  font-size: 13px;
}

.feedback-textarea--error {
  border-color: rgba(239, 83, 80, 0.5);
  box-shadow: 0 0 0 3px rgba(239, 83, 80, 0.06);
}

.feedback-error {
  margin: 0;
  font-size: 12.5px;
  color: #ef5350;
  line-height: 1.5;
}

.feedback-hint {
  font-size: 11.5px;
  color: #6b635a;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 4px;
}

.modal-btn {
  padding: 11px 28px;
  border-radius: 100px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 240ms cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
}

.modal-btn--secondary {
  background: #111827;
  color: #a89f94;
  border: 1px solid rgba(201, 162, 39, 0.14);
}
.modal-btn--secondary:hover {
  color: #d8cec0;
  border-color: rgba(201, 162, 39, 0.25);
}

.modal-btn--primary {
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  color: #100c08;
  box-shadow:
    0 4px 16px rgba(212, 163, 95, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  letter-spacing: 0.02em;
}
.modal-btn--primary:hover {
  transform: translateY(-2px);
  box-shadow:
    0 8px 24px rgba(212, 163, 95, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.modal-btn--primary:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(212, 163, 95, 0.2);
}

.modal-btn--disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}
</style>
