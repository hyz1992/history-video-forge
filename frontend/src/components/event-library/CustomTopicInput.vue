<script setup lang="ts">
import { ref } from "vue";
import { apiFetch } from "../../utils/api";
import { useTopicStore } from "../../stores/topic";
import { useProjectStore } from "../../stores/project";

const emit = defineEmits<{
  (e: "close"): void;
}>();

const topicStore = useTopicStore();
const projectStore = useProjectStore();

const rawDigest = ref("");
const generating = ref(false);
const error = ref<string | null>(null);

async function handleSubmit() {
  if (generating.value) return;
  const text = rawDigest.value.trim();
  if (!text) {
    error.value = "请输入至少 10 个字的历史故事梗概";
    return;
  }
  if (text.length < 10) {
    error.value = "梗概太短，请输入至少 10 个字";
    return;
  }

  generating.value = true;
  error.value = null;
  try {
    await projectStore.createProject();
    const projectId = await projectStore.ensureProject();
    await apiFetch(`/api/projects/${projectId}/topic/from-custom`, {
      method: "POST",
      body: {
        rawDigest: text,
      },
    });
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
      placeholder="例如：公元前 260 年，秦赵长平决战。赵括代廉颇为将，秦将白起诱敌深入、围困赵军四十余日。赵括突围阵亡，四十万赵军投降后遭坑杀…"
      rows="5"
      :disabled="generating"
    ></textarea>

    <div v-if="error" class="custom-error">
      <span class="error-icon">⚠️</span>
      <span>{{ error }}</span>
      <button class="retry-btn" @click="handleSubmit">重试</button>
    </div>

    <div class="custom-actions">
      <button
        class="action-btn action-btn--primary"
        :disabled="generating || !rawDigest.trim()"
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
