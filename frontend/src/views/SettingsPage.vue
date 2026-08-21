<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import GenerationStrategySettings from "../components/settings/GenerationStrategySettings.vue";
import {
  useGenerationConfigStore,
  type ApiVideoQualityValue,
  type VideoGenerationStrategyValue,
} from "../stores/generation-config";

/**
 * S2-2A 任务 10：用户默认生成设置页（/settings）。
 * 用户默认只在创建新项目时复制为项目配置，不影响已有项目。
 */

const router = useRouter();
const store = useGenerationConfigStore();

const draft = reactive({
  strategy: "prefer_remotion" as VideoGenerationStrategyValue,
  apiQuality: "standard_720p" as ApiVideoQualityValue,
  budgetMicros: null as string | null,
});
const budgetInvalid = ref(false);
const saveError = ref<string | null>(null);

function applyServerData() {
  const data = store.state.userPreference.data;
  if (!data) return;
  draft.strategy = data.configuration.video.strategy;
  draft.apiQuality = data.configuration.video.api_quality;
  draft.budgetMicros = data.configuration.budget.max_paid_cost_micros_per_run;
}

onMounted(async () => {
  await store.loadUserPreference();
  applyServerData();
  await store.loadCapabilities();
});

// 409 冲突重载后表单同步服务器最新值：用户看得见竞争修改，避免基于旧
// 视图的第二次保存静默覆盖其他会话的变更。
// B2 整改：盯 conflictEpoch（每次冲突自增）而非布尔 conflict——连续两次 409
// 时 true→true 不触发 watcher，旧实现会漏掉第二次冲突的同步。
watch(
  () => store.state.userPreference.conflictEpoch,
  () => {
    if (store.state.userPreference.conflict) applyServerData();
  },
);

const loadFailed = computed(
  () => store.state.userPreference.error !== null && store.state.userPreference.data === null,
);

const capabilityGroups = computed(() => {
  const labels: Record<string, string> = {
    "llm.smart": "文案智脑（自动）",
    "llm.flash": "快速模型（自动）",
    "image.generate": "分镜图生成（自动）",
    "video.image_to_video": "分镜视频生成（自动）",
    "tts.synthesize": "口播配音（自动）",
  };
  const groups = new Map<string, { label: string; models: string[] }>();
  for (const entry of store.state.capabilities) {
    const group = groups.get(entry.capability) ?? {
      label: labels[entry.capability] ?? `${entry.capability}（自动）`,
      models: [],
    };
    group.models.push(entry.display_name);
    groups.set(entry.capability, group);
  }
  return [...groups.values()];
});

async function save() {
  saveError.value = null;
  if (budgetInvalid.value) {
    saveError.value = "预算金额格式不正确：请输入非负金额，最多 6 位小数。";
    return;
  }
  const result = await store.saveUserPreference({
    video: { strategy: draft.strategy, api_quality: draft.apiQuality },
    budgetMicros: draft.budgetMicros,
  });
  if (!result.ok && !result.conflict) {
    saveError.value = "保存失败，请稍后重试。";
  }
}

function goBack() {
  router.push("/projects");
}
</script>

<template>
  <div class="settings-page">
    <header class="settings-header">
      <button class="btn btn-ghost" @click="goBack">返回项目列表</button>
      <h2 class="settings-title">生成偏好设置</h2>
      <p class="settings-subtitle">这里的默认配置只影响新项目：创建项目时会复制为该项目的初始配置；已有项目请在工作区的项目设置中单独修改。</p>
    </header>

    <main class="settings-body">
      <section v-if="store.state.userPreference.loading" class="settings-loading">正在加载…</section>
      <section v-else-if="loadFailed" class="settings-load-failed" data-testid="preference-load-error">
        <p>用户偏好加载失败（{{ store.state.userPreference.error }}），为避免误覆盖已有配置，暂不展示编辑表单。</p>
        <button class="btn btn-primary" @click="store.loadUserPreference().then(applyServerData)">重试加载</button>
      </section>
      <template v-else>
        <el-alert
          v-if="store.state.userPreference.conflict"
          data-testid="preference-conflict"
          type="warning"
          :closable="false"
          title="配置已被其他会话更新"
          description="服务器上的配置比本页更新（可能是你在其他窗口保存过）。已为你重新加载最新配置，请基于最新值重新调整后再保存。"
          show-icon
        />
        <GenerationStrategySettings
          v-model:strategy="draft.strategy"
          v-model:api-quality="draft.apiQuality"
          v-model:budget-micros="draft.budgetMicros"
          v-model:budget-invalid="budgetInvalid"
          :disabled="store.state.userPreference.saving"
        />
        <p v-if="saveError" class="settings-error">{{ saveError }}</p>
        <div class="settings-actions">
          <button
            class="btn btn-primary"
            data-testid="save-preference"
            :disabled="store.state.userPreference.saving || budgetInvalid"
            @click="save"
          >
            {{ store.state.userPreference.saving ? "保存中…" : "保存默认设置" }}
          </button>
        </div>

        <section class="capability-section">
          <h3 class="capability-title">当前平台可用模型（只读）</h3>
          <p class="capability-hint">生成任务当前使用「自动」模式，由平台按能力目录自动选择；普通用户暂不支持指定具体模型。</p>
          <div v-if="capabilityGroups.length > 0" class="capability-summary" data-testid="capability-summary">
            <div v-for="group in capabilityGroups" :key="group.label" class="capability-group">
              <span class="capability-group-label">{{ group.label }}</span>
              <span class="capability-group-models">{{ group.models.join(" / ") }}</span>
            </div>
          </div>
          <p v-else class="capability-empty">当前部署没有已启用的外部模型（本地/演示模式）。</p>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.settings-page {
  min-height: 100vh;
  background: #101010;
  color: #f5f0e8;
  display: flex;
  flex-direction: column;
}

.settings-header {
  padding: 22px 36px 14px;
  border-bottom: 1px solid rgba(201, 162, 39, 0.14);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.settings-title {
  margin: 0;
  font-size: 20px;
  font-weight: 750;
}

.settings-subtitle {
  margin: 0;
  font-size: 13px;
  color: #a89f94;
}

.settings-body {
  padding: 26px 36px 48px;
  max-width: 860px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-loading {
  color: #a89f94;
  font-size: 13px;
}

.settings-load-failed {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(224, 122, 95, 0.3);
  border-radius: 10px;
  background: rgba(224, 122, 95, 0.06);
  color: #e0a883;
  font-size: 13px;
}

.settings-error {
  color: #e07a5f;
  font-size: 13px;
  margin: 0;
}

.settings-actions {
  display: flex;
  gap: 12px;
}

.btn {
  height: 38px;
  padding: 0 18px;
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

.capability-section {
  margin-top: 18px;
  border-top: 1px solid rgba(201, 162, 39, 0.14);
  padding-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.capability-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.capability-hint {
  margin: 0;
  font-size: 12px;
  color: #6b635a;
}

.capability-summary {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capability-group {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(201, 162, 39, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.015);
}

.capability-group-label {
  font-size: 13px;
  font-weight: 650;
  min-width: 150px;
}

.capability-group-models {
  font-size: 12px;
  color: #a89f94;
}

.capability-empty {
  margin: 0;
  font-size: 12px;
  color: #6b635a;
}
</style>
