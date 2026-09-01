<script setup lang="ts">
import { ref, watch, computed } from "vue";

import type { ActiveScriptSnapshot } from "../../stores/script";

const props = defineProps<{
  visible: boolean;
  script: ActiveScriptSnapshot | null;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", userFeedback: string): void;
}>();

const userFeedback = ref("");

const ISSUE_CODE_MAP: Record<string, string> = {
  scene_enhancement: "场景细节",
  dialogue_enhancement: "对话细节",
  opening_hook_weak: "开篇冲击力",
  pace_too_slow: "节奏偏慢",
  pace_too_fast: "节奏偏快",
  emotional_depth: "情感厚度",
  character_depth: "人物刻画",
  ending_weak: "结尾力度",
  script_body_too_thin: "篇幅偏薄",
  conflict_pressure: "冲突压力",
};

function humanizeIssueCode(code: string) {
  return ISSUE_CODE_MAP[code] ?? code;
}

const softIssues = computed(() => {
  const issues = props.script?.semantic_review?.soft_issues ?? [];
  return issues
    .map((item) => {
      if (typeof item === "string") return { code: "", message: item };
      const rawCode = (item.code ?? "") as string;
      return { code: humanizeIssueCode(rawCode), message: item.message ?? "" };
    })
    // 兜底过滤：历史快照里存在只有 severity 没有内容的条目，渲染出来是空白行。
    .filter((issue) => issue.code.length > 0 || issue.message.trim().length > 0);
});

const feedbackRequired = computed(() => softIssues.value.length === 0);

const submitError = ref<string | null>(null);

function close() {
  emit("update:visible", false);
}

function handleSubmit() {
  const feedback = userFeedback.value.trim();
  if (feedbackRequired.value && !feedback) {
    submitError.value = "当前没有 AI 审校建议，请填写你的优化意见后再提交。";
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

        <div class="modal-title">定向重新生成</div>

        <template v-if="script">
          <!-- 当前文案 -->
          <div class="modal-section">
            <div class="modal-section-title">📄 当前文案</div>
            <div class="script-scroll-box">
              <p class="segment-text">{{ script.script_text }}</p>
            </div>
          </div>

          <!-- AI 审校建议 -->
          <div v-if="softIssues.length > 0" class="modal-section">
            <div class="modal-section-title">🔍 AI 审校建议</div>
            <div class="review-block">
              <ul class="review-issue-list">
                <li v-for="(issue, index) in softIssues" :key="index" class="review-issue-item review-issue-item--info">
                  <span v-if="issue.code" class="review-issue-code review-issue-code--soft">{{ issue.code }}</span>
                  <span class="review-issue-message">{{ issue.message }}</span>
                </li>
              </ul>
            </div>
          </div>
        </template>

        <!-- 用户反馈 -->
        <div class="modal-section">
          <div class="modal-section-title">
            ✏️ 你的补充反馈
            <span v-if="feedbackRequired" class="feedback-required-badge">必填</span>
            <span v-else class="feedback-optional-badge">选填</span>
          </div>
          <textarea
            v-model="userFeedback"
            class="feedback-textarea"
            :class="{ 'feedback-textarea--error': submitError }"
            :placeholder="feedbackRequired
              ? '当前无可用的 AI 审校建议，请务必描述你对文案不满意的地方，例如：开头太慢、第二个场景缺对话、结尾太虚…'
              : '描述你对当前文案不满意的地方，例如：开头太慢、第二个场景缺对话、结尾太虚、节奏太拖…'"
            maxlength="500"
          />
          <p v-if="submitError" class="feedback-error">{{ submitError }}</p>
          <div v-else class="feedback-hint">
            <template v-if="feedbackRequired">
              当前文案无审校建议，请务必填写你的具体优化方向。
            </template>
            <template v-else>
              根据你的反馈，AI 将在保留事实不变的前提下针对性调整。留空则按审校建议自动优化。
            </template>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="modal-actions">
          <button class="modal-btn modal-btn--secondary" @click="close">取消</button>
          <button
            class="modal-btn modal-btn--primary"
            :disabled="feedbackRequired && !userFeedback.trim()"
            :class="{ 'modal-btn--disabled': feedbackRequired && !userFeedback.trim() }"
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
  background: linear-gradient(180deg, #141c2b 0%, var(--bg-card) 160px);
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
  border: 1px solid var(--border-default);
  border-radius: 50%;
  font-size: 14px;
  color: var(--text-muted);
  cursor: pointer;
  line-height: 1;
  transition: all 200ms ease;
}
.modal-close:hover {
  color: var(--text-heading);
  background: rgba(212, 163, 95, 0.1);
  border-color: rgba(212, 163, 95, 0.3);
}

.modal-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-heading);
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
  color: var(--text-muted);
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

.feedback-optional-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 8px;
  border-radius: 4px;
}

/* Script full text scroll box */
.script-scroll-box {
  max-height: 160px;
  overflow-y: auto;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(212, 163, 95, 0.08);
  border-radius: 10px;
}

.script-scroll-box::-webkit-scrollbar {
  width: 5px;
}
.script-scroll-box::-webkit-scrollbar-thumb {
  background: rgba(212, 163, 95, 0.2);
  border-radius: 4px;
}

.segment-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.75;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

/* Review block */
.review-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(212, 163, 95, 0.08);
  border-radius: 10px;
}

.review-issue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-issue-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.55;
  padding: 6px 10px;
  border-radius: 6px;
}

.review-issue-item--info {
  background: rgba(212, 163, 95, 0.04);
  color: var(--text-secondary);
}

.review-issue-code {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}

.review-issue-code--soft {
  color: var(--accent-primary);
  background: rgba(212, 163, 95, 0.12);
}

.review-issue-message {
  flex: 1;
  min-width: 0;
}

/* Feedback textarea */
.feedback-textarea {
  width: 100%;
  min-height: 100px;
  padding: 12px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  font-family: var(--font-family);
  color: var(--text-body);
  background: var(--bg-input);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  resize: vertical;
  transition: border-color 200ms ease;
}
.feedback-textarea:focus {
  outline: none;
  border-color: rgba(212, 163, 95, 0.5);
  box-shadow: 0 0 0 3px rgba(212, 163, 95, 0.08);
}
.feedback-textarea::placeholder {
  color: var(--text-muted);
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
  color: var(--text-muted);
  line-height: 1.5;
}

/* Actions */
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
  font-family: var(--font-family);
  cursor: pointer;
  transition: all 240ms cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
}

.modal-btn--secondary {
  background: var(--bg-input);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
}
.modal-btn--secondary:hover {
  color: var(--text-body);
  border-color: var(--border-hover);
}

.modal-btn--primary {
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  color: var(--text-inverse);
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
