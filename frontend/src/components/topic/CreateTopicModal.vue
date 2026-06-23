<script setup lang="ts">
import { ref, watch } from "vue";

import { useProjectStore } from "../../stores/project";
import {
  useTopicStore,
  type TopicRecommendationFilters,
  type TopicTab,
} from "../../stores/topic";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "confirmed"): void;
}>();

const projectStore = useProjectStore();
const topicStore = useTopicStore();

const activeTab = ref<TopicTab>("system");

const eraFilter = ref<TopicRecommendationFilters["era"]>(
  (sessionStorage.getItem("topic-era-filter") as TopicRecommendationFilters["era"]) ?? "ancient",
);
const tensionFilter = ref<TopicRecommendationFilters["tension"]>(
  (sessionStorage.getItem("topic-tension-filter") as TopicRecommendationFilters["tension"]) ?? "high",
);

const isGenerating = ref(false);
const error = ref<string | null>(null);

const eraOptions: { value: TopicRecommendationFilters["era"]; label: string }[] = [
  { value: "ancient", label: "先秦至两汉" },
  { value: "medieval", label: "魏晋至唐宋" },
  { value: "late-imperial", label: "元明清" },
];

const tensionOptions: { value: TopicRecommendationFilters["tension"]; label: string }[] = [
  { value: "high", label: "高张力" },
  { value: "balanced", label: "均衡叙事" },
  { value: "hook-first", label: "传播切口优先" },
];

const tabOptions: { value: TopicTab; label: string }[] = [
  { value: "system", label: "系统推荐" },
  { value: "library", label: "事件库" },
  { value: "custom", label: "自定义选题" },
];

function saveFilters() {
  sessionStorage.setItem("topic-era-filter", eraFilter.value);
  sessionStorage.setItem("topic-tension-filter", tensionFilter.value);
}

async function handleGenerate() {
  if (isGenerating.value) return;
  isGenerating.value = true;
  error.value = null;
  saveFilters();
  try {
    await projectStore.createProject();
    topicStore.selectTab(activeTab.value);
    topicStore.generateSystemRecommendations({
      era: eraFilter.value,
      tension: tensionFilter.value,
    });
    emit("confirmed");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "创建项目失败，请重试";
  } finally {
    isGenerating.value = false;
  }
}

function close() {
  if (isGenerating.value) return;
  emit("update:visible", false);
}

