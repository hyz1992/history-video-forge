<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import GenerationStrategySettings from "./GenerationStrategySettings.vue";
import {
  computeConfigInvalidationPreview,
  useGenerationConfigStore,
  type ApiVideoQualityValue,
  type VideoGenerationStrategyValue,
} from "../../stores/generation-config";

/**
 * S2-2A 任务 10：项目生成设置（工作区内对话框）。
 * 展示项目当前值、来源（继承自创建时用户默认）、与当前用户默认差异、
 * 保存前失效预览；保存走项目配置 PATCH（乐观并发）。
 */

const props = defineProps<{
  projectId: string;
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const store = useGenerationConfigStore();

const draft = reactive({
  strategy: "prefer_remotion" as VideoGenerationStrategyValue,
  apiQuality: "standard_720p" as ApiVideoQualityValue,
  budgetMicros: null as string | null,
});
const budgetInvalid = ref(false);
const saveError = ref<string | null>(null);
const loaded = ref(false);

const configState = computed(() => store.state.projectConfigs[props.projectId]);
const config = computed(() => configState.value?.data ?? null);

function applyServerData() {
  const data = store.state.projectConfigs[props.projectId]?.data;
  if (!data) return;
  draft.strategy = data.configuration.video.strategy;
  draft.apiQuality = data.configuration.video.api_quality;
  draft.budgetMicros = data.configuration.budget.max_paid_cost_micros_per_run;
}

watch(
  () => [props.open, props.projectId] as const,
  async ([open, projectId]) => {
    if (!open || !projectId) return;
    loaded.value = false;
    // 重开对话框时清空上次会话残留状态
    saveError.value = null;
    budgetInvalid.value = false;
    await store.loadProjectConfig(projectId);
    applyServerData();
    loaded.value = true;
  },
  { immediate: true },
);

// 409 冲突重载后表单同步服务器最新值，避免基于旧视图的第二次保存覆盖竞争修改
watch(
  () => configState.value?.conflict,
  (conflict) => {
    if (conflict) applyServerData();
  },
);

const sourceNote = computed(() => {
  if (!config.value) return "";
  if (config.value.source_user_preference_revision !== null) {
    return `继承自创建时用户默认（来源偏好版本 ${config.value.source_user_preference_revision}）`;
  }
  return "项目尚未设置，当前为系统默认回填";
});

const hasDiff = computed(() => {
  const diff = config.value?.diff_from_user_default;
  return diff !== null && diff !== undefined && Object.keys(diff).length > 0;
});

const invalidationPreview = computed(() => {
  if (!config.value || !loaded.value) return null;
  return computeConfigInvalidationPreview(
    { video: config.value.configuration.video },
    { video: { strategy: draft.strategy, api_quality: draft.apiQuality } },
  );
});

const previewStageLabels: Record<string, string> = {
  storyboard_route_resolution: "分镜路线解析",
  asset_planning: "资产规划",
  assets: "资产生成",
  quote: "报价",
  none: "无",
};

function previewStageText(stages: string[]): string {
  return stages.map((stage) => previewStageLabels[stage] ?? stage).join("、");
}

async function save() {
  saveError.value = null;
  if (budgetInvalid.value) {
    saveError.value = "预算金额格式不正确：请输入非负金额，最多 6 位小数。";
    return;
  }
  const result = await store.saveProjectConfig(props.projectId, {
    video: { strategy: draft.strategy, api_quality: draft.apiQuality },
    budgetMicros: draft.budgetMicros,
  });
  if (!result.ok && !result.conflict) {
    saveError.value = "保存失败，请稍后重试。";
    return;
  }
  // 保存成功（含 409 冲突已由 store 重载）后关闭对话框
  emit("close");
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="项目生成设置"
    width="680px"
    @update:model-value="(value: boolean) => !value && emit('close')"
  >
    <div class="project-settings">
      <section v-if="configState?.loading || !loaded" class="project-settings-loading">正在加载项目配置…</section>
      <template v-else-if="config">
        <el-alert
          v-if="configState?.conflict"
          type="warning"
          :closable="false"
          title="项目配置已被其他会话更新"
          description="已重新加载服务器最新配置，请基于最新值重新调整后再保存。"
          show-icon
        />

        <section class="project-meta">
          <div class="project-meta-row">
            <span class="project-meta-label">配置来源</span>
            <span>{{ sourceNote }}</span>
          </div>
          <div class="project-meta-row">
            <span class="project-meta-label">与当前用户默认差异</span>
            <span>{{ hasDiff ? "与当前用户默认不同（以项目配置为准）" : "与当前用户默认一致" }}</span>
          </div>
        </section>

        <GenerationStrategySettings
          v-model:strategy="draft.strategy"
          v-model:api-quality="draft.apiQuality"
          v-model:budget-micros="draft.budgetMicros"
          v-model:budget-invalid="budgetInvalid"
          :disabled="configState?.saving"
          test-id-prefix="project-"
        />

        <section
          v-if="invalidationPreview"
          class="project-invalidation"
          data-testid="project-invalidation-preview"
        >
          <h4 class="project-invalidation-title">保存后影响预览</h4>
          <p class="project-invalidation-stages">
            受影响阶段：<strong>{{ previewStageText(invalidationPreview.affected_stages) }}</strong>
          </p>
          <p class="project-invalidation-note">{{ invalidationPreview.note }}</p>
        </section>

        <p v-if="saveError" class="project-settings-error">{{ saveError }}</p>
      </template>
      <p v-else class="project-settings-error">项目配置加载失败，请关闭后重试。</p>
    </div>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button
        class="btn btn-primary"
        data-testid="save-project-config"
        :disabled="configState?.saving || budgetInvalid || !loaded"
        @click="save"
      >
        {{ configState?.saving ? "保存中…" : "保存项目设置" }}
      </button>
    </template>
  </el-dialog>
</template>

<style scoped>
.project-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.project-settings-loading {
  color: #a89f94;
  font-size: 13px;
}

.project-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(201, 162, 39, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
}

.project-meta-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #d8d0c7;
}

.project-meta-label {
  min-width: 132px;
  color: #a89f94;
}

.project-invalidation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid rgba(224, 122, 95, 0.3);
  border-radius: 10px;
  background: rgba(224, 122, 95, 0.06);
}

.project-invalidation-title {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #e0a883;
}

.project-invalidation-stages,
.project-invalidation-note {
  margin: 0;
  font-size: 12px;
  color: #d8d0c7;
}

.project-settings-error {
  color: #e07a5f;
  font-size: 13px;
  margin: 0;
}

.btn {
  height: 36px;
  padding: 0 16px;
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
  margin-right: 10px;
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
</style>
