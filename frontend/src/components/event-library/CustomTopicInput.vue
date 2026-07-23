<script setup lang="ts">
import { computed, ref } from "vue";
import { apiFetch } from "../../utils/api";
import { useTopicStore } from "../../stores/topic";
import { useProjectStore } from "../../stores/project";

const emit = defineEmits<{
  (e: "close"): void;
}>();

const topicStore = useTopicStore();
const projectStore = useProjectStore();

// 字数限制：与后端 CUSTOM_DIGEST_MIN/MAX_LENGTH 保持一致
// 下限 4 字：支持成语/典故（晏子使楚、完璧归赵等），是否有意义交给 LLM credibility 判定
const MIN_CHARS = 4;
const MAX_CHARS = 500;

const rawDigest = ref("");
const generating = ref(false);
const error = ref<string | null>(null);
// low 可信度警告：LLM 仍生成了候选，但提示用户输入偏宽泛
const warning = ref<string | null>(null);

const charCount = computed(() => rawDigest.value.length);
const isOverLimit = computed(() => charCount.value > MAX_CHARS);
const isTooShort = computed(
  () => rawDigest.value.trim().length > 0 && rawDigest.value.trim().length < MIN_CHARS,
);
const canSubmit = computed(
  () => !generating.value
    && rawDigest.value.trim().length >= MIN_CHARS
    && charCount.value <= MAX_CHARS,
);

async function handleSubmit() {
  if (generating.value) return;
  const text = rawDigest.value.trim();
  if (!text) {
    error.value = `请输入至少 ${MIN_CHARS} 个字的历史故事梗概`;
    return;
  }
  if (text.length < MIN_CHARS) {
    error.value = `请输入至少 ${MIN_CHARS} 个字（支持成语/典故，如"晏子使楚"）`;
    return;
  }
  if (text.length > MAX_CHARS) {
    error.value = `梗概过长，最多 ${MAX_CHARS} 字（当前 ${text.length} 字）`;
    return;
  }

  generating.value = true;
  error.value = null;
  warning.value = null;
  try {
    await projectStore.createProject();
    const projectId = await projectStore.ensureProject();
    const resp = await apiFetch(`/api/projects/${projectId}/topic/from-custom`, {
      method: "POST",
      body: {
        rawDigest: text,
      },
    });
    // 后端在 credibility=low 时会附带 warning 字段，提示用户输入偏宽泛
    // 仍正常返回候选，不阻塞流程，只做提示
    const warningMsg = (resp as Record<string, unknown> | null)?.warning;
    if (typeof warningMsg === "string" && warningMsg.trim().length > 0) {
      warning.value = warningMsg;
    }
    topicStore.selectTab("custom");
    emit("close");
  } catch (e) {
    if (e instanceof Error) {
      error.value = e.message;
    } else {
      error.value = "自定义选题生成失败，请重试";
    }
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <div class="custom-input">
    <div class="custom-desc">
      输入你想要的历史故事梗概，AI 将提炼核心事件并生成选题。
    </div>

    <textarea
      v-model="rawDigest"
      class="custom-textarea"
      :class="{ 'is-over-limit': isOverLimit }"
      placeholder="支持成语/典故或完整描述，如「晏子使楚」或「公元前 260 年，秦赵长平决战。赵括代廉颇为将，秦将白起诱敌深入、围困赵军四十余日……」"
      rows="5"
      :maxlength="MAX_CHARS"
      :disabled="generating"
    ></textarea>

    <div class="custom-meta">
      <span class="char-hint" :class="{ 'hint-warn': isTooShort }">
        最少 {{ MIN_CHARS }} 字
      </span>
      <span class="char-count" :class="{ 'count-over': isOverLimit }">
        {{ charCount }} / {{ MAX_CHARS }}
      </span>
    </div>

    <div v-if="warning" class="custom-warning">
      <span class="warning-icon">💡</span>
      <span>{{ warning }}</span>
    </div>

    <div v-if="error" class="custom-error">
      <span class="error-icon">⚠️</span>
      <span>{{ error }}</span>
      <button class="retry-btn" @click="handleSubmit">重试</button>
    </div>

    <div class="custom-actions">
      <button
        class="action-btn action-btn--primary"
        :disabled="!canSubmit"
        @click="handleSubmit"
      >
        <span v-if="generating" class="btn-spinner"></span>
        {{ generating ? '提炼中…' : '⚡ 提炼并生成选题' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.custom-input {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.custom-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
}

.custom-textarea {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(212, 163, 95, 0.12);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-body);
  font-size: 14px;
  font-family: var(--font-family);
  line-height: 1.7;
  resize: vertical;
  min-height: 120px;
  transition: border-color 200ms ease;
}
.custom-textarea:focus {
  outline: none;
  border-color: rgba(212, 163, 95, 0.35);
  box-shadow: 0 0 0 2px rgba(212, 163, 95, 0.06);
}
.custom-textarea:disabled {
  opacity: 0.5;
}
.custom-textarea.is-over-limit {
  border-color: rgba(239, 83, 80, 0.45);
}

.custom-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
}

.char-hint.hint-warn {
  color: rgba(255, 193, 7, 0.85);
}

.char-count.count-over {
  color: rgba(239, 83, 80, 0.9);
  font-weight: 600;
}

.custom-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 10px;
  background: rgba(255, 193, 7, 0.06);
  border: 1px solid rgba(255, 193, 7, 0.2);
  font-size: 13px;
  color: var(--text-secondary);
}

.warning-icon {
  flex-shrink: 0;
}

.custom-error {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 10px;
  background: rgba(239, 83, 80, 0.06);
  border: 1px solid rgba(239, 83, 80, 0.15);
  font-size: 13px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.error-icon {
  flex-shrink: 0;
}

.retry-btn {
  margin-left: auto;
  flex-shrink: 0;
  padding: 5px 16px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid rgba(239, 83, 80, 0.3);
  background: rgba(239, 83, 80, 0.08);
  color: var(--text-body);
  cursor: pointer;
}

.custom-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.action-btn {
  padding: 14px 32px;
  border-radius: 100px;
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-family);
  cursor: pointer;
  transition: all 240ms cubic-bezier(0.4, 0, 0.2, 1);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-btn--primary {
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  color: var(--text-inverse);
  box-shadow: 0 4px 16px rgba(212, 163, 95, 0.25);
}
.action-btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(212, 163, 95, 0.35);
}
.action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