watch(() => props.visible, (val) => {
  if (!val) {
    error.value = null;
    activeTab.value = "system";
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="modal-overlay"
    >
      <div class="modal-box">
        <button
          v-if="!isGenerating"
          class="modal-close"
          @click="close"
          aria-label="关闭"
        >✕</button>

        <div class="modal-title">新建项目</div>

        <div class="modal-tabs">
          <button
            v-for="tab in tabOptions"
            :key="tab.value"
            class="tab-btn"
            :class="{ 'tab-btn--active': activeTab === tab.value }"
            :disabled="isGenerating"
            @click="activeTab = tab.value"
          >{{ tab.label }}</button>
        </div>

        <template v-if="activeTab === 'system'">
          <div class="modal-filters">
            <div class="filter-group">
              <div class="filter-label">历史时期</div>
              <div class="chip-row">
                <button
                  v-for="opt in eraOptions"
                  :key="opt.value"
                  class="chip"
                  :class="{ 'chip--active': eraFilter === opt.value }"
                  :disabled="isGenerating"
                  @click="eraFilter = opt.value"
                >{{ opt.label }}</button>
              </div>
            </div>

            <div class="filter-group">
              <div class="filter-label">叙事偏好</div>
              <div class="chip-row">
                <button
                  v-for="opt in tensionOptions"
                  :key="opt.value"
                  class="chip"
                  :class="{ 'chip--active': tensionFilter === opt.value }"
                  :disabled="isGenerating"
                  @click="tensionFilter = opt.value"
                >{{ opt.label }}</button>
              </div>
            </div>
          </div>
        </template>

        <div
          v-else
          class="modal-placeholder"
        >
          <div class="placeholder-icon">📋</div>
          <p>{{ activeTab === 'library' ? '事件库' : '自定义选题' }}功能将在后续版本中接入。</p>
        </div>

        <div v-if="error" class="modal-error">
          <span class="error-icon">⚠️</span>
          <span>{{ error }}</span>
          <button class="modal-btn modal-btn--retry" @click="handleGenerate">重试</button>
        </div>

        <div class="modal-actions">
          <button
            v-if="activeTab === 'system'"
            class="modal-btn modal-btn--primary"
            :disabled="isGenerating"
            :class="{ 'modal-btn--loading': isGenerating }"
            @click="handleGenerate"
          >
            <span v-if="isGenerating" class="btn-spinner"></span>
            {{ isGenerating ? '创建中…' : '⚡ 开始生成选题' }}
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
  width: 960px;
  max-width: 94vw;
  max-height: 90vh;
  min-height: 640px;
  overflow-y: auto;
  background: linear-gradient(180deg, #141c2b 0%, var(--bg-card) 160px);
  border: 1px solid rgba(212, 163, 95, 0.14);
  border-radius: 16px;
  box-shadow:
    0 0 0 1px rgba(212, 163, 95, 0.05),
    0 8px 48px rgba(0, 0, 0, 0.55),
    0 2px 12px rgba(0, 0, 0, 0.3);
  padding: 18px 54px 30px;
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  margin-left: -30px;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-heading);
  line-height: 1;
  padding-right: 40px;
}

.modal-tabs {
  margin-top: -10px;
  display: inline-flex;
  gap: 2px;
  align-self: center;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 5px;
  border: 1px solid rgba(212, 163, 95, 0.1);
}

.tab-btn {
  padding: 10px 28px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 500;
  font-family: var(--font-family);
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
  white-space: nowrap;
  position: relative;
}
.tab-btn:hover { color: var(--text-body); }
.tab-btn--active {
  background: linear-gradient(135deg, rgba(212, 163, 95, 0.18), rgba(212, 163, 95, 0.08));
  color: var(--accent-primary);
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}
.tab-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.modal-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 16px 40px;
  color: var(--text-muted);
  font-size: 14px;
  text-align: center;
}

.placeholder-icon { font-size: 48px; line-height: 1; opacity: 0.5; }

.modal-filters {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 24px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid rgba(212, 163, 95, 0.08);
  border-radius: 14px;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.chip-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.chip {
  padding: 10px 20px;
  border-radius: 100px;
  font-size: 13.5px;
  font-weight: 500;
  font-family: var(--font-family);
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: all 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
.chip:hover {
  color: var(--text-body);
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(212, 163, 95, 0.2);
}
.chip--active {
  color: var(--accent-primary);
  background: linear-gradient(135deg, rgba(212, 163, 95, 0.14), rgba(212, 163, 95, 0.06));
  border-color: rgba(212, 163, 95, 0.35);
  font-weight: 600;
  box-shadow: 0 0 12px rgba(212, 163, 95, 0.08);
}
.chip:disabled { opacity: 0.5; cursor: not-allowed; }

.modal-error {
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

.error-icon { flex-shrink: 0; }

.modal-btn--retry {
  margin-left: auto;
  flex-shrink: 0;
  padding: 5px 16px;
  font-size: 12px;
}

.modal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-top: auto;
}

.modal-btn {
  padding: 14px 32px;
  border-radius: 100px;
  font-size: 15px;
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
.modal-btn--secondary:hover { color: var(--text-body); border-color: var(--border-hover); }

.modal-btn--primary {
  background: linear-gradient(135deg, #d4a35f 0%, #c56b47 100%);
  color: var(--text-inverse);
  box-shadow:
    0 4px 16px rgba(212, 163, 95, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  letter-spacing: 0.02em;
}
.modal-btn--primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow:
    0 8px 24px rgba(212, 163, 95, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.modal-btn--primary:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(212, 163, 95, 0.2);
}

.modal-btn--loading { cursor: wait; }

.modal-btn:disabled {
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
